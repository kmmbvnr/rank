import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { integer32Cells, ownedArray, readArrayItem, typedArray } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget } from '../src/interrupt.js';

const mod = (x: bigint, m: bigint) => (x % m + m) % m;
const left = [-2147483648, -1000000006, 0, 1000000006, 2147483647, 17];
const right = [2147483647, -1000000005, 23, 1000000005, -2147483648, -19];

function array(value: ReturnType<Interpreter['execute']>) {
    if (value === undefined || !isRankArray(value)) throw Error('expected array');
    return value;
}

for (const compilation of [false, true]) describe(`ordinary modular products, compilation=${compilation}`, () => {
    for (const shape of [[6], [2, 3], [1, 2, 3]]) for (const m of [1n, 17n, 1000000007n, 1073741824n, 1073741825n, 1999998034n, 2147483648n]) {
        it(`reduces exact wide products in shape ${shape}, modulus ${m}`, () => {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.variables.set('A', typedArray(Int32Array.from(left), shape));
                runtime.variables.set('B', typedArray(Int32Array.from(right), shape));
                runtime.variables.set('Mod', m);
                const result = array(runtime.execute('(A * B) mod Mod'));
                expect(left.map((_, i) => readArrayItem(result, i))).toEqual(left.map((x, i) => mod(BigInt(x) * BigInt(right[i]), m)));
                expect(integer32Cells(result)).toBeDefined();
                runtime.execute('Mod = 19');
                const changed = array(runtime.execute('(A * B) mod Mod'));
                expect(readArrayItem(changed, 0)).toBe(mod(BigInt(left[0]) * BigInt(right[0]), 19n));
            } finally { runtime.dispose(); }
        });
    }
    it('retains deferred opaque reads with a named modulus', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Mod', 7n);
            runtime.variables.set('A', { kind: 'array', shape: [2], items: [], itemAt: () => {
                runtime.variables.set('Mod', 11n); return 10n;
            } });
            runtime.variables.set('B', ownedArray([3n, 4n]));
            const result = array(runtime.execute('A * B mod Mod'));
            expect(result.items).toEqual([2n, 5n]);
        } finally { runtime.dispose(); }
    });
    it('computes the product before effectful modulus evaluation mutates inputs', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const a = typedArray(Int32Array.from([10, 20]), [2]);
        try {
            runtime.variables.set('A', a);
            runtime.variables.set('B', typedArray(Int32Array.from([3, 4]), [2]));
            runtime.variables.set('modulus', native('modulus', 1, () => { a.items[0] = 999n; return 7n; }));
            expect(array(runtime.execute('A * B mod (0 modulus)')).items).toEqual([2n, 3n]);
        } finally { runtime.dispose(); }
    });
    it('reports shape errors before calling an effectful modulus', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        let calls = 0;
        try {
            runtime.variables.set('A', typedArray(Int32Array.from([1, 2]), [2]));
            runtime.variables.set('B', typedArray(Int32Array.from([3, 4, 5]), [3]));
            runtime.variables.set('modulus', native('modulus', 1, () => { calls++; return 7n; }));
            expect(() => runtime.execute('A * B mod (0 modulus)')).toThrow();
            expect(calls).toBe(0);
        } finally { runtime.dispose(); }
    });
    it('retains exact wide cells, broadcasting and budgeted execution', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('A', ownedArray([2n ** 90n, -(2n ** 90n)], [2, 1]));
            runtime.variables.set('B', ownedArray([11n, 13n], [1, 2]));
            const result = array(withDemandBudget(10000, () => runtime.execute('A * B mod 17')));
            expect(result.items).toEqual([mod(2n ** 90n * 11n, 17n), mod(2n ** 90n * 13n, 17n), mod(-(2n ** 90n) * 11n, 17n), mod(-(2n ** 90n) * 13n, 17n)]);
        } finally { runtime.dispose(); }
    });
});
