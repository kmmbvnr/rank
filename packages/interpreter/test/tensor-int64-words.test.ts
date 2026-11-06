import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
const edge = [-(1n << 63n), -9007199254740993n, -9007199254740992n, -9007199254740991n,
    -4294967297n, -4294967296n, -1n, 0n, 4294967295n, 4294967296n,
    9007199254740991n, 9007199254740992n, 9007199254740993n, (1n << 63n) - 1n];
const size = 4096;
it.each([false, true])('keeps Int64 loads and exact replay at Number boundaries (shared=%s)', shared => {
    const r = new Interpreter(() => {}, { numberLoopCompilation: false });
    try {
        for (const offset of [0, 1, 2]) for (const boundary of edge) {
            const buffer = shared ? new SharedArrayBuffer((size + offset) * 8) : new ArrayBuffer((size + offset) * 8);
            const input = new BigInt64Array(buffer, offset * 8, size);
            const values = Array<bigint>(size).fill(4294967295n);
            values[size - 1 - offset] = boundary;
            input.set(values);
            r.variables.set('A', typedArray(input));
            r.variables.set('B', typedArray(BigInt64Array.from(values, () => 1n)));
            const result = r.execute('Saved = (A + B) mod 1000000007\nSaved');
            if (result === undefined || !isRankArray(result)) throw Error('expected array');
            expect(values.map((_, i) => readArrayItem(result, i))).toEqual(values.map(x => ((x + 1n) % 1000000007n + 1000000007n) % 1000000007n));
        }
    } finally { r.dispose(); }
});
it('reads two safe Int64 buffers with slices, broadcasts and signed carries', () => {
    const r = new Interpreter(() => {}, { numberLoopCompilation: false });
    const values = Array.from({ length: size }, (_, i) => [4294967295n, -4294967296n, 9007199254740990n][i % 3]);
    try {
        r.variables.set('A', typedArray(BigInt64Array.from(values)));
        r.variables.set('B', typedArray(new BigInt64Array(size).fill(1n)));
        r.execute('use sequences');
        const expressions = ['A + B', '(A (4095 to 0 by -1)) + B', '(A reshape 64 64) + (array 1)'];
        for (const [index, expression] of expressions.entries()) {
            const result = r.execute(`Saved${index} = ${expression}\nSaved${index}`);
            if (result === undefined || !isRankArray(result)) throw Error('expected array');
            const expected = expression.includes('4095') ? [...values].reverse() : values;
            expect(expected.map((_, i) => readArrayItem(result, i))).toEqual(expected.map(x => x + 1n));
        }
    } finally { r.dispose(); }
});
