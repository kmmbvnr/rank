import { RankError } from './errors.js';
import type { RankValue } from './value.js';

type Request = { readonly task: Execution<unknown> } | { readonly value: RankValue };

// Suspending a child hands control back to the driver, rather than delegating
// through JavaScript's call stack. The result type is restored by resume().
export type Execution<T> = Generator<Request, T, unknown>;

export interface Completed<T> {
    readonly done: true;
    readonly value: T;
}

export type Evaluation<T> = Execution<T> | Completed<T>;

export function normalizeStackError(error: unknown): unknown {
    return error instanceof RangeError && error.message.includes('call stack')
        ? new RankError('nested host callbacks exceeded the JavaScript stack', 'RecursionLimit')
        : error;
}

export function completed<T>(value: T): Completed<T> {
    return { done: true, value };
}

export function mapResult<T, R>(task: Evaluation<T>, operation: (value: T) => R): Evaluation<R> {
    if ('done' in task) return completed(operation(task.value));
    return (function* (): Execution<R> {
        return operation(yield* resume(task));
    })();
}

export function flatMapResult<T, R>(task: Evaluation<T>, operation: (value: T) => Evaluation<R>): Evaluation<R> {
    if ('done' in task) return operation(task.value);
    return (function* (): Execution<R> {
        return yield* resume(operation(yield* resume(task)));
    })();
}

export function* resume<T>(task: Evaluation<T>): Execution<T> {
    if ('done' in task) return task.value;
    return (yield { task }) as T;
}

export function* emit(value: RankValue): Execution<void> {
    yield { value };
}

export function mapExecution<T, R>(
    values: readonly T[],
    operation: (value: T) => Evaluation<R>,
): Evaluation<R[]> {
    const results: R[] = [];
    for (let index = 0; index < values.length; index++) {
        const task = operation(values[index]);
        if ('done' in task) results.push(task.value);
        else return (function* (): Execution<R[]> {
            results.push(yield* resume(task));
            for (index++; index < values.length; index++) {
                results.push(yield* resume(operation(values[index])));
            }
            return results;
        })();
    }
    return completed(results);
}

interface Frame {
    readonly task: Execution<unknown>;
    returning: boolean;
}

// Both ordinary functions and suspended Rank generators use this driver.
// Cancellation unwinds every suspended task, including finally blocks that
// themselves call Rank functions.
export class ExecutionStack<T> implements Generator<RankValue, T, unknown> {
    private readonly stack: Frame[];

    constructor(task: Evaluation<T>) {
        this.stack = [{ task: 'done' in task ? resume(task) : task, returning: false }];
    }

    [Symbol.iterator](): Generator<RankValue, T, unknown> { return this; }

    next(value?: unknown): IteratorResult<RankValue, T> {
        return this.advance('next', value);
    }

    throw(error: unknown): IteratorResult<RankValue, T> {
        return this.advance('throw', error);
    }

    return(value: T): IteratorResult<RankValue, T> {
        for (const frame of this.stack) frame.returning = true;
        return this.advance('return', value);
    }

    private advance(
        method: 'next' | 'throw' | 'return',
        value: unknown,
    ): IteratorResult<RankValue, T> {
        while (this.stack.length > 0) {
            const frame = this.stack[this.stack.length - 1];
            let result: IteratorResult<Request, unknown>;
            try {
                if (method !== 'next') frame.returning = false;
                result = frame.task[method](value);
            } catch (error) {
                this.stack.pop();
                method = 'throw';
                // Lazy sequence/tensor callbacks use a synchronous host API.
                // If those callbacks themselves nest, report the host boundary
                // as a Rank error rather than leaking a JavaScript stack trace.
                value = normalizeStackError(error);
                continue;
            }
            if (result.done) {
                this.stack.pop();
                value = result.value;
                method = this.stack.at(-1)?.returning ? 'return' : 'next';
            } else if ('task' in result.value) {
                this.stack.push({ task: result.value.task, returning: false });
                method = 'next';
                value = undefined;
            } else {
                return { done: false, value: result.value.value };
            }
        }
        if (method === 'throw') throw value;
        return { done: true, value: value as T };
    }
}

export function runExecution<T>(task: Evaluation<T>): T {
    if ('done' in task) return task.value;
    const execution = new ExecutionStack(task);
    const result = execution.next();
    if (!result.done) {
        execution.return(undefined as T);
        throw new RankError('yield is only valid inside a generator function');
    }
    return result.value;
}
