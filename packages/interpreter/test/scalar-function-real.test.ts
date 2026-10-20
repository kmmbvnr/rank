import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { isNativeFunction, type RankValue } from '../src/value.js';

function run(compiled: boolean, body: string, args: RankValue[]) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled,
        onScalarFunctionExecuted: () => kernels++ });
    try {
        runtime.execute(`fun X Y probe\n${body}\nend`);
        const fn = runtime.variables.get('probe');
        if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
        return { value: fn.call(args), kernels };
    } finally { runtime.dispose(); }
}

const numericPairs: [bigint | number, bigint | number][] = [
    [2.5, 3.25], [-0, 0], [0, -0], [Infinity, Infinity], [-Infinity, 2],
    [NaN, 1], [1, NaN], [Number.MAX_VALUE, 2], [2n ** 60n + 1n, 2 ** 60],
    [2n, 0.5], [0.5, 2n], [10n ** 400n, -Infinity],
];

describe('real scalar function kernels', () => {
    for (const operator of ['+', '-', '*', 'less', 'greater', 'at most', 'at least']) {
        it(`matches ordinary ${operator} for matching and mixed numeric operands`, () => {
            for (const pair of numericPairs) {
                const source = `return X ${operator} Y`;
                const reference = run(false, source, pair);
                const compiled = run(true, source, pair);
                expect(Object.is(compiled.value, reference.value), `${operator}: ${pair}`).toBe(true);
                expect(compiled.kernels).toBe(1);
            }
        });
    }

    it.each(['equal', 'not equal'])('compares mixed types exactly and keeps IEEE real %s behavior', operator => {
        for (const pair of numericPairs) {
            const source = `return X ${operator} Y`;
            expect(run(true, source, pair)).toEqual({ ...run(false, source, pair), kernels: 1 });
        }
    });

    it.each(['+', '-'])('preserves real unary %s including signed zero', operator => {
        for (const value of [0, -0, 1.5, Infinity, -Infinity, NaN]) {
            const source = `return ${operator}X`;
            const reference = run(false, source, [value, 0]);
            const compiled = run(true, source, [value, 0]);
            expect(Object.is(compiled.value, reference.value)).toBe(true);
            expect(compiled.kernels).toBe(1);
        }
    });

    it('lowers real literals and compound assignments in one specialization', () => {
        for (const source of ['return X + 0.5', 'X += Y\nreturn X', 'X *= Y\nreturn X']) {
            const reference = run(false, source, [1.5, 2.5]);
            expect(run(true, source, [1.5, 2.5])).toEqual({ ...reference, kernels: 1 });
        }
    });

    it.each(['/', '**'])('preserves numeric results and domain errors for %s', operator => {
        const pairs = operator === '/' ? [...numericPairs, [1n, 0n], [1, -0]]
            : [...numericPairs.filter(pair => pair.some(value => typeof value === 'number')),
                [0, -1n], [-2n, 0.5], [0.5, -2n], [-0, 3n]];
        for (const pair of pairs) {
            const args = pair as RankValue[];
            let reference;
            try { reference = run(false, `return X ${operator} Y`, args); }
            catch (error) {
                expect(() => run(true, `return X ${operator} Y`, args)).toThrow((error as Error).message);
                continue;
            }
            const compiled = run(true, `return X ${operator} Y`, args);
            expect(Object.is(compiled.value, reference.value), `${operator}: ${pair}`).toBe(true);
            expect(compiled.kernels).toBe(1);
        }
    });
});
