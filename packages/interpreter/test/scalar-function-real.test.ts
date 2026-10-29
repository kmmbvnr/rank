import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { isNativeFunction, isRankArray, type RankValue } from '../src/value.js';

function run(compiled: boolean, body: string, args: RankValue[]) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled,
        onScalarFunctionExecuted: () => kernels++ });
    try {
        runtime.execute(`fun X probe Y\n${body}\nend`);
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
    it('compiles integer conversion without changing truncation or domain errors', () => {
        for (const value of [2.75, -2.75, -0, 2 ** 60, Infinity, -Infinity, NaN, 10n ** 50n, true, false, '-123', 'oops']) {
            const args = [value, 0n];
            let reference;
            try { reference = run(false, 'return X integer', args); }
            catch (error) {
                expect(() => run(true, 'return X integer', args)).toThrow((error as Error).message);
                continue;
            }
            expect(run(true, 'return X integer', args)).toEqual({ ...reference, kernels: 1 });
        }
    });

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


describe('guarded numeric builtins in scalar helpers', () => {
    function evaluate(compiled: boolean, operation: string, value: RankValue, typed = true) {
        let kernels = 0;
        const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled, typedNativeCalls: typed,
            onScalarFunctionExecuted: () => kernels++ });
        try {
            runtime.execute(`use numbers\nfun X probe\n return X ${operation}\nend`);
            const fn = runtime.variables.get('probe');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
            try {
                const result = fn.call([value]);
                return { value: isRankArray(result) ? formatValue(result) : result, kernels };
            }
            catch (error) {
                if (!(error instanceof RankError)) throw error;
                return { error: error.format(), kernels };
            }
        } finally { runtime.dispose(); }
    }

    it.each(['abs', 'sqrt', 'exp'])('preserves %s results, domains and unsupported inputs', operation => {
        for (const value of [-0, 0, -2.5, 4.0, NaN, Infinity, -Infinity, 0n, 4n, -1n, 10n ** 400n, true, '4']) {
            const reference = evaluate(false, operation, value);
            const compiled = evaluate(true, operation, value);
            expect({ ...compiled, kernels: 0 }).toEqual({ ...reference, kernels: 0 });
            expect(evaluate(true, operation, value, false)).toEqual(compiled);
            if (!('error' in compiled) && (typeof value === 'number' || operation !== 'abs' && typeof value === 'bigint'))
                expect(compiled.kernels).toBe(1);
        }
    });

    it.each(['abs', 'sqrt', 'exp'])('rechecks the %s binding after warming a helper', operation => {
        for (const compiled of [false, true]) {
            let kernels = 0;
            const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled, onScalarFunctionExecuted: () => kernels++ });
            try {
                runtime.execute(`use numbers\nfun X probe\n return X ${operation}\nend`);
                const fn = runtime.variables.get('probe');
                if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
                fn.call([4.0]);
                expect(kernels).toBe(compiled ? 1 : 0);
                runtime.variables.set(operation, native('replacement', 1, () => 7.5));
                expect(fn.call([4.0])).toBe(7.5);
                expect(kernels).toBe(compiled ? 1 : 0);
            } finally { runtime.dispose(); }
        }
    });
});
