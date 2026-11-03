import {describe, expect, it} from 'vitest';
import {Interpreter, MISSING, type RankValue} from '../src/index.js';
import {maskedArray, ownedArray, typedArray} from '../src/array-storage.js';
import {applySelectors, selectValues} from '../src/value-selection.js';

const modules = new Set<string>();
const outcome = (run: () => RankValue) => {
    try { return {value: run()}; }
    catch (error) {
        const e = error as Error;
        return {name: e.name, message: e.message};
    }
};

describe('scalar tensor addressing', () => {
    it.each([
        () => typedArray(new Int32Array([1, 2, 3, 4]), [2, 2]),
        () => typedArray(new Float64Array([1.5, 2.5, 3.5, 4.5]), [2, 2]),
        () => typedArray(new BigInt64Array([1n, 2n, 3n, 4n]), [2, 2]),
        () => ownedArray(['a', 'b', 'c', 'd'], [2, 2], true),
        () => ownedArray([1n, MISSING, 3n, 2n ** 100n], [2, 2], true),
        () => maskedArray(new BigInt64Array([1n, 2n, 3n, 4n]), new Uint32Array([13]), [2, 2]),
    ])('matches general reads and bounds for storage %#', create => {
        const source = create();
        for (const coordinates of [[0n, 0n], [0n, 1n], [1n, 1n], [-1n, 0n], [0n, -1n], [2n, 0n], [0n, 2n ** 100n]]) {
            const values = [source, ...coordinates];
            expect(outcome(() => selectValues(modules, values)))
                .toEqual(outcome(() => applySelectors(values)));
        }
    });

    it('reads rank-three and empty dimensions with the same axis errors', () => {
        for (const source of [typedArray(new Int32Array([1, 2, 3, 4]), [1, 2, 2]),
            ownedArray([], [2, 0, 3], true)]) {
            for (const coordinates of [[0n, 1n, 1n], [1n, 0n, 0n], [0n, 0n, -1n]]) {
                const values = [source, ...coordinates];
                expect(outcome(() => selectValues(modules, values)))
                    .toEqual(outcome(() => applySelectors(values)));
            }
        }
    });

    it('keeps noninteger selector errors and partial selections', () => {
        const source = typedArray(new Int32Array([1, 2, 3, 4]), [2, 2]);
        for (const selectors of [[0n], [-1n, 0.5], [0n, true], [0n, 0n, 1n]]) {
            const values = [source, ...selectors];
            expect(outcome(() => selectValues(modules, values)))
                .toEqual(outcome(() => applySelectors(values)));
        }
    });

    it.each([false, true])('observes writes and rebinding (compilation=%s)', compilation => {
        const runtime = new Interpreter(() => {}, {compilation});
        try {
            expect(runtime.execute(`A = array shape 2 2 fill 0
fun read
  return A 1 1
end
Before = read
A 1 1 = 7
After = read
A = array shape 2 2 fill 9
Before + After + read`)).toBe(16n);
        } finally { runtime.dispose(); }
    });
});
