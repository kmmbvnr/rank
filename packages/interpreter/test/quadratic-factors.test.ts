import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/343_fractional.ra', import.meta.url), 'utf8');
function largestFactor(value: number): bigint {
    let largest = 1;
    for (let divisor = 2; divisor * divisor <= value; divisor++) {
        while (value % divisor === 0) { largest = divisor; value /= divisor; }
    }
    return BigInt(value > 1 ? value : largest);
}

describe.each([false, true])('Euler 343 bulk factorization (compilation=%s)', compilation => {
    it('passes the companion Rank tests', () => {
        const runtime = new Interpreter(() => {}, {
            compilation, testing: true,
            loadModule: specifier => {
                if (specifier !== '343_fractional') throw Error(`Unexpected module: ${specifier}`);
                return { id: '343_fractional.ra', source };
            },
        });
        try {
            runtime.execute(readFileSync(new URL('../../../demos/euler/343_fractional_test.ra', import.meta.url), 'utf8'));
            expect(runtime.testResults).toHaveLength(3);
            expect(runtime.testResults.every(test => test.passed)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('matches every quadratic largest factor against independent trial division', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('option Limit integer = 2000000', 'option Limit integer = 1'));
            const result = runtime.execute('1000 quadfactors');
            if (!result || !isRankArray(result)) throw Error('expected factor array');
            expect(result.shape).toEqual([1001]);
            for (let k = 0; k <= 1000; k++) {
                expect(result.items[k], `k=${k}`).toBe(largestFactor(k * k - k + 1));
            }
            // Check every short prefix, including the double root modulo 3,
            // repeated prime powers and the second root of a discovered prime.
            let expected = 0n;
            for (let limit = 1; limit <= 100; limit++) {
                const a = largestFactor(limit + 1), b = largestFactor(limit * limit - limit + 1);
                expected += (a > b ? a : b) - 1n;
                expect(runtime.execute(`${limit} sumfrac`), `limit=${limit}`).toBe(expected);
            }
        } finally { runtime.dispose(); }
    });

    it('preserves reduced checksums and scalar factor queries', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('option Limit integer = 2000000', 'option Limit integer = 1000'));
            expect(runtime.variables.get('Answer')).toBe(72421603n);
            expect(runtime.execute('1 lpf')).toBe(1n);
            expect(runtime.execute('1000036000099 lpf')).toBe(1000033n);
        } finally { runtime.dispose(); }
    });
});
