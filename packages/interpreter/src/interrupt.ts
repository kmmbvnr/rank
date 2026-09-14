import { RankError } from './errors.js';

/** Host cancellation is not a catchable language failure. Normal finally blocks still run. */
export class InterruptedError extends RankError {
    constructor(activity?: string) {
        super(activity ? `Interrupted while ${activity}` : 'Interrupted', 'Interrupted');
    }
}

// Execution is synchronous; each worker owns its own module state. Include lazy
// preview/formatting in this scope, since it can do the actual computation.
let flag: Int32Array | undefined;
let ticks = 0;
let cancelled = false;
export interface PauseSnapshot {
    activity?: string;
    details?: Record<string, string>;
    state?: string;
    line?: number;
    source?: string;
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
    if (flag.length > 2 && Atomics.exchange(flag, 2, 0) === 2) stepping = 'line';
    const stop = stepping === 'line'
        || stepping === 'iteration' && (!targetLoop || next.depth < targetDepth
            || next.depth === targetDepth && (next.iteration === targetLoop || !next.loops.includes(targetLoop)))
        || stepping === 'main' && next.depth === 0 && next.topLevel && !next.iteration
        || stepping !== 'main' && breakpoints.some(item => item.line === next.line && item.source.trim() === next.source.trim());
    point = next;
    if (stop) Atomics.store(flag, 1, 1);
    checkInterrupt('before line ' + next.line);
}

let inspect: (() => string) | undefined;
let paused: ((snapshot: PauseSnapshot) => void) | undefined;
export function inspectionEnabled(): boolean { return paused !== undefined; }
export function inspectExecution(provider: () => string): void { if (paused) inspect = provider; }

export function withInterrupt<T>(signal: Int32Array, run: () => T, onPause?: (snapshot: PauseSnapshot) => void): T {
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
    flag = signal;
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

/** Only the interactive CLI worker installs a signal. File and pipe execution do not. */
export function interruptsEnabled(): boolean { return flag !== undefined; }

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
    if (Atomics.exchange(flag, 0, 0)) { cancelled = true; throw new InterruptedError(activity); }
    // A separate word keeps pause requests invisible to the native SQLite monitor.
    if (!cancelled && paused && flag.length > 1 && Atomics.load(flag, 1) === 1) {
        stepping = undefined;
        paused({ activity, details: details?.(), state: inspect?.(), line: point?.line, source: point?.source });
        while (Atomics.load(flag, 1) === 1 && !Atomics.load(flag, 0)) {
            Atomics.wait(flag, 1, 1);
        }
        const command = flag.length > 2 ? Atomics.exchange(flag, 2, 0) : 0;
        stepping = command === 2 ? 'line' : command === 3 ? 'iteration' : command === 4 ? 'main' : undefined;
        targetLoop = point?.loops.at(-1);
        targetDepth = point?.depth ?? 0;
        if (Atomics.exchange(flag, 0, 0)) { cancelled = true; throw new InterruptedError(activity); }
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
