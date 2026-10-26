import { safeIntegerSquareRoot } from './integer-square-root.js';
import { isForStatement } from '@arrrank/language';
import { argumentSelectionError, MissingValueError, RankError } from './errors.js';
import { completed } from './execution.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { checkpoint, privateLoopPolling } from './interrupt.js';
import { arrayRevision, denseScalarItems, materializedArrayItems, hasPendingSelections, arrayForWrite, borrowArrayStorage, prepareScalarArrayWriter, typedElementKind, integer32Cells, writeInteger32Cells, writableIntegerCells, writableRealCells, hasWritableBooleanCells } from './array-storage.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';
import type { CompiledLoop, IntegerLoopPlan, LoopHost, LoopTerm } from './integer-loop-plan.js';

// Internal control transfer, never exposed as a Rank error or converted to BigInt.
type NumberCells = ArrayLike<number | bigint>;
const overflow = {};
function safe(value: number): number {
    if (!Number.isSafeInteger(value)) throw overflow;
    return value;
}
function int32(value: number): number {
    if (value !== (value | 0)) throw overflow;
    return value;
}
/** Repeated squaring uses only checked integer products. JS ** can round a
 * mathematical integer to a different safe integer, so checking its result alone
 * would not establish exactness. Negative exponents replay with real semantics. */
function power(base: number, exponent: number): number {
    if (exponent < 0) throw overflow;
    let result = 1;
    while (exponent > 0) {
        if (exponent % 2 !== 0) result = safe(result * base);
        exponent = Math.floor(exponent / 2);
        if (exponent > 0) base = safe(base * base);
    }
    return result;
}
function widePower(base: bigint, exponent: bigint): bigint {
    if (exponent < 0n) throw overflow;
    return base ** exponent;
}
/** Wide numerators retain exact remainder division. The generated bounded
 * case uses floor(a/b): for abs(a) < 2^52 its rounding error is less than
 * half of 1/abs(b), so it cannot cross an integer boundary. */
function divide(a: number, b: number): number {
    const remainder = a % b;
    const quotient = safe(safe(a - remainder) / b);
    return safe(quotient - ((a < 0) !== (b < 0) && remainder !== 0 ? 1 : 0));
}
const rankValue = (value: unknown, type: string | undefined): RankValue | undefined =>
    typeof value === 'number' && type === 'integer' ? BigInt(value) : value as RankValue | undefined;

/** Only private scalar/cell writes and trusted eager reads qualify. Nothing is
 * published until success, so overflow can discard this attempt and enter the
 * original BigInt loop with its original inputs. Errors publish partial state.
 * Inspection and custom host polling retain the existing publishing backend. */
export function prepareNumberLoop(plan: IntegerLoopPlan, host: LoopHost): CompiledLoop | undefined {
    const { names, localTypes, arrays, required, body, root, locations, statement } = plan;
    if (host.observableEntry || !host.canDeferWrites || plan.calls.some(call => !call.numberSafe) || plan.iterators.length || plan.containers.size
        || plan.arrayDefinitions.size || plan.hasReturn || plan.hasYield
        // A condition loop has no traversal bound to amortize private buffers.
        // Repeated short invocations would copy the whole destination per entry;
        // the exact backend writes owned cells directly instead.
        || !plan.iteration && plan.destinations.size > 0
        || [...localTypes.values()].some(type => type !== 'integer' && type !== 'boolean' && type !== 'real')
        || [...arrays.values()].some(info => !['integer', 'real', 'boolean'].includes(info.type ?? 'integer') || info.rank < 1)
        || [...plan.destinations.values()].some(info => !['integer', 'real', 'boolean'].includes(info.type ?? 'integer') || info.rank < 1 || info.slice)
        // A traversal must keep its original cells even when the same binding is
        // written. Other names have separate private buffers, preserving COW.
        || plan.vectorIterations.some(({ slot }) => plan.destinations.has(names[slot]))) return undefined;
    const cursor = plan.iteration?.names[0];
    const indexedPass = cursor !== undefined && !plan.writerNames.includes(cursor) && !locations.some(isForStatement) && !plan.vectorIterations.length;
    const storage = new Map<string, { slot: number; rank: number; type?: LoopTerm['type'] }>([...arrays, ...plan.destinations]);
    if (plan.vectorIterations.length && !host.declareIteration) return undefined;
    const written = new Set([...plan.writerNames, ...plan.binderNames]);
    const bindings = [...written].map(name => [name, localTypes.get(name)!] as [string, 'integer' | 'real' | 'boolean']);
    const slots = [...written].map(name => names.indexOf(name));
    const registers = names.map((_, index) => `r${index} = input[${index}]`);
    for (const slot of slots) registers.push(`d${slot} = 0`);
    for (const info of storage.values()) {
        registers.push(`cells${info.slot} = cells[${info.slot}]`);
        if (info.rank > 1) for (let axis = 0; axis < info.rank; axis++) {
            registers.push(`size${info.slot}_${axis} = input[${info.slot}].shape[${axis}]`);
        }
    }
    for (const info of plan.destinations.values()) registers.push(`changed${info.slot} = changes[${info.slot}]`);
    const publish = `publish(entered, [${slots.map(slot => `[d${slot}, ${slot}, r${slot}]`).join(',')}]);`;
    const source = `"use strict"; return function(input, cells, changes, calls, publish) {
        let ${registers.length ? `${registers.join(',')}, ` : ''}result, resultType = 'integer', location = -1, order = 0;
        const entered = [];
        try {
            ${root.setup} ${root.header}
                let iterationResult, iterationType = 'integer';
                ${root.bindings} ${body.join('\n')}
                result = iterationResult; resultType = iterationType; location = -1;
            }
        } catch (error) {
            if (error === overflow) return undefined;
            ${publish}
            throw locate(error, location);
        }
        ${publish}
        return { value: result, type: resultType };
    };`;
    type Run = (input: unknown[], cells: NumberCells[], changes: Uint8Array[], calls: ((arguments_: RankValue[]) => RankValue)[], publish: (entered: boolean[], values: [number, number, unknown][]) => void) => { value: unknown; type: string } | undefined;
    let run: Run;
    try {
        run = new Function('safe', 'int32', 'overflow', 'zero', 'badStep', 'checkpoint', 'locate', 'badSlice', 'badIndex', 'domain', 'powerZero', 'powerDomain', 'badWriteIndex', 'argumentSelectionError', 'isqrt', 'divide', 'power', 'widePower', source)(
            safe, int32, overflow, () => new RankError('division by zero'),
            () => new RankError('range step must be a nonzero integer'), checkpoint,
            (error: unknown, index: number) => host.locate(error, index < 0 ? statement : locations[index]),
            (name: string) => new RankError(`${name} expects a nonnegative integer count`),
            (index: number | bigint, axis = 0) => new MissingValueError(index < 0
                ? `array index out of bounds on axis ${axis}` : `array index out of bounds on axis ${axis}: ${index}`),
            (message: string) => new RankError(message, 'DomainError'),
            () => new RankError('zero cannot be raised to a negative power'),
            () => new RankError('power result is not real'),
            (index: number | bigint, axis = 0) => index < 0 ? new RankError(`array index must be nonnegative on axis ${axis}`)
                : new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`), argumentSelectionError, safeIntegerSquareRoot, divide, power, widePower);
    } catch { return undefined; }
    host.compiled?.(source);
    // Re-entered regions often read the same factorial/search tables. These
    // buffers are private snapshots, never destinations. Tracked revisions
    // invalidate them after a store; weak keys do not retain earlier inputs.
    const readBuffers = new WeakMap<RankArray, { revision: number; type: LoopTerm['type']; cells: Float64Array }>();
    return { run: (insideFinally = false) => {
        if (plan.hasControl && insideFinally || !privateLoopPolling()) return undefined;
        for (const [name, module] of plan.builtins) if (!host.builtin(module, name)) return undefined;
        const calls: ((arguments_: RankValue[]) => RankValue)[] = [];
        for (const call of plan.calls) {
            const bound = call.bind();
            if (!bound) return undefined;
            calls.push(bound);
        }
        if (!host.canDeferWrites!([...bindings, ...[...plan.destinations.keys()].map(name => [name, 'array'] as [string, 'array'])])) return recordFallback('number-loop:binding-contract');
        const input: unknown[] = [];
        const buffers: NumberCells[] = [], changes: Uint8Array[] = [], sources: RankArray[] = [];
        for (const slot of required) {
            const value = host.read(names[slot]);
            if (localTypes.get(names[slot]) === 'boolean') {
                if (typeof value !== 'boolean') return undefined;
                input[slot] = value;
            } else if (localTypes.get(names[slot]) === 'real') {
                if (typeof value !== 'number') return undefined;
                input[slot] = value;
            } else {
                if (typeof value !== 'bigint') return recordFallback('number-loop:unsafe-input');
                if (plan.wideScalars.has(names[slot])) input[slot] = value;
                else {
                    if (!Number.isSafeInteger(Number(value))) return recordFallback('number-loop:unsafe-input');
                    input[slot] = Number(value);
                }
            }
        }
        for (const [name, info] of storage) {
            const value = host.read(name);
            if (!value || !isRankArray(value) || value.kind !== 'array' || value.itemAt !== undefined || value.shape.length !== info.rank) return undefined;
            const revision = arrayRevision(value);
            if (revision === undefined) return undefined;
            if (plan.destinations.has(name) && (hasPendingSelections(value) || !value.shape.includes(0)
                && !(info.type === 'real' ? writableRealCells(value)
                    : info.type === 'boolean' ? hasWritableBooleanCells(value) : writableIntegerCells(value)))) return undefined;
            const items = denseScalarItems(value) ?? materializedArrayItems(value);
            if (!items) return undefined;
            // A single indexed read-only pass can read packed integers in
            // place. Check safe conversion at each actual load; an unsafe cell
            // discards the private scalar attempt before exact replay.
            const compact = info.type === 'integer' ? integer32Cells(value) : undefined;
            if (compact) {
                // Private writes retain exact replay on overflow. Read-only
                // regions can borrow Int32 values directly: every cell is safe.
                // Stores widen the private copy before a value can truncate.
                buffers[info.slot] = plan.destinations.has(name) ? compact.slice() : compact;
            } else if (indexedPass && plan.indexedReads.get(name) === cursor && !plan.destinations.size && info.type === 'integer' && typedElementKind(value) === 'integer') {
                buffers[info.slot] = items as ArrayLike<bigint>;
            } else {
                const readOnly = !plan.destinations.has(name);
                const type = info.type ?? 'integer';
                const cached = readOnly ? readBuffers.get(value) : undefined;
                if (cached?.revision === revision && cached.type === type) {
                    buffers[info.slot] = cached.cells;
                    const diagnostics = currentDiagnostics();
                    if (diagnostics) diagnostics.numberLoopReadBufferHits++;
                    sources[info.slot] = value;
                    input[info.slot] = value;
                    continue;
                }
                // Mutating/vector regions use an invocation-private numeric copy.
                const cells = new Float64Array(items.length);
                for (let index = 0; index < items.length; index++) {
                    if ((index & 4095) === 0) checkpoint('preparing numeric loop storage');
                    const item = items[index];
                    if (info.type === 'real' ? typeof item !== 'number'
                        : info.type === 'boolean' ? typeof item !== 'boolean'
                            : typeof item !== 'bigint' || !Number.isSafeInteger(Number(item))) return recordFallback('number-loop:unsafe-cell');
                    cells[index] = Number(item);
                }
                buffers[info.slot] = cells;
                if (readOnly) {
                    readBuffers.set(value, { revision, type, cells });
                    const diagnostics = currentDiagnostics();
                    if (diagnostics) {
                        diagnostics.numberLoopReadBuffers++;
                        diagnostics.numberLoopReadBufferCells += cells.length;
                    }
                }
            }
            sources[info.slot] = value;
            input[info.slot] = value;
            if (plan.destinations.has(name)) changes[info.slot] = new Uint8Array(items.length);
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.numberLoops++;
        if (diagnostics && plan.wideScalars.size) diagnostics.mixedIntegerLoops++;
        const result = run(input, buffers, changes, calls, (entered, values) => {
            // Overflow never enters publication. Ordinary errors and cancellation
            // commit exactly the preceding stores; no polling/callback may split
            // this publication from the scalar bindings below.
            for (const [name, info] of plan.destinations) {
                const dirty = changes[info.slot];
                const first = dirty.indexOf(1);
                if (first < 0) continue;
                const source = sources[info.slot];
                // Entry excluded retained selections: COW here can only copy
                // eager owned storage and cannot poll during publication.
                const copy = arrayForWrite(source);
                if (copy !== undefined) host.writer(name)(copy);
                const write = prepareScalarArrayWriter(borrowArrayStorage(copy ?? source), true);
                const cells = buffers[info.slot];
                if (info.type === 'integer' && writeInteger32Cells(copy ?? source, cells, dirty)) continue;
                for (let index = first; index < dirty.length; index++) {
                    if (dirty[index]) write(index, info.type === 'boolean' ? Boolean(cells[index]) : info.type === 'real' ? Number(cells[index]) : BigInt(cells[index]));
                }
            }
            // Declarations are private too: overflow must leave even empty-loop
            // binding contracts untouched before the original exact region runs.
            plan.vectorIterations.forEach(({ binding, slot }, index) => {
                if (entered[index]) host.declareIteration!(binding, sources[slot]);
            });
            host.executed?.();
            if (diagnostics) diagnostics.compiledLoops++;
            // First-write order preserves binding insertion order as well as the
            // final values; contracts were proved total before executing anything.
            for (const [, slot, value] of values.filter(([order]) => order > 0).sort((a, b) => a[0] - b[0])) {
                host.writer(names[slot])(rankValue(value, localTypes.get(names[slot]))!);
            }
        });
        if (!result) {
            if (diagnostics) diagnostics.numberLoopOverflows++;
            return undefined;
        }
        return completed(rankValue(result.value, result.type));
    } };
}
