import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { denseScalarItems, readArrayItem, typedArray } from '../src/array-storage.js';
import { shiftValue } from '../src/sequence.js';

describe.each([false, true])('typed shift (compilation=%s)', compilation => {
    it('reads neighbors without unpacking and preserves deferred-plan mutation protection', () => {
        const r = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const cells = BigInt64Array.from({ length: 10000 }, (_, i) => BigInt(i));
            r.variables.set('A', typedArray(cells));
            diagnostics.run(() => r.execute("use sequences\nS' = A shift 1 with -1\nTotal = S sum"));
            expect(r.variables.get('Total')).toBe(49985000n);
            expect(diagnostics.typedUnpacks).toBe(0);
            expect(denseScalarItems(r.variables.get('A') as RankArray)).toBe(cells);
            expect(() => r.execute('A 0 = 99')).toThrow('read-only');
            expect(r.execute('S 1')).toBe(0n);
        } finally { r.dispose(); }
    });
});

it.each([0, 1, 2])('shifts a 3D array on axis %i with positive, negative and oversized amounts', axis => {
    const shape = [2, 3, 4];
    const source = typedArray(BigInt64Array.from({ length: 24 }, (_, i) => BigInt(i)), shape);
    for (const amount of [-10, -1, 0, 1, 10]) {
        const shifted = shiftValue(source, BigInt(amount), -1n, axis) as RankArray;
        const expected: bigint[] = [];
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 4; k++) {
            const coordinates = [i, j, k];
            coordinates[axis] -= amount;
            expected.push(coordinates[axis] < 0 || coordinates[axis] >= shape[axis] ? -1n
                : BigInt((coordinates[0] * 3 + coordinates[1]) * 4 + coordinates[2]));
        }
        expect(Array.from({ length: 24 }, (_, i) => readArrayItem(shifted, i))).toEqual(expected);
    }
});
