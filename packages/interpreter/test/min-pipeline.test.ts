import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

for (const compiled of [true, false]) describe(`min operands (compiled: ${compiled})`, () => {
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
        ['A min', '1'], ['A min B', '1 5'], ['A 0 min', '1'],
        ['M # 0 min', '1'], ['M 1 # min', '4'],
        ['M axis 1 (array 0 2) min', '1'], ['M # 0 min axis 0', '1'],
        ['M # 0 sum axis 0', '5'], ['M axis 1 (array 0 2) sum', '14'],
        ['A min B sum', '6'], ['A min B 0', '1 3'],
        ['A 0 min B 1', '1'], ['2 min 3 min 4', '2'],
        ['2 + 3 min 4', '4'], ['A min + 1', '2'], ['2 min -3', '-3'],
        ['A min .index', '0'], ['A min .indexed', '1 0'],
        ['(A min) equal 1', 'true'],
        ['(A reshape 1 2) matmul (B reshape 2 1)', '43'],
    ])('evaluates %s', (source, expected) => {
        expect(run(source)).toBe(expected);
    });

    it('uses the same operand sides for aliases, including separate REPL inputs', () => {
        expect(run('A 0 op', 'op = min')).toBe('1');
        expect(run('A op B', 'op = min')).toBe('1 5');
        expect(run('A op .index', 'op = min')).toBe('0');
        expect(run('M # 0 op axis 0', 'op = min')).toBe('1');
        expect(run('-2 positive 3', 'op = min\npositive = op abs')).toBe('2');
        const runtime = new Interpreter();
        try {
            runtime.execute('op = min\nA = array 1 8');
            expect(formatValue(runtime.execute('A 0 op')!)).toBe('1');
            expect(formatValue(runtime.execute('A op 3')!)).toBe('1 3');
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
        expect(() => run('A min B -1')).toThrow(/array index/);
    });

    it('evaluates the left selector and right operand once, in source order', () => {
        expect(run('Result = A (Log visit 0) min (Log visit 3)\nLog', `use algo
fun Log N visit
 Log push N
 return N
end
Log = new queue`)).toBe('0 3');
    });

    it('retains min as a combining function', () => {
        expect(run('A scan min')).toBe('1 1');
        expect(run('A reduce min')).toBe('1');
        expect(run('A B outer min')).toBe('1 1 3 5');
    });
});
