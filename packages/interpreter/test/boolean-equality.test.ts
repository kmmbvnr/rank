import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { RankError } from '../src/errors.js';
import { equalMembershipValues, equalValues } from '../src/value-comparison.js';

for (const compilation of [false, true]) describe(`boolean equality (compiled=${compilation})`, () => {
    function run(source: string): string {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    }

    function rejects(source: string): void {
        try {
            run(source);
            expect.fail('expected a boolean/numeric comparison error');
        }
        catch (error) {
            expect(error).toBeInstanceOf(RankError);
            expect((error as RankError).rankKind).toBe('TypeError');
            expect((error as RankError).message).toMatch(/cannot compare boolean and numeric values/);
        }
    }

    it('rejects both equality operators between booleans and integers or reals in either order', () => {
        for (const boolean of ['true', 'false']) {
            for (const numeric of ['0', '1', '0.0', '1.0']) {
                for (const operator of ['equal', 'not equal']) {
                    rejects(`${boolean} ${operator} ${numeric}`);
                    rejects(`${numeric} ${operator} ${boolean}`);
                }
            }
        }
    });

    it('rejects elementwise, sequence and whole-cell comparisons', () => {
        rejects('(array true false) equal 0');
        rejects('1 not equal (array true false)');
        rejects('(1 to 3) equal true');
        rejects('use sequences\n(array true false) (array 1 0) equal rank 1');
        rejects('use sequences\n(array 1 0) (array true false) not equal rank 1');
        rejects('(tuple true "x") equal (tuple 1 "x")');
        rejects('A = record\n  .Flag = true\nend\nB = record\n  .Flag = 1\nend\nA equal B');
    });

    it('reports the error in loop conditions and function calls', () => {
        rejects(`Up = 3 less 5
for I in 1 to 3
  if Up equal 0
    break
  end
end
0`);
        rejects(`fun Flag checkflag
  return Flag equal 1
end
true checkflag`);
    });

    it('retains boolean and mixed numeric equality and explicit conversion', () => {
        expect(run('array (true equal true) (false equal true) (true not equal false)')).toBe('true false true');
        expect(run('array (1 equal 1.0) (0 not equal 1.0) (9007199254740993 equal 9007199254740992.0)'))
            .toBe('true true false');
        expect(run('use numbers\n(true integer) equal 1')).toBe('true');
    });

    it('distinguishes inline mask selection from boolean counting and summing', () => {
        const setup = 'use sequences\nSv = array shape 5 fill 0\nSv 2 = 1\n';
        expect(run(setup + '(Sv equal 0) sum')).toBe('0');
        expect(run(setup + '(Sv equal 0) count')).toBe('4');
        expect(() => run(setup + 'Mask = Sv equal 0\nMask sum')).toThrow('expected numeric input');
        expect(() => run('(array true false) sum')).toThrow('expected numeric input');
    });
});

it('preserves heterogeneous membership equality, including nested values', () => {
    expect(equalMembershipValues(true, 1n)).toBe(false);
    const left = { kind: 'tuple' as const, items: [true] };
    const right = { kind: 'tuple' as const, items: [1n] };
    expect(equalMembershipValues(left, right)).toBe(false);
    expect(() => equalValues(left, right)).toThrow(/cannot compare boolean and numeric values/);
});
