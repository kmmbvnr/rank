import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { denseScalarItems, typedArray } from '../src/array-storage.js';

it.each(['', ' .ascending', ' .descending'])('consumes an exclusive real buffer on self-sort%s', direction => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Values', typedArray(Float64Array.of(1.5, Infinity, -2.5, -Infinity, 1.5, 0)));
            runtime.execute('use sequences\nValues = Values');
            const original = denseScalarItems(runtime.variables.get('Values') as RankArray) as Float64Array;
            diagnostics.run(() => runtime.execute(`Values = Values sort${direction}`));
            const sorted = denseScalarItems(runtime.variables.get('Values') as RankArray)!;
            const expected = [-Infinity, -2.5, 0, 1.5, 1.5, Infinity];
            expect(Array.from(sorted)).toEqual(direction === ' .descending' ? expected.reverse() : expected);
            expect((sorted as Float64Array).buffer === original.buffer).toBe(compilation);
            expect(diagnostics.numericInPlaceSorts).toBe(compilation ? 1 : 0);
        } finally { runtime.dispose(); }
    }
});
it.each(['Alias = Values', 'Alias = Values (0 till 2)', "Alias' = Values + 1"])('preserves retained real readers: %s', retain => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(`use sequences\nValues = array 2.5 1.5 0.5\n${retain}`);
        diagnostics.run(() => runtime.execute('Values = Values sort'));
        expect(diagnostics.numericInPlaceSorts).toBe(0);
        expect(runtime.execute('Alias 0')).toBe(retain.includes("Alias'") ? 3.5 : 2.5);
        expect(runtime.execute('Values 0')).toBe(0.5);
    } finally { runtime.dispose(); }
});
it.each([Float64Array.of(0, -0, 1, -0), Float64Array.of(1, NaN, -1)])('retains generic exceptional real ordering: %s', cells => {
    const observations: unknown[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Values', typedArray(cells.slice()));
            runtime.execute('use sequences\nValues = Values');
            let error: string | undefined;
            try { diagnostics.run(() => runtime.execute('Values = Values sort')); }
            catch (failure) { error = String(failure); }
            observations.push({ error, values: Array.from((runtime.variables.get('Values') as RankArray).items) });
            expect(diagnostics.numericInPlaceSorts).toBe(0);
        } finally { runtime.dispose(); }
    }
    expect(observations[1]).toEqual(observations[0]);
});
