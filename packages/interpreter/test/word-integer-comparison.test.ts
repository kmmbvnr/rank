import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { booleanCells, readArrayItem, typedArray } from '../src/array-storage.js';
const values = [-(1n << 63n), -(1n << 53n) - 1n, -4294967297n, -1n, 0n, 1n, 4294967297n, (1n << 53n) + 1n, (1n << 63n) - 1n];
const operations = {
    equal: (a: bigint, b: bigint) => a === b, 'not equal': (a: bigint, b: bigint) => a !== b,
    less: (a: bigint, b: bigint) => a < b, greater: (a: bigint, b: bigint) => a > b,
    'at most': (a: bigint, b: bigint) => a <= b, 'at least': (a: bigint, b: bigint) => a >= b,
};
for (const [op, compare] of Object.entries(operations)) it(`compares exact word boundaries with ${op}`, () => {
    const a = BigInt64Array.from({ length: 2051 }, (_, i) => values[i % values.length]);
    const b = BigInt64Array.from(a, (_, i) => values[(i * 3 + 1) % values.length]);
    for (const compilation of [false, true]) for (const right of [b, ...values]) {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.variables.set('Input', typedArray(a.slice()));
            r.variables.set('Other', typeof right === 'bigint' ? right : typedArray(right.slice()));
            const result = r.execute(`Input ${op} Other`);
            if (!result || !isRankArray(result)) throw Error('expected comparison array');
            expect(booleanCells(result)).toBeDefined();
            expect(Array.from(a, (value, i) => readArrayItem(result, i))).toEqual(Array.from(a, (value, i) => compare(value, typeof right === 'bigint' ? right : right[i])));
        } finally { r.dispose(); }
    }
});
it('broadcasts Int32 columns beside Int64 words exactly', () => {
    const a = BigInt64Array.from({ length: 2048 }, (_, i) => values[i % values.length]);
    const b = Int32Array.from({ length: 64 }, (_, i) => i % 3 - 1);
    const r = new Interpreter(() => {}, { compilation: false });
    try {
        r.variables.set('Input', typedArray(a, [32, 64])); r.variables.set('Other', typedArray(b));
        const result = r.execute('Input less Other');
        if (!result || !isRankArray(result)) throw Error('expected comparison array');
        expect(result.shape).toEqual([32, 64]); expect(booleanCells(result)).toBeDefined();
        expect(Array.from(a, (value, i) => readArrayItem(result, i))).toEqual(Array.from(a, (value, i) => value < BigInt(b[i % 64])));
    } finally { r.dispose(); }
});
it.each([-(1n << 63n) - 1n, 1n << 63n])('retains scalar comparison outside Int64: %s', scalar => {
    const r = new Interpreter(() => {}, { compilation: false });
    try {
        r.variables.set('Input', typedArray(BigInt64Array.from({ length: 2048 }, (_, i) => values[i % values.length])));
        r.variables.set('Other', scalar);
        const result = r.execute('Input less Other');
        if (!result || !isRankArray(result)) throw Error('expected comparison array');
        for (let i = 0; i < 2048; i++) expect(readArrayItem(result, i)).toBe(values[i % values.length] < scalar);
    } finally { r.dispose(); }
});
