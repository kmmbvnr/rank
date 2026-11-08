import { expect, it } from 'vitest';
import { Interpreter, formatValue, withDemandBudget } from '../src/index.js';
import { typedArray, derivedArray } from '../src/array-storage.js';

it.each(['Input', 'Input reverse', 'Input (array 5 0 3)', 'Input reshape 2 3'])(
    'preserves reference membership and inversion for stored view %s', expression => {
        const r = new Interpreter(() => {}, { compilation: false });
        try {
            r.execute('use sequences\nPrimes = 100 primesieve');
            r.variables.set('Input', typedArray(new Int32Array([-1, 0, 2, 3, 4, 97])));
            const expected = expression === 'Input' ? 'false false true true false true'
                : expression === 'Input reverse' ? 'true false true true false false'
                : expression.includes('array') ? 'true false true' : 'false false true true false true';
            for (const invert of [false, true]) {
                const value = r.execute(`Result = (${expression}) ${invert ? 'not in' : 'in'} Primes\nResult`)!;
                expect(formatValue(value).replace(/[\n\[\]]/g, ' ').trim().replace(/\s+/g, ' '))
                    .toBe(invert ? expected.split(' ').map(x => String(x !== 'true')).join(' ') : expected);
            }
            expect(() => withDemandBudget(1, () => r.execute('Input in Primes'))).toThrow('demand budget exhausted');
        } finally { r.dispose(); }
    });
it('retains ordinary host readers and untrusted membership callbacks', () => {
    const r = new Interpreter(() => {}, { compilation: false });
    try {
        r.execute('use sequences');
        const reads: number[] = [], seen: bigint[] = [];
        r.variables.set('Input', derivedArray([3], [], i => { reads.push(i); return BigInt(i + 1); }, true));
        r.variables.set('Allowed', { kind: 'sequence', plan: { name: 'primesieve', size: { kind: 'unknown' },
            *iterate() {}, contains: value => { seen.push(value as bigint); return value === 2n; } } });
        expect(formatValue(r.execute('Input in Allowed')!)).toBe('false true false');
        expect(reads).toEqual([0, 1, 2]);
        expect(seen).toEqual([1n, 2n, 3n]);
    } finally { r.dispose(); }
});
