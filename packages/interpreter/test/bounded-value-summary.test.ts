import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, RuntimeDiagnostics, summarizeValue } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';

describe('bounded owned-storage diagnostic previews', () => {
    it.each([
        new Int32Array(100000).fill(7),
        new BigInt64Array(100000).fill(7n),
        new Float64Array(100000).fill(7.5),
    ])('reads only the preview without unpacking %s', cells => {
        const value = typedArray(cells, [100000]);
        const diagnostics = new RuntimeDiagnostics();
        const text = diagnostics.run(() => summarizeValue(value));
        expect(text).toBe(`array[100000]: ${Array(8).fill(String(cells[0])).join(' ')} …`);
        expect(diagnostics.typedUnpacks).toBe(0);
        expect(diagnostics.typedUnpackedCells).toBe(0);
    });
    it('summarizes packed booleans without unpacking', () => {
        const value = ownedArray(Array(10000).fill(true));
        const diagnostics = new RuntimeDiagnostics();
        expect(diagnostics.run(() => summarizeValue(value)))
            .toBe('array[10000]: true true true true true true true true …');
        expect(diagnostics.typedUnpacks).toBe(0);
    });
    it('keeps missing-cell previews bounded', () => {
        const runtime = new Interpreter();
        try {
            const value = runtime.execute('A = array shape 10000 fill .NA\nA 0 = 7\nA');
            if (!value || !isRankArray(value)) throw Error('expected array');
            const diagnostics = new RuntimeDiagnostics();
            const text = diagnostics.run(() => summarizeValue(value));
            expect(text).toContain('array[10000]: 7');
            expect(text.length).toBeLessThan(160);
            expect(diagnostics.typedUnpacks).toBe(0);
        } finally { runtime.dispose(); }
    });
    it('does not invoke a foreign items accessor', () => {
        let reads = 0;
        const value = { kind: 'array' as const, shape: [100000], get items(): bigint[] { reads++; throw Error('read'); } };
        expect(summarizeValue(value)).toBe('array[100000]');
        expect(reads).toBe(0);
    });
});
