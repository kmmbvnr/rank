import { RankError } from './errors.js';

/** Host cancellation is not a catchable language failure. Normal finally blocks still run. */
export class InterruptedError extends RankError {
    constructor(activity?: string) {
        super(activity ? `Interrupted while ${activity}` : 'Interrupted', 'Interrupted');
    }
}

// Execution scopes are synchronous. Wrap lazy consumption and formatting,
// rather than only creation: that is when callbacks perform their work.
export interface InterruptSignal {
    readonly length: number;
    load(index: number): number;
    store(index: number, value: number): void;
    exchange(index: number, value: number): number;
    wait(index: number, value: number): void;
}
export interface PauseSnapshot {
    activity?: string;
    details?: Record<string, string>;
    state?: string;
    line?: number;
    source?: string;
    bindings?: { name: string; read?: boolean; write?: boolean }[];
}
interface DebugPoint {
    source: string;
    line: number;
    loops: object[];
    depth: number;
    iteration?: object;
    topLevel: boolean;
}
/** Persistent debugger configuration owned by a host session, shared with its modules. */
export class DebugSession {
    private points: readonly { source: string; line: number }[] = [];
    setBreakpoints(points: readonly { source: string; line: number }[]): void {
        this.points = points.map(point => ({ ...point }));
    }
    stopsAt(source: string, line: number): boolean {
        return this.points.some(point => point.line === line && point.source.trim() === source.trim());
    }
}
interface DebugRun {
    session: DebugSession;
    point?: DebugPoint;
    stepping?: 'line' | 'iteration' | 'main';
    targetLoop?: object;
    targetDepth: number;
}

/** Only the active synchronous run is ambient; nested runs restore one record. */
interface InterruptState {
    flag?: InterruptSignal;
    opaquePolling: boolean;
    ticks: number;
    cancelled: boolean;
    debug: DebugRun;
    inspect?: () => string | Inspection;
    paused?: (snapshot: PauseSnapshot) => void;
    keyedCollections?: Set<object>;
    budget?: { remaining: number };
}
function interruptState(session = new DebugSession()): InterruptState {
    return { opaquePolling: true, ticks: 0, cancelled: false, debug: { session, targetDepth: 0 } };
}
let state = interruptState();

/** Called before a statement, or at the beginning of a loop iteration. */
export function debugExecutionPoint(next: DebugPoint): void {
    if (!state.paused || !state.flag || state.cancelled) return;
    if (state.flag.length > 2 && state.flag.load(2) !== 0) {
        const cmd = state.flag.exchange(2, 0);
        if (cmd === 2) state.debug.stepping = 'line';
        else if (cmd === 5) { detachInspection(); return; }
    }
    const stop = state.debug.stepping === 'line'
        || state.debug.stepping === 'iteration' && (!state.debug.targetLoop || next.depth < state.debug.targetDepth
            || next.depth === state.debug.targetDepth && (next.iteration === state.debug.targetLoop || !next.loops.includes(state.debug.targetLoop)))
        || state.debug.stepping === 'main' && next.depth === 0 && next.topLevel && !next.iteration
        || state.debug.stepping !== 'main' && state.debug.session.stopsAt(next.source, next.line);
    state.debug.point = next;
    if (stop) state.flag.store(1, 1);
    checkInterrupt('before line ' + next.line);
}

type Inspection = Pick<PauseSnapshot, 'state' | 'bindings'>;
export function inspectionEnabled(): boolean { return state.paused !== undefined; }
export function trackKeyedCollection(collection: object): void { state.keyedCollections?.add(collection); }
export function trackedKeyedCollections(): Iterable<object> { return state.keyedCollections ?? []; }
export function inspectExecution(provider: () => string | Inspection): void { if (state.paused) state.inspect = provider; }

export function detachInspection(): void {
    state.paused = undefined;
    state.keyedCollections = undefined;
    state.inspect = undefined;
    state.debug.stepping = undefined;
    state.debug.targetLoop = undefined;
    state.debug.targetDepth = 0;
    state.debug.point = undefined;
}

export function withInterrupt<T>(signal: Int32Array | InterruptSignal, run: () => T, onPause?: (snapshot: PauseSnapshot) => void, session = new DebugSession()): T {
    const previous = state;
    state = interruptState(session);
    state.budget = previous.budget;
    state.opaquePolling = signal instanceof Int32Array;
    state.keyedCollections = onPause ? new Set() : undefined;
    state.paused = onPause;
    state.flag = signal instanceof Int32Array ? {
        length: signal.length,
        load: index => Atomics.load(signal, index),
        store: (index, value) => { Atomics.store(signal, index, value); },
        exchange: (index, value) => Atomics.exchange(signal, index, value),
        wait: (index, value) => { Atomics.wait(signal, index, value); },
    } : signal;
    try { return run(); }
    finally { state = previous; }
}

/** Interactive workers install a signal. File and pipe execution do not. */
export function interruptsEnabled(): boolean { return state.flag !== undefined; }

/** Atomics-only cancellation cannot observe private loop registers. Inspection
 * and arbitrary host polling callbacks retain per-assignment publication. */
export function privateLoopPolling(): boolean { return state.opaquePolling && !state.paused; }

/**
 * A look that ran out of reading before it found the next item. Not a
 * RankError: a program's `catch` must not swallow the host giving up.
 */
export class DemandBudgetExhausted extends Error {}

/**
 * Bound how many items `run` may pass over. A selection may skip without end on
 * the way to its next item, as `Fib (Fib less 10)` does after 8; a preview has
 * to give up on it instead of waiting forever. Slow work that does produce
 * items, such as a factor search, is not counted: Ctrl-C stops that.
 */
export function withDemandBudget<T>(limit: number, run: () => T): T {
    const scope = state;
    const previous = scope.budget;
    scope.budget = { remaining: limit };
    try { return run(); }
    finally { scope.budget = previous; }
}

/** A selection read an item it did not keep. */
export function passOver(): void {
    if (state.budget !== undefined && --state.budget.remaining < 0) throw new DemandBudgetExhausted();
}

export function checkpoint(activity?: string, work = 1, details?: () => Record<string, string>): void {
    if (!state.flag) return;
    state.ticks += work;
    if (state.ticks < 1024) return;
    state.ticks = 0;
    checkInterrupt(activity, details);
}

/** Check at host boundaries even when the operation had no cooperative loop. */
export function checkInterrupt(activity?: string, details?: () => Record<string, string>): void {
    if (!state.flag) return;
    if (state.flag.exchange(0, 0)) { state.cancelled = true; throw new InterruptedError(activity); }
    if (state.flag.length > 2 && state.flag.load(2) === 5) {
        state.flag.exchange(2, 0);
        detachInspection();
    }
    // A separate word keeps pause requests invisible to the native SQLite monitor.
    if (!state.cancelled && state.paused && state.flag.length > 1 && state.flag.load(1) === 1) {
        state.debug.stepping = undefined;
        const inspected = state.inspect?.();
        state.paused({ activity, details: details?.(), ...(typeof inspected === 'string' ? { state: inspected } : inspected),
            line: state.debug.point?.line, source: state.debug.point?.source });
        while (state.flag.load(1) === 1 && !state.flag.load(0)) {
            state.flag.wait(1, 1);
        }
        const command = state.flag.length > 2 ? state.flag.exchange(2, 0) : 0;
        if (command === 5) {
            detachInspection();
            if (state.flag.exchange(0, 0)) { state.cancelled = true; throw new InterruptedError(activity); }
            return;
        }
        state.debug.stepping = command === 2 ? 'line' : command === 3 ? 'iteration' : command === 4 ? 'main' : undefined;
        state.debug.targetLoop = state.debug.point?.loops.at(-1);
        state.debug.targetDepth = state.debug.point?.depth ?? 0;
        if (state.flag.exchange(0, 0)) { state.cancelled = true; throw new InterruptedError(activity); }
    }
}

/** Keep the ordinary callback/iterator when no interactive host installed a signal. */
export function interruptibleCallback<A extends unknown[], R>(
    operation: (...args: A) => R, activity: string,
): (...args: A) => R {
    if (!state.flag) return operation;
    return (...args) => { checkpoint(activity); return operation(...args); };
}

export function interruptibleValues<T>(values: Iterable<T>, activity: string): Iterable<T> {
    if (!state.flag) return values;
    return { *[Symbol.iterator]() {
        for (const value of values) {
            checkpoint(activity);
            yield value;
        }
    } };
}
