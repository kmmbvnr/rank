import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { Factorizer } from '../src/factorization.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';

function trial(value: number): bigint[] {
    const result: bigint[] = [];
    for (let divisor = 2; divisor * divisor <= value; divisor++) {
        while (value % divisor === 0) { result.push(BigInt(divisor)); value /= divisor; }
    }
    if (value > 1) result.push(BigInt(value));
    return result;
}

describe('bounded factorization', () => {
    it('matches independent trial division across growth boundaries and repeated queries', () => {
        const factorizer = new Factorizer();
        for (let value = 1; value <= 20000; value++) {
            expect([...factorizer.factors(BigInt(value))]).toEqual(trial(value));
        }
        for (const value of [1048575, 1048576, 999983, 999982, 65537, 65536, 257, 256, 2, 1, 999982]) {
            expect([...factorizer.factors(BigInt(value))]).toEqual(trial(value));
        }
    });

    it('matches all prime-minus-one inputs in the Euler 302 table range', () => {
        const composite = new Uint8Array(1000000), factorizer = new Factorizer();
        let checked = 0;
        for (let prime = 2; prime < composite.length; prime++) {
            if (composite[prime]) continue;
            for (let multiple = prime * prime; multiple < composite.length; multiple += prime) composite[multiple] = 1;
            expect([...factorizer.factors(BigInt(prime - 1))]).toEqual(trial(prime - 1));
            checked++;
        }
        expect(checked).toBe(78498);
    });

    it('keeps arbitrary-precision factoring lazy and exact above the table cap', () => {
        const factorizer = new Factorizer();
        const huge = factorizer.factors(2n ** 100000n);
        expect(huge.next().value).toBe(2n);
        expect(huge.next().value).toBe(2n);
        expect([...factorizer.factors(1000003n * 1000033n)]).toEqual([1000003n, 1000033n]);
        expect([...factorizer.factors(2n ** 70n * 999983n)])
            .toEqual([...Array<bigint>(70).fill(2n), 999983n]);
    });

    it('can grow the shared table while a different traversal is suspended', () => {
        const factorizer = new Factorizer(), pending = factorizer.factors(360n);
        expect(pending.next().value).toBe(2n);
        expect([...factorizer.factors(999983n)]).toEqual([999983n]);
        expect([...pending]).toEqual([2n, 2n, 3n, 3n, 5n]);
    });

    it('can cancel table construction and safely retry with the same factorizer', () => {
        const factorizer = new Factorizer();
        expect([...factorizer.factors(12n)]).toEqual([2n, 2n, 3n]);
        let polls = 0;
        const signal: InterruptSignal = {
            length: 1,
            load: () => 0,
            store() {}, exchange: () => ++polls >= 2 ? 1 : 0, wait() {},
        };
        expect(() => withInterrupt(signal, () => [...factorizer.factors(999983n)]))
            .toThrow(InterruptedError);
        expect([...factorizer.factors(12n)]).toEqual([2n, 2n, 3n]);
        expect([...factorizer.factors(999983n)]).toEqual([999983n]);
    });

    it('preserves replay, ordering, divisors and input validation in Rank', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers\nuse sequences\nF = 360 factors');
            expect(formatValue(runtime.execute('F array')!)).toBe('2 2 2 3 3 5');
            expect(runtime.execute('F sum')).toBe(17n);
            expect(formatValue(runtime.execute('F array')!)).toBe('2 2 2 3 3 5');
            expect(formatValue(runtime.execute('12 divisors array')!)).toBe('1 2 3 4 6 12');
            expect(runtime.execute('360 divisors len')).toBe(24n);
            expect(runtime.execute('1 factors len')).toBe(0n);
            expect(() => runtime.execute('0 factors')).toThrow('factors expects a positive integer');
            expect(() => runtime.execute('(-1) factors')).toThrow('factors expects a positive integer');
            expect(() => runtime.execute('1.5 factors')).toThrow('expected integer input');
        } finally { runtime.dispose(); }
    });
});

const demo = readFileSync(new URL('../../../demos/euler/302_strongachilles.ra', import.meta.url), 'utf8');
describe('Euler 302 using builtin factors', () => {
    it('preserves the published reduced counts in both execution modes', () => {
        for (const compilation of [false, true]) {
            for (const [limit, expected] of [[10000, 7n], [100000000, 656n]] as const) {
                const runtime = new Interpreter(() => {}, { compilation });
                try {
                    runtime.execute(demo.replace('option Limit integer = 10 ** 18', `option Limit integer = ${limit}`));
                    expect(runtime.variables.get('Answer')).toBe(expected);
                } finally { runtime.dispose(); }
            }
        }
    }, 20000);
});
