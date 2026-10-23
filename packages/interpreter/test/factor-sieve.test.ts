import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { Factorizer } from '../src/factorization.js';

function trialSum(n: number): number {
    let sum = 0;
    for (let p = 2; p * p <= n; p++) {
        while (n % p === 0) { sum += p; n /= p; }
    }
    return sum + (n > 1 ? n : 0);
}

describe('batch smallest-prime-factor table', () => {
    it('returns owned snapshots without exposing the shared table to writes', () => {
        const factorizer = new Factorizer();
        const first = factorizer.smallestFactors(12);
        expect([...first]).toEqual([0, 0, 2, 3, 2, 5, 2, 7, 2, 3, 2, 11, 2]);
        first[12] = 7;
        expect([...factorizer.factors(12n)]).toEqual([2n, 2n, 3n]);
        expect(factorizer.smallestFactors(10000)[9999]).toBe(3);
        expect(factorizer.smallestFactors(12)[12]).toBe(2);
        expect(first[12]).toBe(7);
    });

    it('checks bounds and includes the inclusive bound and sentinel cells', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers');
            expect(formatValue(runtime.execute('0 factorsieve')!)).toBe('0');
            expect(formatValue(runtime.execute('1 factorsieve')!)).toBe('0 0');
            expect(formatValue(runtime.execute('2 factorsieve')!)).toBe('0 0 2');
            runtime.execute('Spf = 1048575 factorsieve');
            expect(runtime.execute('Spf len')).toBe(1048576n);
            expect(runtime.execute('Spf 999983')).toBe(999983n);
            expect(runtime.execute('Spf 1048575')).toBe(3n);
            for (const value of ['(-1)', '1048576', '2 ** 100']) {
                expect(() => runtime.execute(`${value} factorsieve`)).toThrow('factorsieve bound must be between 0 and 1048575');
            }
            expect(() => runtime.execute('1.5 factorsieve')).toThrow('expected integer input');
        } finally { runtime.dispose(); }
    });

    it.each([false, true])('factors every integer from a single table (compilation=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`use numbers
Spf = 10000 factorsieve
Saved = Spf
Spf 12 = 7
Answer = 0
for N in 1 to 10000
 Rest = N
 for Rest greater 1
  P = Saved Rest
  Answer += P
  Rest //= P
 end
end`);
            let expected = 0;
            for (let n = 1; n <= 10000; n++) expected += trialSum(n);
            expect(runtime.variables.get('Answer')).toBe(BigInt(expected));
            expect(runtime.execute('Saved 12')).toBe(2n);
            expect(formatValue(runtime.execute('12 factors array')!)).toBe('2 2 3');
        } finally { runtime.dispose(); }
    });
});
