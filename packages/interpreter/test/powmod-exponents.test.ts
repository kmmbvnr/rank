import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { integer32Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { modularPower } from '../src/primality.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`packed varying powmod exponents, compilation=${compilation}`, () => {
    for (const [base, modulus] of [[-9007199254740991n, 1073741824n], [900000007n, 987898789n], [0n, 1n], [-17n, 17n]]) {
        it(`matches BigInt for base ${base}, modulus ${modulus}`, () => {
            const values = Int32Array.from({ length: 4101 }, (_, i) => (Math.imul(i, 1664525) + 1013904223) >>> 1);
            values[0] = 0; values[1] = 1; values[2] = 2147483647;
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.variables.set('Exponent', typedArray(values, [3, 1367]));
                runtime.variables.set('Base', base);
                runtime.variables.set('Mod', modulus);
                const result = runtime.execute('use numbers\nBase Exponent Mod powmod');
                if (result === undefined || !isRankArray(result)) throw Error('expected array');
                expect(result.shape).toEqual([3, 1367]);
                expect(integer32Cells(result)).toBeDefined();
                expect(Array.from(values, (_, i) => readArrayItem(result, i))).toEqual(Array.from(values, x => modularPower(base, BigInt(x), modulus)));
            } finally { runtime.dispose(); }
        });
    }
    it('handles empty, singleton and rank-zero exponent arrays', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use numbers');
            for (const shape of [[0], [1], []]) {
                const values = new Int32Array(shape[0] === 0 ? 0 : 1).fill(13);
                runtime.variables.set('Exponent', typedArray(values, shape));
                const result = runtime.execute('3 Exponent 17 powmod');
                if (result === undefined || !isRankArray(result)) throw Error('expected array');
                expect(result.shape).toEqual(shape);
                expect(result.items).toEqual(values.length ? [12n] : []);
            }
        } finally { runtime.dispose(); }
    });
    it('retains negative-exponent failure and does not publish a partial result', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Exponent', typedArray(Int32Array.from([3, 4, 5, 6, -1]), [5]));
            expect(() => runtime.execute('use numbers\nResult = 3 Exponent 17 powmod')).toThrow('exponent must be nonnegative');
            expect(runtime.variables.has('Result')).toBe(false);
        } finally { runtime.dispose(); }
    });
    it('charges array work before publishing a budgeted result', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use numbers');
            runtime.variables.set('Exponent', typedArray(new Int32Array(8192).fill(31), [8192]));
            expect(() => withDemandBudget(100, () => runtime.execute('Result = 3 Exponent 17 powmod'))).toThrow(DemandBudgetExhausted);
            expect(runtime.variables.has('Result')).toBe(false);
            expect(runtime.execute('(3 Exponent 17 powmod) sum')).toBe(49152n);
        } finally { runtime.dispose(); }
    });
});
