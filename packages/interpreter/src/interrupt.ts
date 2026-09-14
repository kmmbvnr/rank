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

export function withInterrupt<T>(signal: Int32Array, run: () => T): T {
    const previous = flag;
    const previousTicks = ticks;
    flag = signal;
    ticks = 0;
    try { return run(); }
    finally { flag = previous; ticks = previousTicks; }
}

/** Only the interactive CLI worker installs a signal. File and pipe execution do not. */
export function interruptsEnabled(): boolean { return flag !== undefined; }

export function checkpoint(activity?: string, work = 1): void {
    if (!flag) return;
    ticks += work;
    if (ticks < 1024) return;
    ticks = 0;
    checkInterrupt(activity);
}

/** Check at host boundaries even when the operation had no cooperative loop. */
export function checkInterrupt(activity?: string): void {
    if (flag && Atomics.exchange(flag, 0, 0)) throw new InterruptedError(activity);
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
