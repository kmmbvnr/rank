import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, RuntimeDiagnostics } from '../src/index.js';
import { float64Cells, integer32Cells, integer64Cells, typedArray } from '../src/array-storage.js';

for (const compilation of [false, true]) describe(`native selected copies, compilation=${compilation}`, () => {
    for (const kind of ['int32', 'int64', 'real']) for (const [selector, positions] of [
        ['array 3 1 3', [3, 1, 3]],
        ['3 to 1 by -1', [3, 2, 1]],
        ['0 to 3 by 2', [0, 2]],
        ['Source greater 11', [2, 3]],
    ] as const) {
        it(`copies ${kind}: ${selector}`, () => {
            const runtime = new Interpreter(() => {}, { compilation });
            const input = [10, 11, 12, 13];
            const cells = kind === 'int32' ? Int32Array.from(input)
                : kind === 'int64' ? BigInt64Array.from(input.map(x => BigInt(x) + 2n ** 40n))
                    : Float64Array.from(input.map(x => x + 0.5));
            // Use a shared threshold so the boolean mask selects the same rows.
            const selection = selector === 'Source greater 11'
                ? kind === 'int64' ? 'Source greater 1099511627787' : kind === 'real' ? 'Source greater 11.5' : selector
                : selector;
            const expected = positions.map(i => cells[i]);
            const last = kind === 'real' ? cells[3] : BigInt(cells[3]);
            runtime.variables.set('Source', typedArray(cells, [4]));
            const diagnostics = new RuntimeDiagnostics();
            try {
                const result = diagnostics.run(() => runtime.execute(`use sequences\nSelected = Source (${selection}) copy\nSelected`));
                if (!result || !isRankArray(result)) throw Error('expected array');
                expect(diagnostics.typedUnpacks).toBe(0);
                const held = kind === 'int32' ? integer32Cells(result) : kind === 'int64' ? integer64Cells(result) : float64Cells(result);
                if (!held && compilation && selector === 'Source greater 11') {
                    expect(result.items).toEqual(expected.map(x => kind === 'real' ? x : BigInt(x)));
                    return;
                }
                expect(held).toBeDefined();
                expect(Array.from({ length: held!.length }, (_, i) => held![i])).toEqual(expected);
                runtime.execute(kind === 'real' ? 'Source 1 = 99.0' : 'Source 1 = 99');
                expect(Array.from({ length: held!.length }, (_, i) => held![i])).toEqual(expected);
                runtime.execute(kind === 'real' ? 'Selected 0 = 88.0' : 'Selected 0 = 88');
                expect(runtime.execute('Source 3')).toBe(last);
            } finally { runtime.dispose(); }
        });
    }
    it('retains bounds errors', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('Source', typedArray(Int32Array.of(10, 11), [2]));
        try { expect(() => runtime.execute('use sequences\nSource (array 0 9) copy')).toThrow(); }
        finally { runtime.dispose(); }
    });
});
