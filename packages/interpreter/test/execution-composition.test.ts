import { describe, expect, it } from 'vitest';
import { completed, emit, ExecutionStack, flatMapResult, mapExecution, mapPair, runExecution, type Evaluation, type Execution } from '../src/execution.js';
import { Interpreter, parse, type RankValue } from '../src/index.js';
import { isExpressionStatement, type Expression } from 'rank-language';

describe('evaluation composition', () => {
    it('uses one continuation for two suspended arithmetic operands', () => {
        const left = (function* (): Execution<number> { return 2; })();
        const right = (function* (): Execution<number> { return 4; })();
        const task = mapPair(left, () => right, (a, b) => a + b);
        if ('done' in task) throw new Error('expected suspension');
        // Check the task identities, not timing: the right request must not
        // introduce an extra wrapper around the actual right operand.
        expect(task.next()).toEqual({ done: false, value: { task: left } });
        expect(task.next(2)).toEqual({ done: false, value: { task: right } });
        expect(task.next(4)).toEqual({ done: true, value: 6 });
        expect(mapPair(completed(2), () => completed(4), (a, b) => a + b)).toEqual(completed(6));
    });

    it('evaluates a pending right operand once after a completed left operand', () => {
        let reads = 0;
        const task = mapPair(completed(2), () => {
            reads++;
            return (function* (): Execution<number> { return 4; })();
        }, (a, b) => a + b);
        expect(runExecution(task)).toBe(6);
        expect(reads).toBe(1);
    });

    it('does not start the right operand when the left operand fails', () => {
        let reads = 0;
        const left = (function* (): Execution<number> { throw new Error('left failed'); })();
        const task = mapPair(left, () => { reads++; return completed(4); }, (a, b) => a + b);
        expect(() => runExecution(task)).toThrow('left failed');
        expect(reads).toBe(0);
    });

    it('collects completed operands without a task and resumes at the first pending operand', () => {
        expect(mapExecution([1, 2], value => completed(value * 2))).toEqual(completed([2, 4]));
        expect(mapExecution([], () => { throw new Error('empty'); })).toEqual(completed([]));
        const seen: number[] = [];
        const task = mapExecution([1, 2, 3], value => {
            seen.push(value);
            return value === 2
                ? (function* (): Execution<number> { yield* emit(9n); return value * 2; })()
                : completed(value * 2);
        });
        expect(seen).toEqual([1, 2]);
        const stack = new ExecutionStack(task);
        expect(stack.next()).toEqual({ done: false, value: 9n });
        expect(seen).toEqual([1, 2]);
        expect(stack.next()).toEqual({ done: true, value: [2, 4, 6] });
        expect(seen).toEqual([1, 2, 3]);
    });

    it('cancels operand collection without reading later operands', () => {
        const seen: number[] = [];
        let closed = false;
        const stack = new ExecutionStack(mapExecution([1, 2, 3], value => {
            seen.push(value);
            return value === 2 ? (function* (): Execution<number> {
                try { yield* emit(9n); return value; } finally { closed = true; }
            })() : completed(value);
        }));
        stack.next();
        stack.return([]);
        expect(seen).toEqual([1, 2]);
        expect(closed).toBe(true);
    });

    it('keeps builtin extrema synchronous but rechecks shadowed functions', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nA = array 3 7\nfun replacement X\n return X max + 10\nend');
        const statement = parse('A min').statements[0];
        if (!isExpressionStatement(statement)) throw new Error('expected expression');
        const evaluator = runtime as unknown as { evaluateTask(expression: Expression): Evaluation<RankValue> };
        expect(evaluator.evaluateTask(statement.value)).toEqual(completed(3n));
        runtime.variables.set('min', runtime.variables.get('replacement')!);
        expect(runExecution(evaluator.evaluateTask(statement.value))).toBe(17n);
        runtime.dispose();
    });

    it('keeps arithmetic over completed selectors on the synchronous path', () => {
        const runtime = new Interpreter();
        runtime.execute('A = array 2 3\nB = array 4 5');
        const statement = parse('A 0 * B 1').statements[0];
        if (!isExpressionStatement(statement)) throw new Error('expected expression');
        const evaluator = runtime as unknown as { evaluateTask(expression: Expression): Evaluation<RankValue> };
        expect(evaluator.evaluateTask(statement.value)).toEqual(completed(10n));
        runtime.dispose();
    });

    it('evaluates Rank call operands in order, once, and stops at the first error', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        runtime.execute(`use io
fun visit V
  V print
  return V
end`);
        expect(runtime.execute('(2 visit) * (3 visit)')).toBe(6n);
        expect(output).toEqual(['2', '3']);
        output.length = 0;
        expect(() => runtime.execute('((1 visit) / 0) + (2 visit)')).toThrow('division by zero');
        expect(output).toEqual(['1']);
        runtime.dispose();
    });

    it('keeps completed operands synchronous and evaluates the continuation once', () => {
        let calls = 0;
        const result = flatMapResult(completed(4), value => { calls++; return completed(value + 2); });
        expect(result).toEqual(completed(6));
        expect(calls).toBe(1);
    });

    it('waits for a suspended operand before invoking a suspended continuation', () => {
        const events: string[] = [];
        function* left(): Execution<number> {
            events.push('left');
            yield* emit(1n);
            events.push('left done');
            return 4;
        }
        const stack = new ExecutionStack(flatMapResult(left(), value => {
            events.push('right');
            return (function* (): Execution<number> { yield* emit(2n); return value + 2; })();
        }));
        expect(events).toEqual([]);
        expect(stack.next()).toEqual({ done: false, value: 1n });
        expect(events).toEqual(['left']);
        expect(stack.next()).toEqual({ done: false, value: 2n });
        expect(events).toEqual(['left', 'left done', 'right']);
        expect(stack.next()).toEqual({ done: true, value: 6 });
    });

    it('does not invoke a continuation after an operand fails or is cancelled', () => {
        let calls = 0;
        let closed = false;
        function* failing(): Execution<number> { throw new Error('left failed'); }
        const continuation = (value: number) => { calls++; return completed(value); };
        expect(() => runExecution(flatMapResult(failing(), continuation))).toThrow('left failed');
        function* waiting(): Execution<number> {
            try { yield* emit(1n); return 4; } finally { closed = true; }
        }
        const stack = new ExecutionStack(flatMapResult(waiting(), continuation));
        stack.next();
        stack.return(0);
        expect(closed).toBe(true);
        expect(calls).toBe(0);
    });
});
