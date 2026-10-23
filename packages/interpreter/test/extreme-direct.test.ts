import { describe, expect, it } from 'vitest';
import { isExpressionStatement, type Expression } from '@arrrank/language';
import { completed, type Evaluation } from '../src/execution.js';
import { Interpreter, isNativeFunction, parse, type RankValue } from '../src/index.js';
import { run } from './support.js';

describe('direct binary extrema', () => {
    it('completes builtin chains synchronously through ordinary calls', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nA = 3\nB = 7');
        const statement = parse('((A max B) min 5) + 1').statements[0];
        if (!isExpressionStatement(statement)) throw new Error('expected expression');
        const evaluator = (runtime as unknown as { expressions: { evaluate(expression: Expression): Evaluation<RankValue> } }).expressions;
        expect(evaluator.evaluate(statement.value)).toEqual(completed(6n));
        runtime.dispose();
    });

    it('rechecks bindings and numeric types on every call', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nfun A extreme B\n return (A max B) min 10\nend');
        const fn = runtime.variables.get('extreme');
        if (fn === undefined || !isNativeFunction(fn)) throw new Error('missing function');
        for (const [a, b, expected] of [[1n, 3n, 3n], [4.5, 2n, 4.5], [2n ** 100n, 3n, 10n]] as RankValue[][]) {
            expect(fn.call([a, b])).toBe(expected);
        }
        runtime.dispose();
    });

    it('retains lazy broadcasting, selectors and reductions', () => {
        expect(run('use numbers\nA = array 1 8\nB = A max 3\nB')).toBe('3 8');
        expect(run("use numbers\nA' = (array 1 0) // (array 1 0)\nB' = A max 3\nB 0")).toBe('3');
        expect(run('use numbers\nA = array 1 8\nA 0 max 3')).toBe('3');
        expect(run('use numbers\nA = array 1 8\nA max')).toBe('8');
    });

    it('keeps effectful operands on the resumable path without replay', () => {
        expect(run(`use numbers
use algo
fun Log visit V
 Log push V
 return V
end
Log = new queue
Answer = (Log visit 3) min (Log visit 2) max (Log visit 4)
Log`)).toBe('3 2 4');
        expect(run(`use numbers
fun N down
 if N equal 0
  return 0
 end
 return ((N - 1) down) max N
end
10000 down`)).toBe('10000');
    });

    it('keeps error order and skipped branches', () => {
        expect(() => run('use numbers\n("bad" max 1) min 2')).toThrow('expected numeric input');
        expect(run('1 max 2')).toBe('2');
        expect(run('use numbers\n1 max 2')).toBe('2');
        expect(run('if false\n X = Missing max 1\nend\n7')).toBe('7');
    });

    for (const name of ['min', 'max']) {
        for (const imports of ['', 'use numbers\n']) {
            it(`resolves custom ${name}custom as a binary call and an alias (${imports || 'no imports'})`, () => {
                const source = `${imports}fun A ${name}custom B\n return A * 10 + B\nend\n`;
                expect(run(source + `3 ${name}custom 4`)).toBe('34');
                expect(run(source + `op = ${name}custom\n3 op 4`)).toBe('34');
                expect(run(source + `3 ${name}custom 4 ${name}custom 5`)).toBe('345');
            });
        }
        it(`resolves local and parameter bindings of ${name}custom`, () => {
            expect(run(`fun X outer
 fun A ${name}custom B
  return A + B + X
 end
 return 3 ${name}custom 4
end
10 outer`)).toBe('17');
            const runtime = new Interpreter();
            runtime.execute(`fun A add B
 return A + B
end
fun invoke ${name}custom
 return 3 ${name}custom 4
end`);
            const invoke = runtime.variables.get('invoke');
            if (!invoke || !isNativeFunction(invoke)) throw new Error('missing function');
            expect(invoke.call([runtime.variables.get('add')!])).toBe(7n);
            runtime.dispose();
        });
        it(`uses ordinary postfix arity for custom ${name}custom, including array arguments`, () => {
            expect(run(`fun A ${name}custom B\n return B\nend\n(array 1 2) ${name}custom 99`)).toBe('99');
            expect(run(`fun A ${name}custom\n return 999\nend\n(array 1 2) ${name}custom`)).toBe('999');
        });
        it(`supports deep recursive calls to ${name}custom`, () => {
            expect(run(`fun A ${name}custom B
 if A equal 0
  return B
 end
 return ((A - 1) ${name}custom B) + 1
end
10000 ${name}custom 7`)).toBe('10007');
        });
    }

    it('rechecks function bindings in an already compiled binary call', () => {
        const runtime = new Interpreter();
        runtime.execute(`use numbers
fun A decide B
 return A max B
end
fun A replacement B
 return A + B
end`);
        const fn = runtime.variables.get('decide');
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
        runtime.execute('use numbers\nfun A replacement B\n return A + B\nend');
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
        expect(run("use numbers\nop = max\nA' = (array 1 0) // (array 1 0)\nB' = A op 3\nB 0")).toBe('3');
        expect(run('use numbers\nop = min\n(1 to 3) op 2')).toBe('1 2 2');
        expect(run('use numbers\nuse algo\nQ = new queue\nQ push 1\nQ push 8\nop = max\nQ op 3')).toBe('3 8');
        const runtime = new Interpreter();
        runtime.execute('use numbers');
        runtime.variables.set('Left', -0);
        runtime.variables.set('Right', 0n);
        expect(runtime.execute('Left min Right')).toBe(-0);
        expect(runtime.execute('op = min\nLeft op Right')).toBe(-0);
        runtime.dispose();
    });
});
