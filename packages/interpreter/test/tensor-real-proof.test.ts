import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { arrayElementTypes } from '../src/array-element-types.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';
import { writeArrayCell } from '../src/owned-array.js';

describe('completed real tensor proof', () => {
    it.each([false, true])('avoids result rescans with shared destination = %s', shared => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new Float64Array(5000).fill(1)));
            runtime.variables.set('B', typedArray(new Float64Array(5000).fill(2)));
            // Warm input binding contracts before measuring result publication.
            runtime.execute('A += B * 0.5');
            const diagnostics = new RuntimeDiagnostics();
            diagnostics.run(() => {
                if (shared) runtime.execute('Saved = A');
                runtime.execute('A += B * 0.5');
                runtime.execute('A += B * 0.5');
            });
            expect(diagnostics.elementTypeScannedCells).toBe(0);
            expect(diagnostics.reusedTensorBuffers).toBe(shared ? 1 : 2);
            expect(runtime.execute('A sum')).toBe(20000);
            if (shared) expect(runtime.execute('Saved sum')).toBe(10000);

            const result = runtime.variables.get('A') as RankArray;
            expect(arrayElementTypes(result, true)).toEqual(['real']);
            // Cached proof must follow subsequent writes, including numeric limits.
            writeArrayCell(result, 0, Infinity);
            expect(readArrayItem(result, 0)).toBe(Infinity);
            expect(arrayElementTypes(result, true)).toEqual(['numeric-limit', 'real']);
        } finally { runtime.dispose(); }
    });

    it('preserves non-finite fallback results and binding errors', () => {
        const run = (tensorFusion: boolean) => {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                runtime.execute('use sequences');
                runtime.variables.set('A', typedArray(new Float64Array([1, Number.MAX_VALUE])));
                try {
                    runtime.execute('Result = (A * 2.0) copy');
                    return { types: arrayElementTypes(runtime.variables.get('Result') as RankArray, true),
                        value: readArrayItem(runtime.variables.get('Result') as RankArray, 1) };
                } catch (error) { return { error: String(error) }; }
            } finally { runtime.dispose(); }
        };
        expect(run(true)).toEqual(run(false));
    });
});
