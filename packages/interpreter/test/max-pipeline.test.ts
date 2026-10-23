import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

for (const compiled of [true, false]) describe(`max operands (compiled: ${compiled})`, () => {
    const run = (expression: string, setup = '') => {
        const runtime = new Interpreter(() => {}, {
            scalarCompilation: compiled, blockCompilation: compiled,
            integerLoopCompilation: compiled, tensorFusion: compiled,
        });
        try {
            return formatValue(runtime.execute(`use numbers
use sequences
use linalg
A = array 1 8
B = array 3 5
M = (1 to 6) reshape 2 3
${setup}
${expression}`)!);
        } finally { runtime.dispose(); }
    };

    it.each([
        ['A max', '8'], ['A max B', '3 8'], ['A 0 max', '1'],
        ['M # 0 max', '4'], ['M 1 # max', '6'],
        ['M axis 1 (array 0 2) max', '6'], ['M # 0 max axis 0', '4'],
        ['M # 0 sum axis 0', '5'], ['M axis 1 (array 0 2) sum', '14'],
        ['A max B sum', '11'], ['A max B 0', '3 8'],
        ['A 0 max B 1', '5'], ['2 max 3 max 4', '4'],
        ['2 + 3 max 4', '5'], ['A max + 1', '9'], ['2 max -3', '2'],
        ['A max .index', '1'], ['A max .indexed', '8 1'],
        ['(A max) equal 8', 'true'],
        ['(A reshape 1 2) matmul (B reshape 2 1)', '43'],
    ])('evaluates %s', (source, expected) => {
        expect(run(source)).toBe(expected);
    });

    it('uses the same operand sides for aliases, including separate REPL inputs', () => {
        expect(run('A 0 op', 'op = max')).toBe('1');
        expect(run('A op B', 'op = max')).toBe('3 8');
        expect(run('A op .index', 'op = max')).toBe('1');
        expect(run('M # 0 op axis 0', 'op = max')).toBe('4');
        expect(run('-2 positive 3', 'op = max\npositive = op abs')).toBe('3');
        const runtime = new Interpreter();
        try {
            runtime.execute('op = max\nA = array 1 8');
            expect(formatValue(runtime.execute('A 0 op')!)).toBe('1');
            expect(formatValue(runtime.execute('A op 3')!)).toBe('3 8');
            expect(runtime.execute(`fun X probe
 fun A op B = A + B
 return X op 3
end
2 probe`)).toBe(5n);
        } finally { runtime.dispose(); }
    });

    it('passes a completed address to a user function', () => {
        expect(run('M # 0 identity', 'fun X identity = X')).toBe('1 4');
    });

    it('retains a signed selector on the right operand', () => {
        expect(() => run('A max B -1')).toThrow(/array index/);
    });

    it('evaluates the left selector and right operand once, in source order', () => {
        expect(run('Result = A (Log visit 0) max (Log visit 3)\nLog', `use algo
fun Log visit N
 Log push N
 return N
end
Log = new queue`)).toBe('0 3');
    });

    it('retains max as a combining function', () => {
        expect(run('A scan max')).toBe('1 8');
        expect(run('A reduce max')).toBe('8');
        expect(run('A B outer max')).toBe('3 5 8 8');
    });
});
