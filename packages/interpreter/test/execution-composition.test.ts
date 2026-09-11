import { describe, expect, it } from 'vitest';
import { completed, emit, ExecutionStack, flatMapResult, runExecution, type Evaluation, type Execution } from '../src/execution.js';
import { Interpreter, parse, type RankValue } from '../src/index.js';
import { isExpressionStatement, type Expression } from 'rank-language';

describe('evaluation composition', () => {
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
