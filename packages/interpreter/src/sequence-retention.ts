import { denseScalarItems, noteArrayBinding } from './array-storage.js';
import { currentDiagnostics } from './diagnostics.js';
import { RankError } from './errors.js';
import { checkpoint, DemandBudgetExhausted, InterruptedError } from './interrupt.js';
import { withSequencePlan } from './sequence.js';
import { isRankArray, isRankDate, isRankLabel, MISSING, type RankSequence, type RankValue, type SequencePlan } from './value.js';

const retained = new WeakMap<RankSequence, RankSequence>();

/** Aliases selected by consumer analysis share one cache, not nested wrappers. */
export function retainSequence(source: RankSequence, maxBytes?: number): RankSequence {
    const previous = retained.get(source);
    if (previous) return previous;
    const plan = retainSequencePlan(source.plan, maxBytes);
    if (plan === source.plan) return source;
    const result = withSequencePlan(source, plan);
    retained.set(source, result);
    retained.set(result, result);
    return result;
}

/** Logical retained storage, not a claim about the host VM's object overhead. */
export const DEFAULT_SEQUENCE_CACHE_BYTES = 8 * 1024 * 1024;

function scalarBytes(value: RankValue): number | undefined {
    if (typeof value === 'string') return 32 + value.length * 2;
    if (typeof value === 'bigint') return 32 + value.toString(16).length;
    if (isRankLabel(value)) return 32 + value.name.length * 2;
    if (typeof value !== 'object' || value === MISSING || isRankDate(value)) return 32;
    return undefined;
}

/** Only owned eager scalar arrays have a cheap, proven value snapshot here.
 * Unsupported results keep streaming; inspecting them must not force lazy work. */
function retainedBytes(value: RankValue, remaining: number): number | undefined {
    const scalar = scalarBytes(value);
    if (scalar !== undefined) return scalar;
    if (!isRankArray(value)) return undefined;
    const cells = denseScalarItems(value);
    if (!cells) return undefined;
    let bytes = 128 + value.shape.length * 8 + cells.length * 8;
    if (bytes > remaining) return bytes;
    for (let i = 0; i < cells.length; i++) {
        const size = scalarBytes(cells[i]);
        if (size === undefined) return undefined;
        bytes += size;
        if (bytes > remaining) break;
    }
    return bytes;
}

/** Opt-in shared replay for a source proven pure and restartable by its owner.
 * Exhaustion of the retention budget degrades to independent pure traversals.
 * It never converts an effectful/single-pass source into a restartable source. */
export function retainSequencePlan(source: SequencePlan, maxBytes = DEFAULT_SEQUENCE_CACHE_BYTES): SequencePlan {
    if (source.replay !== 'pure' || source.singlePass) return source;
    // Even the smallest supported item costs 32 logical bytes. Avoid building
    // a cache that a known cardinality already proves cannot fit.
    if (source.size.kind === 'exact' && Number.isFinite(maxBytes)
        && source.size.value > BigInt(Math.max(0, Math.floor(maxBytes / 32)))) return source;
    const stats = currentDiagnostics();
    const history: RankValue[] = [];
    let bytes = 0;
    let enabled = maxBytes > 0;
    let iterator: IterableIterator<RankValue> | undefined;
    let length: bigint | undefined;
    let failure: { error: unknown } | undefined;
    let advancing = false;

    function restart(position: number): IterableIterator<RankValue> {
        const next = source.iterate();
        try {
            for (let i = 0; i < position; i++) {
                checkpoint('restarting sequence');
                if (next.next().done) throw new RankError('pure sequence changed during replay');
            }
            return next;
        } catch (error) { next.return?.(); throw error; }
    }

    function* read(start = 0): IterableIterator<RankValue> {
        let position = start;
        let privateIterator: IterableIterator<RankValue> | undefined;
        try {
            while (true) {
                checkpoint('reading retained sequence');
                if (enabled && position < history.length) {
                    if (stats) stats.sequenceReplayHits++;
                    yield history[position++];
                    continue;
                }
                if (length !== undefined && BigInt(position) >= length) return;
                if (enabled && failure) throw failure.error;
                if (!enabled) {
                    privateIterator ??= restart(position);
                    const next = privateIterator.next();
                    if (next.done) { length = BigInt(position); return; }
                    position++;
                    yield next.value;
                    continue;
                }
                if (advancing) throw new RankError('recursive sequence replay');
                let next: IteratorResult<RankValue>;
                advancing = true;
                try {
                    iterator ??= restart(history.length);
                    next = iterator.next();
                } catch (error) {
                    iterator = undefined;
                    // These exceptions close generators. A later read may restart
                    // pure work; it must not replay a previous host cancellation.
                    if (!(error instanceof InterruptedError || error instanceof DemandBudgetExhausted)) failure = { error };
                    throw error;
                } finally { advancing = false; }
                if (next.done) { length = BigInt(position); iterator = undefined; return; }
                const cost = retainedBytes(next.value, maxBytes - bytes);
                if (cost === undefined || bytes + cost > maxBytes) {
                    enabled = false;
                    history.length = 0;
                    if (stats) { stats.sequenceCacheBytes -= bytes; stats.sequenceCacheEvictions++; }
                    bytes = 0;
                    // The reader crossing the limit keeps its already-advanced
                    // iterator. Other readers restart at their own positions.
                    privateIterator = iterator;
                    iterator = undefined;
                } else {
                    noteArrayBinding(next.value);
                    history.push(next.value);
                    bytes += cost;
                    if (stats) {
                        stats.sequenceCachedValues++;
                        stats.sequenceCacheBytes += cost;
                        stats.sequenceCachePeakBytes = Math.max(stats.sequenceCachePeakBytes, stats.sequenceCacheBytes);
                    }
                }
                position++;
                yield next.value;
            }
        } finally { privateIterator?.return?.(); }
    }

    return {
        ...source,
        get size() { return length === undefined ? source.size : { kind: 'exact' as const, value: length }; },
        iterate: () => read(),
        at(index) {
            if (index < 0n || length !== undefined && index >= length) return undefined;
            if (index > BigInt(Number.MAX_SAFE_INTEGER)) {
                if (source.at) return source.at(index);
                throw new RankError('sequence index is too large for retained traversal', 'RangeError');
            }
            if (enabled && index < BigInt(history.length)) {
                if (stats) stats.sequenceReplayHits++;
                return history[Number(index)];
            }
            if (!enabled && source.at) return source.at(index);
            // Reading ahead must fill the intervening prefix as well.
            const start = enabled ? history.length : 0;
            const reader = read(start);
            try {
                for (let i = BigInt(start); ; i++) {
                    const next = reader.next();
                    if (next.done) return undefined;
                    if (i === index) return next.value;
                }
            } finally { reader.return?.(); }
        },
        // Generic consumers now traverse retained values instead of bypassing
        // them through source reductions, membership, or filter pushdown.
        contains: undefined,
        reduce: undefined,
        withFilter: undefined,
    };
}
