import { RankError } from './errors.js';

/** Host cancellation is not a catchable language failure. Normal finally blocks still run. */
export class InterruptedError extends RankError {
    constructor(activity?: string) {
        super(activity ? `Interrupted while ${activity}` : 'Interrupted', 'Interrupted');
    }
}

// Execution is synchronous; each worker owns its own module state. Include lazy
// preview/formatting in this scope, since it can do the actual computation.
export interface InterruptSignal {
    readonly length: number;
    load(index: number): number;
    store(index: number, value: number): void;
    exchange(index: number, value: number): number;
    wait(index: number, value: number): void;
}

let flag: InterruptSignal | undefined;
let ticks = 0;
let cancelled = false;
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
let point: DebugPoint | undefined;
let stepping: 'line' | 'iteration' | 'main' | undefined;
let targetLoop: object | undefined;
let targetDepth = 0;
let breakpoints: { source: string; line: number }[] = [];
export function setDebugBreakpoints(points: { source: string; line: number }[]): void { breakpoints = points; }

/** Called before a statement, or at the beginning of a loop iteration. */
export function debugExecutionPoint(next: DebugPoint): void {
    if (!paused || !flag || cancelled) return;
    if (flag.length > 2 && flag.load(2) !== 0) {
        const cmd = flag.exchange(2, 0);
        if (cmd === 2) stepping = 'line';
        else if (cmd === 5) { detachInspection(); return; }
    }
    const stop = stepping === 'line'
        || stepping === 'iteration' && (!targetLoop || next.depth < targetDepth
            || next.depth === targetDepth && (next.iteration === targetLoop || !next.loops.includes(targetLoop)))
        || stepping === 'main' && next.depth === 0 && next.topLevel && !next.iteration
        || stepping !== 'main' && breakpoints.some(item => item.line === next.line && item.source.trim() === next.source.trim());
    point = next;
    if (stop) flag.store(1, 1);
    checkInterrupt('before line ' + next.line);
}

type Inspection = Pick<PauseSnapshot, 'state' | 'bindings'>;
let inspect: (() => string | Inspection) | undefined;
let paused: ((snapshot: PauseSnapshot) => void) | undefined;
export function inspectionEnabled(): boolean { return paused !== undefined; }
export function inspectExecution(provider: () => string | Inspection): void { if (paused) inspect = provider; }

export function detachInspection(): void {
    paused = undefined;
    inspect = undefined;
    stepping = undefined;
    targetLoop = undefined;
    targetDepth = 0;
    point = undefined;
}

export function withInterrupt<T>(signal: Int32Array | InterruptSignal, run: () => T, onPause?: (snapshot: PauseSnapshot) => void): T {
    const previousCancelled = cancelled;
    cancelled = false;
    const previousPoint = point;
    const previousStepping = stepping;
    const previousLoop = targetLoop;
    const previousDepth = targetDepth;
    point = undefined;
    stepping = undefined;
    targetLoop = undefined;
    const previous = flag;
    const previousTicks = ticks;
    const previousPause = paused;
    const previousInspect = inspect;
    paused = onPause;
    inspect = undefined;
    flag = signal instanceof Int32Array ? {
        length: signal.length,
        load: index => Atomics.load(signal, index),
        store: (index, value) => { Atomics.store(signal, index, value); },
        exchange: (index, value) => Atomics.exchange(signal, index, value),
        wait: (index, value) => { Atomics.wait(signal, index, value); },
    } : signal;
    ticks = 0;
    try { return run(); }
    finally {
        cancelled = previousCancelled;
        targetDepth = previousDepth;
        point = previousPoint;
        stepping = previousStepping;
        targetLoop = previousLoop;
        flag = previous;
        ticks = previousTicks;
        paused = previousPause;
        inspect = previousInspect;
    }
}

/** Interactive workers install a signal. File and pipe execution do not. */
export function interruptsEnabled(): boolean { return flag !== undefined; }

/**
 * A look that ran out of reading before it found the next item. Not a
 * RankError: a program's `catch` must not swallow the host giving up.
 */
export class DemandBudgetExhausted extends Error {}

let budget: number | undefined;

/**
 * Bound how many items `run` may pass over. A selection may skip without end on
 * the way to its next item, as `Fib (Fib less 10)` does after 8; a preview has
 * to give up on it instead of waiting forever. Slow work that does produce
 * items, such as a factor search, is not counted: Ctrl-C stops that.
 */
export function withDemandBudget<T>(limit: number, run: () => T): T {
    const previous = budget;
    budget = limit;
    try { return run(); }
    finally { budget = previous; }
}

/** A selection read an item it did not keep. */
export function passOver(): void {
    if (budget !== undefined && --budget < 0) throw new DemandBudgetExhausted();
}

export function checkpoint(activity?: string, work = 1, details?: () => Record<string, string>): void {
    if (!flag) return;
    ticks += work;
    if (ticks < 1024) return;
    ticks = 0;
    checkInterrupt(activity, details);
}

/** Check at host boundaries even when the operation had no cooperative loop. */
export function checkInterrupt(activity?: string, details?: () => Record<string, string>): void {
    if (!flag) return;
    if (flag.exchange(0, 0)) { cancelled = true; throw new InterruptedError(activity); }
    if (flag.length > 2 && flag.load(2) === 5) {
        flag.exchange(2, 0);
        detachInspection();
    }
    // A separate word keeps pause requests invisible to the native SQLite monitor.
    if (!cancelled && paused && flag.length > 1 && flag.load(1) === 1) {
        stepping = undefined;
        const inspected = inspect?.();
        paused({ activity, details: details?.(), ...(typeof inspected === 'string' ? { state: inspected } : inspected),
            line: point?.line, source: point?.source });
        while (flag.load(1) === 1 && !flag.load(0)) {
            flag.wait(1, 1);
        }
        const command = flag.length > 2 ? flag.exchange(2, 0) : 0;
        if (command === 5) {
            detachInspection();
            if (flag.exchange(0, 0)) { cancelled = true; throw new InterruptedError(activity); }
            return;
        }
        stepping = command === 2 ? 'line' : command === 3 ? 'iteration' : command === 4 ? 'main' : undefined;
        targetLoop = point?.loops.at(-1);
        targetDepth = point?.depth ?? 0;
        if (flag.exchange(0, 0)) { cancelled = true; throw new InterruptedError(activity); }
    }
}

/** Keep the ordinary callback/iterator when no interactive host installed a signal. */
export function interruptibleCallback<A extends unknown[], R>(
    operation: (...args: A) => R, activity: string,
): (...args: A) => R {
    if (!flag) return operation;
    return (...args) => { checkpoint(activity); return operation(...args); };
}

export function interruptibleValues<T>(values: Iterable<T>, activity: string): Iterable<T> {
    if (!flag) return values;
    return { *[Symbol.iterator]() {
        for (const value of values) {
            checkpoint(activity);
            yield value;
        }
    } };
}
