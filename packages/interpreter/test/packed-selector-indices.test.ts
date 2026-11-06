import {describe, expect, it} from 'vitest';
import {Interpreter, MISSING, formatValue, isRankArray, type RankValue} from '../src/index.js';
import {selectAxis} from '../src/selectors.js';
import {materializeValue} from '../src/materialize.js';
import {ownedArray, typedArray, readArrayItem} from '../src/array-storage.js';

const items = (value: RankValue | undefined) => {
    if (value === undefined) throw Error('expected value');
    const array = materializeValue(value);
    if (!isRankArray(array)) throw Error('expected array');
    return Array.from({length: array.shape.reduce((a, b) => a * b, 1)}, (_, i) => readArrayItem(array, i));
};

describe('packed selectors at ordinary axis boundaries', () => {
    it.each([1, 31, 32, 33, 63, 64, 65, 129])('selects and writes across bitmap word boundaries of length %s', length => {
        const runtime = new Interpreter(() => {}, {compilation: false});
        runtime.execute('use sequences');
        const mask = Array.from({length}, (_, i) => i % 3 === 1 || i === length - 1);
        runtime.variables.set('Mask', ownedArray(mask));
        try {
            runtime.execute(`A = 0 till ${length} array\nBefore = A Mask copy\nA Mask = -1`);
            expect(items(runtime.variables.get('Before'))).toEqual(mask.flatMap((selected, i) => selected ? [BigInt(i)] : []));
            expect(items(runtime.variables.get('A'))).toEqual(mask.map((selected, i) => selected ? -1n : BigInt(i)));
            runtime.execute('Mask # = false');
            expect(items(runtime.execute('A Mask'))).toEqual([]);
            expect(items(runtime.variables.get('Before'))).toEqual(mask.flatMap((selected, i) => selected ? [BigInt(i)] : []));
        } finally { runtime.dispose(); }
    });

    it('preserves duplicate integer indices, mutations and out-of-bounds errors', () => {
        const runtime = new Interpreter(() => {}, {compilation: false});
        const selector = typedArray(new Int32Array([2, 0, 2]));
        runtime.variables.set('Index', selector);
        const read = () => selectAxis({kind: 'queue', items: [10n, 20n, 30n]}, 0, selector);
        try {
            runtime.execute('A = array 10 20 30');
            expect(items(runtime.execute('A Index'))).toEqual([30n, 10n, 30n]);
            expect(items(read())).toEqual([30n, 10n, 30n]);
            selector.items[0] = 1n;
            expect(items(runtime.execute('A Index'))).toEqual([20n, 10n, 30n]);
            expect(items(read())).toEqual([20n, 10n, 30n]);
            selector.items[0] = -1n;
            expect(() => runtime.execute('A Index')).toThrow('array index must be nonnegative on axis 0');
            expect(read).toThrow('array index must be nonnegative on axis 0');
            selector.items[0] = 3n;
            expect(() => runtime.execute('A Index')).toThrow('array index out of bounds on axis 0: 3');
            expect(read).toThrow('array index out of bounds on axis 0: 3');
        } finally { runtime.dispose(); }
    });

    it('keeps missing-mask, rank and length behavior', () => {
        const runtime = new Interpreter(() => {}, {compilation: false});
        try {
            runtime.execute('A = array 10 20 30');
            runtime.variables.set('Mask', ownedArray([true, MISSING, false]));
            expect(formatValue(runtime.execute('A Mask')!)).toBe('10');
            runtime.variables.set('Mask', ownedArray([true, false]));
            expect(() => runtime.execute('A Mask')).toThrow('mask shape mismatch: 3 and 2');
            runtime.variables.set('Mask', ownedArray([true, false, true], [1, 3]));
            expect(() => runtime.execute('A Mask')).toThrow('mask shape mismatch');
        } finally { runtime.dispose(); }
    });
});
