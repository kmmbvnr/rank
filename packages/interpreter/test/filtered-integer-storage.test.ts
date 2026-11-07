import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, RuntimeDiagnostics } from '../src/index.js';
import { integer32Cells, integer64Cells, ownedArray, typedArray } from '../src/array-storage.js';

for (const compilation of [false, true]) describe(`filtered integer copies, compilation=${compilation}`, () => {
    it.each(['Source greater -1', 'Source equal 19999', 'Source less 0', 'Source mod 2 equal 0'])(
        'keeps output compact and bounded: %s', predicate => {
            const runtime = new Interpreter(() => {}, { compilation });
            const cells = Int32Array.from({ length: 20000 }, (_, i) => i);
            runtime.variables.set('Source', typedArray(cells, [cells.length]));
            const diagnostics = new RuntimeDiagnostics();
            try {
                const value = diagnostics.run(() => runtime.execute(`use sequences\nResult = Source (${predicate}) copy\nResult`));
                if (!value || !isRankArray(value)) throw Error('expected array');
                const expected = predicate.includes('greater') ? [...cells]
                    : predicate.includes('19999') ? [19999] : predicate.includes('less') ? [] : [...cells].filter(x => x % 2 === 0);
                const held = integer32Cells(value);
                expect(value.shape).toEqual([expected.length]);
                if (expected.length) {
                    expect(held).toBeDefined();
                    expect([...held!]).toEqual(expected);
                    expect(held!.buffer.byteLength).toBeLessThanOrEqual(Math.max(4096, expected.length * 8));
                }
                expect(diagnostics.typedUnpacks).toBe(0);
                if (compilation) expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            } finally { runtime.dispose(); }
        });
    it('widens after growing without truncating mathematical integers', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const input = Array.from({ length: 12000 }, (_, i) => i === 10000 ? 2n ** 90n : i === 8000 ? 2n ** 50n : BigInt(i));
        runtime.variables.set('Source', ownedArray(input));
        try {
            const value = runtime.execute('use sequences\nResult = Source (Source at least 0) copy\nResult');
            if (!value || !isRankArray(value)) throw Error('expected array');
            expect(value.items).toEqual(input);
            expect(integer64Cells(value)).toBeUndefined();
        } finally { runtime.dispose(); }
    });
});
