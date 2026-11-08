import { expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { integer32Cells, integer64Cells, realCells, typedArray } from '../src/array-storage.js';

for (const compilation of [false, true]) for (const kind of ['int32', 'int64', 'real'] as const) {
    it(`retains a ${kind} row in compact independent storage through later writes (${compilation})`, () => {
        const cells = kind === 'int32' ? Int32Array.from({ length: 12000 }, (_, i) => i)
            : kind === 'int64' ? BigInt64Array.from({ length: 12000 }, (_, i) => 2n ** 55n + BigInt(i))
                : Float64Array.from({ length: 12000 }, (_, i) => i + 0.25);
        const r = new Interpreter(undefined, { compilation });
        const old = kind === 'real' ? 4002.25 : kind === 'int64' ? 2n ** 55n + 4002n : 4002n;
        const changed = kind === 'real' ? '99.5' : '99';
        try {
            r.variables.set('A', typedArray(cells, [3, 4000]));
            r.execute('Row = A 1');
            const row = r.variables.get('Row') as RankArray;
            const storage = integer32Cells(row) ?? integer64Cells(row) ?? realCells(row);
            if (!(storage instanceof Int32Array || storage instanceof BigInt64Array || storage instanceof Float64Array)) throw Error('Missing numeric storage');
            expect(storage.buffer).not.toBe(cells.buffer);
            expect(storage.buffer.byteLength).toBe(4000 * cells.BYTES_PER_ELEMENT);
            expect(storage.byteLength).toBe(4000 * cells.BYTES_PER_ELEMENT);
            r.execute(`A 1 2 = ${changed}`);
            expect(r.execute('Row 2')).toBe(old);
            r.execute(`Row 2 = ${kind === 'real' ? '77.5' : '77'}`);
            expect(r.execute('A 1 2')).toBe(kind === 'real' ? 99.5 : 99n);
            expect(r.execute('Row 2')).toBe(kind === 'real' ? 77.5 : 77n);
        } finally { r.dispose(); }
    });
}
it('retains a numeric plane and its row independently through both writes', () => {
    const r = new Interpreter();
    try {
        r.variables.set('A', typedArray(Int32Array.from({ length: 24 }, (_, i) => i), [2, 3, 4]));
        r.execute('Plane = A 1\nRow = Plane 1\nA 1 1 2 = 90\nPlane 1 2 = 80');
        expect(r.execute('Row 2')).toBe(18n);
        expect(r.execute('A 1 1 2')).toBe(90n);
        expect(r.execute('Plane 1 2')).toBe(80n);
    } finally { r.dispose(); }
});
