import { InterruptedError, RankError, isRankSequenceMask, type RankSequence, type RankValue, type SequencePlan } from '@arrrank/interpreter';

interface Read {
    readonly tape: Tape;
    /** Absent for the initial claim; otherwise the next unread value. */
    readonly position?: number;
    readonly start: number;
}

interface Entry {
    readonly reads: Read[];
    readonly outcome: { result: IteratorResult<RankValue> } | { error: unknown };
}

interface Boundary { readonly limit: bigint; readonly inclusive: boolean }

interface Consumption { readonly line: number; readonly position: number }

/**
 * How much the tapes of one session may keep for replay. Every value read
 * from a stored stream stays on its tape, and growing values such as
 * Fibonacci numbers fill memory quadratically; a phone's web view dies long
 * before the search would end. Past this budget reading is an error.
 */
export const REPLAY_BYTES = 64 * 1024 * 1024;

/** A rough size of a kept value: its digits for integers, a pointer otherwise. */
function retainedBytes(value: RankValue): number {
    if (typeof value === 'bigint') {
        const magnitude = value < 0n ? -value : value;
        return magnitude < 1n << 64n ? 16 : 16 + magnitude.toString(16).length / 2;
    }
    if (typeof value === 'string') return 16 + 2 * value.length;
    return 16;
}

interface Tape {
    readonly source: RankSequence;
    readonly entries: Entry[];
    /**
     * A stored native source such as `primes`. It computes the same values on
     * every pass, so it keeps a position rather than the values it yielded.
     */
    readonly resumable?: boolean;
    iterator?: IterableIterator<RankValue>;
    finished: boolean;
    /** Resumable tapes: the index the iterator yields next, and the last value read. */
    next?: number;
    last?: { readonly index: number; readonly entry: Entry };
    end?: number;
}

/** The REPL retains yielded values; ordinary file execution has no tape. */
export class SequenceReplay {
    private readonly tapes = new Set<Tape>();
    private readonly tapeOf = new WeakMap<SequencePlan, Tape>();
    private readonly consumed = new Map<Tape, Consumption[]>();
    private looking?: Map<Tape, Consumption>;
    private readonly collecting: Read[][] = [];
    private line = 0;
    private closed = false;
    private retained = 0;

    readonly wrap = (source: RankSequence): RankSequence => {
        const tape: Tape = { source, entries: [], finished: false };
        this.tapes.add(tape);
        const replay = this;
        const plan: SequencePlan = {
            ...source.plan,
            singlePass: true,
            *iterate() {
                const start = replay.claim(tape);
                for (let index = start; ; index++) {
                    const entry = replay.read(tape, index);
                    if ('error' in entry.outcome) throw entry.outcome.error;
                    if (entry.outcome.result.done) return;
                    replay.advance(tape, index + 1);
                    yield entry.outcome.result.value;
                }
            },
        };
        this.tapeOf.set(plan, tape);
        return { kind: 'sequence', plan };
    };

    /**
     * The values a stored generator has already yielded, without reading
     * another. Absent for sequences this replay keeps no tape of, and for
     * native sources, which keep a position rather than their values.
     */
    forced(sequence: RankSequence): { readonly items: RankValue[]; readonly finished: boolean } | undefined {
        const tape = this.tapeOf.get(sequence.plan);
        if (!tape || tape.resumable) return undefined;
        const items: RankValue[] = [];
        for (const { outcome } of tape.entries) {
            if ('result' in outcome && !outcome.result.done) items.push(outcome.result.value);
        }
        return { items, finished: tape.finished };
    }

    /** Store sources with numeric bounds as cursors; ranges and aliases retain their identity. */
    readonly store = (source: RankSequence): RankSequence => {
        if (source.plan.singlePass || isRankSequenceMask(source) || !source.plan.withUpperBound) return source;
        const tape: Tape = { source, entries: [], finished: false, resumable: true };
        this.tapes.add(tape);
        return { kind: 'sequence', plan: this.streamPlan(tape) };
    };

    private streamPlan(tape: Tape, upper?: Boundary, lower?: Boundary): SequencePlan {
        const replay = this;
        const plan: SequencePlan = {
            name: tape.source.plan.name,
            singlePass: true,
            size: upper ? { kind: 'unknown' } : tape.source.plan.size,
            *iterate() {
                replay.claim(tape);
                while (true) {
                    const index = replay.position(tape);
                    const entry = replay.read(tape, index);
                    if ('error' in entry.outcome) throw entry.outcome.error;
                    if (entry.outcome.result.done) return;
                    const value = entry.outcome.result.value;
                    if (upper || lower) {
                        if (typeof value !== 'bigint' && typeof value !== 'number') {
                            throw new RankError('sequence bounds expect numeric values', 'TypeError');
                        }
                        // Peek at the boundary without spending it. The next read starts here.
                        if (upper && (upper.inclusive ? value > upper.limit : value >= upper.limit)) return;
                        replay.advance(tape, index + 1);
                        if (lower && (lower.inclusive ? value < lower.limit : value <= lower.limit)) continue;
                    } else replay.advance(tape, index + 1);
                    yield value;
                }
            },
            withUpperBound(limit, inclusive) {
                const next = { limit, inclusive };
                const bound = !upper || limit < upper.limit ? next
                    : limit > upper.limit ? upper : { limit, inclusive: inclusive && upper.inclusive };
                return replay.streamPlan(tape, bound, lower);
            },
            withLowerBound(limit, inclusive) {
                const next = { limit, inclusive };
                const bound = !lower || limit > lower.limit ? next
                    : limit < lower.limit ? lower : { limit, inclusive: inclusive && lower.inclusive };
                return replay.streamPlan(tape, upper, bound);
            },
        };
        return plan;
    }

    /** Statements above this line keep their consumption; this line is rerunnable. */
    rewind(line: number): void {
        for (const [tape, history] of this.consumed) {
            const kept = history.filter(at => at.line < line);
            if (kept.length) this.consumed.set(tape, kept);
            else this.consumed.delete(tape);
        }
        this.line = line;
    }

    atLine(line: number): void { this.line = line; }

    /** Show the unread tail. Looking may advance bodies, but does not consume values. */
    preview<T>(show: () => T): T {
        const previous = this.looking;
        this.looking = new Map();
        try { return show(); }
        finally { this.looking = previous; }
    }

    private claim(tape: Tape, expected?: number): number {
        if (this.closed) throw new RankError('generator replay session is closed');
        const previous = this.looking?.get(tape) ?? this.consumed.get(tape)?.at(-1);
        const position = previous?.position ?? 0;
        this.checkPosition(tape, position, expected);
        const cached = tape.entries[position];
        const exhausted = tape.resumable ? tape.end !== undefined && position >= tape.end
            : cached && 'result' in cached.outcome && cached.outcome.result.done;
        if ((this.looking?.has(tape) && !tape.resumable) || (!this.looking && previous && (!tape.resumable || exhausted))) {
            throw new RankError(
                `sequence ${tape.source.plan.name} has already been consumed; return to its consuming line to replay it`,
                'ConsumedSequence',
            );
        }
        this.record(tape, position);
        // A generator can consume another generator. Replaying its cached output
        // must also restore those reads, even though its body does not run again.
        for (const reads of this.collecting) reads.push({ tape, start: position });
        return position;
    }

    private advance(tape: Tape, position: number, expected?: number): void {
        const start = this.position(tape);
        this.checkPosition(tape, start, expected);
        this.record(tape, position);
        for (const reads of this.collecting) reads.push({ tape, position, start });
    }

    private position(tape: Tape): number {
        return (this.looking?.get(tape) ?? this.consumed.get(tape)?.at(-1))?.position ?? 0;
    }

    private checkPosition(tape: Tape, position: number, expected?: number): void {
        if (expected !== undefined && position !== expected) {
            throw new RankError(
                `sequence ${tape.source.plan.name} advanced since this value was buffered; return to its consuming line to replay it`,
                'ConsumedSequence',
            );
        }
    }

    private record(tape: Tape, position: number): void {
        const at = { line: this.line, position };
        if (this.looking) {
            this.looking.set(tape, at);
            return;
        }
        const history = this.consumed.get(tape) ?? [];
        if (history.at(-1)?.line === this.line) history[history.length - 1] = at;
        else history.push(at);
        this.consumed.set(tape, history);
    }

    private read(tape: Tape, index: number): Entry {
        if (tape.resumable) return this.recompute(tape, index);
        const cached = tape.entries[index];
        if (cached) {
            for (const read of cached.reads) {
                if (read.position === undefined) this.claim(read.tape, read.start);
                else this.advance(read.tape, read.position, read.start);
            }
            return cached;
        }
        const reads: Read[] = [];
        this.collecting.push(reads);
        let entry: Entry;
        try {
            tape.iterator ??= tape.source.plan.iterate();
            const result = tape.iterator.next();
            tape.finished = Boolean(result.done);
            entry = { reads, outcome: { result } };
        } catch (error) {
            tape.finished = true;
            if (error instanceof InterruptedError) {
                // A cancelled generator is closed. Do not replay a host cancellation
                // as if the user pressed Ctrl-C again on the next command.
                tape.entries.push({ reads, outcome: { error: new RankError(
                    `sequence ${tape.source.plan.name} was interrupted; rerun its producing cell`,
                    'InterruptedSequence',
                ) } });
                throw error;
            }
            entry = { reads, outcome: { error } };
        } finally {
            this.collecting.pop();
        }
        tape.entries.push(entry);
        if ('result' in entry.outcome && !entry.outcome.result.done) {
            this.retained += retainedBytes(entry.outcome.result.value);
            if (this.retained > REPLAY_BYTES) {
                throw new RankError(
                    `sequence ${tape.source.plan.name} kept more than ${REPLAY_BYTES / 1024 / 1024} MB of values for replay; `
                    + 'bound the stored sequence with till, or read the source directly instead of through a name',
                    'MemoryLimit',
                );
            }
        }
        return entry;
    }

    /**
     * Read a native source at `index` without keeping its values. A read at
     * the last index returns the peeked value again; a read behind the
     * iterator, after a rewind, starts a fresh pass and skips to the index.
     */
    private recompute(tape: Tape, index: number): Entry {
        if (tape.last?.index === index) return tape.last.entry;
        if (tape.iterator === undefined || tape.next === undefined || index < tape.next) {
            if (!tape.finished) tape.iterator?.return?.();
            tape.iterator = tape.source.plan.iterate();
            tape.next = 0;
            tape.finished = false;
        }
        let entry: Entry;
        try {
            let result = tape.iterator.next();
            for (; tape.next < index && !result.done; tape.next++) result = tape.iterator.next();
            tape.next += 1;
            tape.finished = Boolean(result.done);
            if (result.done) tape.end = Math.min(tape.end ?? index, index);
            entry = { reads: [], outcome: { result } };
        } catch (error) {
            // The next read starts a fresh pass rather than resuming a broken one.
            tape.iterator = undefined;
            tape.finished = true;
            if (error instanceof InterruptedError) throw error;
            entry = { reads: [], outcome: { error } };
        }
        tape.last = { index, entry };
        return entry;
    }

    /** Abandoning a consumer keeps the body suspended until the session closes. */
    dispose(): void {
        let failure: unknown;
        for (const tape of this.tapes) {
            try {
                if (!tape.finished) tape.iterator?.return?.();
            } catch (error) { failure ??= error; }
            tape.entries.length = 0;
        }
        this.retained = 0;
        this.closed = true;
        this.tapes.clear();
        this.consumed.clear();
        if (failure !== undefined) throw failure;
    }
}
