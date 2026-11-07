import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { typedArray, ownedArray, readArrayItem } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { InterruptedError, withInterrupt, withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';
const size = 4096;
const edge = [-2147483648n, -2147483647n, -6n, -1n, 0n, 1n, 6n, 2147483647n];
const values = Array.from({ length: size }, (_, i) => i < edge.length ? edge[i] : BigInt(Math.imul(i + 1, 2654435761)));
const gcd = (x: bigint, y: bigint): bigint => { let a = x < 0n ? -x : x, b = y < 0n ? -y : y;
    while (b) { const r = a % b; a = b; b = r; } return a; };
const cells = (a: RankArray) => Array.from({ length: a.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(a, i));
describe('compact stored gcd kernels', () => {
    it.each(edge)('matches exact signed scalar gcd with %s in both positions', scalar => {
        const a = typedArray(Int32Array.from(values, Number));
        for (const [x, y] of [[a, scalar], [scalar, a]] as [RankValue, RankValue][]) {
            expect(cells(mapStoredIntegers(x, y, 'gcd')!)).toEqual(values.map(value => gcd(value, scalar)));
        }
        expect(cells(a)).toEqual(values);
    });
    it('keeps an equal-shape result exact when its final cell widens', () => {
        const a = new Int32Array(size).fill(126), b = new Int32Array(size).fill(84);
        a[size - 1] = -2147483648; b[size - 1] = 0;
        const result = mapStoredIntegers(typedArray(a), typedArray(b), 'gcd')!;
        expect(cells(result)).toEqual(Array.from(a, (value, i) => gcd(BigInt(value), BigInt(b[i]))));
    });
    it('broadcasts compact columns against short boxed rows', () => {
        const a = ownedArray([-6n, 0n, 2147483647n], [3, 1]);
        const b = typedArray(Int32Array.from(values, Number), [1, size]);
        const result = mapStoredIntegers(a, b, 'gcd')!;
        expect(result.shape).toEqual([3, size]);
        expect(cells(result)).toEqual([-6n, 0n, 2147483647n].flatMap(x => values.map(y => gcd(x, y))));
    });
    it('handles high-rank broadcast lanes and preserves a reversed source view', () => {
        const r = new Interpreter();
        try {
            r.variables.set('A', typedArray(new Int32Array([6, 10, 15, 0, -21, 35]), [2, 1, 3, 1]));
            const b = Int32Array.from({ length: 256 }, (_, i) => i - 128);
            r.variables.set('B', typedArray(b, [1, 4, 1, 64]));
            const result = r.execute('use numbers\nA gcd B');
            if (!result || !isRankArray(result)) throw Error('expected array');
            const expected: bigint[] = [];
            for (let row = 0; row < 2; row++) for (let group = 0; group < 4; group++) for (let col = 0; col < 3; col++) {
                for (let i = 0; i < 64; i++) expected.push(gcd([6n, 10n, 15n, 0n, -21n, 35n][row * 3 + col], BigInt(b[group * 64 + i])));
            }
            expect(cells(result)).toEqual(expected);
            r.variables.set('Source', typedArray(Int32Array.from(values, Number)));
            const reversed = r.execute('use sequences\n(Source (4095 to 0 by -1)) gcd 126');
            if (!reversed || !isRankArray(reversed)) throw Error('expected array');
            expect(cells(reversed)).toEqual([...values].reverse().map(x => gcd(x, 126n)));
        } finally { r.dispose(); }
    });
    it('combines GCD with the new two-column broadcast path', () => {
        const values = Int32Array.from({ length: 1024 }, (_, i) => i - 512);
        const left = typedArray(values, [1024, 1]);
        const right = typedArray(new Int32Array([-6, 35]), [1, 2]);
        const result = mapStoredIntegers(left, right, 'gcd')!;
        expect(result.shape).toEqual([1024, 2]);
        expect(cells(result)).toEqual(Array.from(values).flatMap(x => [gcd(BigInt(x), -6n), gcd(BigInt(x), 35n)]));
    });
    it('retains arbitrary precision outside compact storage', () => {
        const a = ownedArray([1n << 100n, -(1n << 80n), 0n]);
        const result = mapStoredIntegers(a, 1n << 70n, 'gcd')!;
        expect(cells(result)).toEqual([1n << 70n, 1n << 70n, 1n << 70n]);
    });
    it('preserves cancellation and demand budgets', () => {
        const a = typedArray(new Int32Array(size).fill(987654321));
        expect(() => withInterrupt(new Int32Array([1]), () => mapStoredIntegers(a, 123456789n, 'gcd'))).toThrow(InterruptedError);
        expect(() => withDemandBudget(1, () => mapStoredIntegers(a, 123456789n, 'gcd'))).toThrow(DemandBudgetExhausted);
    });
});
