import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankArray, type RankValue } from '../src/index.js';
import { ownedArray, readArrayItem, writeArrayCell } from '../src/array-storage.js';
import { comparePackedBooleans } from '../src/packed-booleans.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

for (const op of ['equal', 'notequal']) describe(`packed Boolean ${op}`, () => {
    it.each([1, 31, 32, 33, 63, 64, 65, 4095, 4096, 4097])('matches scalar comparison at length %i', size => {
        const flags = Array.from({ length: size }, (_, i) => i % 3 === 0);
        const left = ownedArray(flags), right = ownedArray(flags.map((_, i) => i % 7 === 0));
        for (const [a, b] of [[left, right], [left, true], [left, false], [true, left], [false, left]] as [RankValue, RankValue][]) {
            const result = comparePackedBooleans(a, b, op)!;
            expect(result).toBeDefined();
            const cell = (x: RankValue, i: number) => typeof x === 'boolean' ? x : readArrayItem(x as RankArray, i);
            expect(Array.from({ length: size }, (_, i) => readArrayItem(result, i)))
                .toEqual(flags.map((_, i) => op === 'equal' ? cell(a, i) === cell(b, i) : cell(a, i) !== cell(b, i)));
        }
    });

    it('keeps source and result writes independent and refreshes current bits', () => {
        const source = ownedArray(Array(65).fill(true));
        const first = comparePackedBooleans(source, true, op)!;
        writeArrayCell(source, 32, false);
        expect(readArrayItem(first, 32)).toBe(op === 'equal');
        expect(readArrayItem(comparePackedBooleans(source, true, op)!, 32)).toBe(op !== 'equal');
        first.items[0] = false;
        expect(readArrayItem(source, 0)).toBe(true);
    });

    it('retains matrix shape and declines broadcasting or mixed domains', () => {
        const source = ownedArray([true, false, false, true], [2, 2]);
        expect(comparePackedBooleans(source, false, op)!.shape).toEqual([2, 2]);
        expect(comparePackedBooleans(source, ownedArray([true, false], [1, 2]), op)).toBeUndefined();
        expect(comparePackedBooleans(source, 1n, op)).toBeUndefined();
        expect(comparePackedBooleans(true, false, op)).toBeUndefined();
    });

    it('does not read opaque, replaced or inconsistent native readers', () => {
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [2], items: [], itemAt: () => { reads++; return true; } };
        expect(comparePackedBooleans(host, true, op)).toBeUndefined();
        const source = ownedArray([true, false]);
        Object.defineProperty(source, 'itemAt', { get() { reads++; return undefined; } });
        expect(comparePackedBooleans(source, true, op)).toBeUndefined();
        expect(comparePackedBooleans(ownedArray([true, false], [3]), true, op)).toBeUndefined();
        expect(comparePackedBooleans(ownedArray([true, false], [-1, -2]), true, op)).toBeUndefined();
        expect(reads).toBe(0);
    });

    it('can cancel and retry without changing either input', () => {
        const source = ownedArray(Array(4097).fill(true));
        expect(() => withDemandBudget(0, () => comparePackedBooleans(source, false, op))).toThrow(DemandBudgetExhausted);
        expect(readArrayItem(comparePackedBooleans(source, false, op)!, 4096)).toBe(op === 'notequal');
        expect(readArrayItem(source, 4096)).toBe(true);
    });
});
for (const compilation of [false, true]) it(`uses packed comparison through Rank (compiled=${compilation})`, () => {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        expect(formatValue(runtime.execute('use sequences\nA = (1 to 4097) greater 2048\nB = A not equal true\narray (B count) ((A equal false) count)')!))
            .toBe('2048 2048');
    } finally { runtime.dispose(); }
});
