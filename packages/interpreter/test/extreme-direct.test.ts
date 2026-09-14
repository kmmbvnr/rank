import { describe, expect, it } from 'vitest';
import { isExpressionStatement, type Expression } from '@rank/language';
import { completed, type Evaluation } from '../src/execution.js';
import { Interpreter, isNativeFunction, parse, type RankValue } from '../src/index.js';
import { run } from './support.js';

describe('direct infix extrema', () => {
    it('completes builtin chains synchronously through ordinary calls', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nA = 3\nB = 7');
        const statement = parse('(A max B min 5) + 1').statements[0];
        if (!isExpressionStatement(statement)) throw new Error('expected expression');
        const evaluator = runtime as unknown as { evaluateTask(expression: Expression): Evaluation<RankValue> };
        expect(evaluator.evaluateTask(statement.value)).toEqual(completed(6n));
        runtime.dispose();
    });

    it('rechecks bindings and numeric types on every call', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nfun extreme A B\n return A max B min 10\nend');
        const fn = runtime.variables.get('extreme');
        if (fn === undefined || !isNativeFunction(fn)) throw new Error('missing function');
        for (const [a, b, expected] of [[1n, 3n, 3n], [4.5, 2n, 4.5], [2n ** 100n, 3n, 10n]] as RankValue[][]) {
            expect(fn.call([a, b])).toBe(expected);
        }
        runtime.dispose();
    });

    it('retains lazy broadcasting, selectors and reductions', () => {
        expect(run('use numbers\nA = array 1 8\nB = A max 3\nB')).toBe('3 8');
        expect(run('use numbers\nA = array 1 "later"\nB = A max 3\nB 0')).toBe('3');
        expect(run('use numbers\nA = array 1 8\nA 0 max 3')).toBe('3');
        expect(run('use numbers\nA = array 1 8\nA max')).toBe('8');
    });

    it('keeps effectful operands on the resumable path without replay', () => {
        expect(run(`use numbers
use algo
fun visit Log V
 Log push V
 return V
end
Log = queue
Answer = (Log 3 visit) min (Log 2 visit) max (Log 4 visit)
Log`)).toBe('3 2 4');
        expect(run(`use numbers
fun down N
 if N equal 0
  return 0
 end
 return ((N - 1) down) max N
end
10000 down`)).toBe('10000');
    });

    it('keeps error order and skipped branches', () => {
        expect(() => run('use numbers\n"bad" max 1 min Missing')).toThrow('expected numeric input');
        expect(() => run('1 max 2')).toThrow('use numbers');
        expect(run('use numbers\n1 2 max')).toBe('2');
        expect(run('if false\n X = Missing max 1\nend\n7')).toBe('7');
    });

    for (const name of ['min', 'max']) {
        for (const imports of ['', 'use numbers\n']) {
            it(`resolves shadowed ${name} in both forms and aliases (${imports || 'no imports'})`, () => {
                const source = `${imports}fun ${name} A B\n return A * 10 + B\nend\n`;
                expect(run(source + `3 4 ${name}`)).toBe('34');
                expect(run(source + `3 ${name} 4`)).toBe('34');
                expect(run(source + `Op = ${name}\n3 4 Op`)).toBe('34');
                expect(run(source + `3 ${name} 4 ${name} 5`)).toBe('345');
            });
        }
        it(`resolves local and parameter bindings of ${name}`, () => {
            expect(run(`fun outer X
 fun ${name} A B
  return A + B + X
 end
 return 3 ${name} 4
end
10 outer`)).toBe('17');
            const runtime = new Interpreter();
            runtime.execute(`fun add A B
 return A + B
end
fun invoke ${name}
 return 3 ${name} 4
end`);
            const invoke = runtime.variables.get('invoke');
            if (!invoke || !isNativeFunction(invoke)) throw new Error('missing function');
            expect(invoke.call([runtime.variables.get('add')!])).toBe(7n);
            runtime.dispose();
        });
        it(`uses ordinary postfix arity for shadowed ${name}, including array arguments`, () => {
            expect(run(`fun ${name} A B\n return B\nend\n(array 1 2) 99 ${name}`)).toBe('99');
            expect(run(`fun ${name} A\n return 999\nend\n(array 1 2) ${name}`)).toBe('999');
        });
        it(`supports deep recursive infix calls to ${name}`, () => {
            expect(run(`fun ${name} A B
 if A equal 0
  return B
 end
 return ((A - 1) ${name} B) + 1
end
10000 ${name} 7`)).toBe('10007');
        });
    }

    it('rechecks function bindings in an already compiled infix call', () => {
        const runtime = new Interpreter();
        runtime.execute(`use numbers
fun choose A B
 return A max B
end
fun replacement A B
 return A + B
end`);
        const fn = runtime.variables.get('choose');
        if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
        expect(fn.call([3n, 4n])).toBe(4n);
        runtime.variables.set('max', runtime.variables.get('replacement')!);
        expect(fn.call([3n, 4n])).toBe(7n);
        runtime.variables.delete('max');
        expect(fn.call([3n, 4n])).toBe(4n);
        runtime.dispose();
    });

    it('resolves the operation after the right operand, without replay', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nfun replacement A B\n return A + B\nend');
        let calls = 0;
        runtime.variables.set('change', {
            kind: 'function', name: 'change', arities: [1], monadicRank: 'all',
            call: args => {
                calls++;
                runtime.variables.set('max', runtime.variables.get('replacement')!);
                return args[0];
            },
        });
        expect(runtime.execute('3 max (4 change)')).toBe(7n);
        expect(calls).toBe(1);
        runtime.dispose();
    });

    it('gives aliases the same lazy broadcasting and tie representation', () => {
        expect(run('use numbers\nOp = max\nA = array 1 "later"\nB = A 3 Op\nB 0')).toBe('3');
        expect(run('use numbers\nuse ranges\nOp = min\n(1 to 3) 2 Op')).toBe('1 2 2');
        expect(run('use numbers\nuse algo\nQ = new queue\nQ push 1\nQ push 8\nOp = max\nQ 3 Op')).toBe('3 8');
        const runtime = new Interpreter();
        runtime.execute('use numbers');
        runtime.variables.set('Left', -0);
        runtime.variables.set('Right', 0n);
        expect(runtime.execute('Left min Right')).toBe(-0);
        expect(runtime.execute('Op = min\nLeft Right Op')).toBe(-0);
        runtime.dispose();
    });
});
