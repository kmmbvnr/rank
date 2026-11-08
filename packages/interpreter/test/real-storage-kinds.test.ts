import { expect, it } from 'vitest';
import { storedScalarKinds, typedArray, writeArrayCell } from '../src/array-storage.js';
import { withDemandBudget } from '../src/interrupt.js';
it.each([0, 1, 4095, 4096, 4097, 8200])('classifies real storage and limits at block boundary %s', size => {
    const data = Float64Array.from({ length: size }, (_, i) => i % 5 ? i + 0.25 : NaN);
    for (const position of [-1, 0, 4095, 4096, size - 1]) {
        const cells = data.slice();
        if (position >= 0 && position < size) cells[position] = position % 2 ? -Infinity : Infinity;
        const value = typedArray(cells), generic = typedArray(cells.slice());
        const actual = storedScalarKinds(value, true);
        const expected = withDemandBudget(1000000, () => storedScalarKinds(generic, true));
        expect(actual).toEqual(expected);
        expect(storedScalarKinds(value)).toEqual(size ? ['real'] : []);
    }
});
it('updates cached real/limit counts through later writes', () => {
    const value = typedArray(new Float64Array([1.5, -0, NaN, Infinity, -Infinity]));
    expect(storedScalarKinds(value, true)).toEqual(['numeric-limit', 'real']);
    writeArrayCell(value, 3, 2.0); writeArrayCell(value, 4, 3.0);
    expect(storedScalarKinds(value, true)).toEqual(['real']);
    writeArrayCell(value, 0, Infinity);
    expect(storedScalarKinds(value, true)).toEqual(['numeric-limit', 'real']);
});
