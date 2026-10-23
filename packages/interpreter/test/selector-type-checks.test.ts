import { describe, expect, it, vi } from 'vitest';
import { formatValue, MISSING, type RankArray, type RankValue } from '../src/index.js';
import { allPresent, denseScalarItems, maskedArray, ownedArray, typedArray } from '../src/array-storage.js';
import { isIntegerCollectionSelector } from '../src/selectors.js';
import { selectValues } from '../src/value-selection.js';

describe('integer selector classification', () => {
    it.each([
        [() => typedArray(new Int32Array([1, 0])), true],
        [() => typedArray(new BigInt64Array([1n, 0n])), true],
        [() => typedArray(new Float64Array([1, 0])), false],
        [() => typedArray(new Float64Array(0)), true],
        [() => typedArray(new BigInt64Array(0)), true],
        [() => ownedArray([2n ** 100n, 0n], [2], true), true],
        [() => ownedArray(['a', 'b'], [2], true), false],
        [() => ownedArray([], [0], true), true],
    ] as const)('uses storage evidence without scanning cells (%#)', (create, expected) => {
        const value = create(), cells = denseScalarItems(value)!;
        const every = Array.prototype.every;
        const spy = vi.spyOn(Array.prototype, 'every').mockImplementation(function (this: unknown[], ...args) {
            if (this === cells) throw Error('scanned selector cells');
            return Reflect.apply(every, this, args);
        });
        try { expect(isIntegerCollectionSelector(value)).toBe(expected); }
        finally { spy.mockRestore(); }
    });

    it('does not treat masked integer storage as all-integer cells', () => {
        expect(isIntegerCollectionSelector(maskedArray(new BigInt64Array([0n, 1n]), allPresent(2)))).toBe(true);
        expect(isIntegerCollectionSelector(maskedArray(new BigInt64Array([0n, 1n]), new Uint32Array([1])))).toBe(false);
        expect(isIntegerCollectionSelector(ownedArray([0n, MISSING]))).toBe(false);
    });

    it('updates the answer after integer storage becomes real or text', () => {
        const value = typedArray(new BigInt64Array([0n, 1n]));
        expect(isIntegerCollectionSelector(value)).toBe(true);
        value.items[0] = 0.5;
        expect(isIntegerCollectionSelector(value)).toBe(false);
        value.items[0] = 0n;
        expect(isIntegerCollectionSelector(value)).toBe(true);
        value.items[0] = 'a';
        expect(isIntegerCollectionSelector(value)).toBe(false);
    });

    it('retains host reads and failures when no storage evidence exists', () => {
        const reads: number[] = [];
        const items = [0n, 1n];
        const value: RankArray = { kind: 'array', shape: [2], items: new Proxy(items, {
            get(target, key, receiver) {
                if (key === '0' || key === '1') reads.push(Number(key));
                if (key === '1') throw Error('host cell');
                return Reflect.get(target, key, receiver) as RankValue;
            },
        }) };
        expect(() => isIntegerCollectionSelector(value)).toThrow('host cell');
        expect(reads).toEqual([0, 1]);
    });
});

describe('table field selector classification', () => {
    it.each([
        () => typedArray(new Int32Array([1, 0])),
        () => typedArray(new BigInt64Array([1n, 0n])),
        () => ownedArray([1n, 0n], [2], true),
    ])('does not scan integer selectors for field names (%#)', create => {
        const source = ownedArray([10n, 20n]), selector = create(), cells = denseScalarItems(selector)!;
        const some = Array.prototype.some;
        const spy = vi.spyOn(Array.prototype, 'some').mockImplementation(function (this: unknown[], ...args) {
            if (this === cells) throw Error('scanned selector cells');
            return Reflect.apply(some, this, args);
        });
        try { expect(formatValue(selectValues(new Set(), [source, selector]))).toBe('20 10'); }
        finally { spy.mockRestore(); }
    });

    it('rejects a real selector without scanning it for field names', () => {
        const source = ownedArray([10n, 20n]), selector = typedArray(new Float64Array([1, 0]));
        const cells = denseScalarItems(selector)!, some = Array.prototype.some;
        const spy = vi.spyOn(Array.prototype, 'some').mockImplementation(function (this: unknown[], ...args) {
            if (this === cells) throw Error('scanned selector cells');
            return Reflect.apply(some, this, args);
        });
        try { expect(() => selectValues(new Set(), [source, selector])).toThrow('index array has real elements'); }
        finally { spy.mockRestore(); }
    });

    const rows = () => ownedArray([
        { kind: 'object', entries: new Map<string, RankValue>([['x', 1n], ['y', 2n]]) },
        { kind: 'object', entries: new Map<string, RankValue>([['x', 3n], ['y', 4n]]) },
    ]);

    it.each([
        () => ownedArray(['y', 'x'], [2], true),
        () => ownedArray([{ kind: 'label', name: 'y' }, { kind: 'label', name: 'x' }]),
    ])('preserves text and label projections (%#)', create => {
        expect(formatValue(selectValues(new Set(['tables']), [rows(), create()]))).toBe('2 1 4 3');
    });

    it.each([
        () => typedArray(new Int32Array(0)),
        () => typedArray(new BigInt64Array(0)),
        () => typedArray(new Float64Array(0)),
    ])('keeps empty selector interpretation dependent on the tables module (%#)', create => {
        expect(selectValues(new Set(), [ownedArray([1n, 2n]), create()])).toMatchObject({ shape: [0] });
        expect(selectValues(new Set(['tables']), [rows(), create()])).toMatchObject({ shape: [2, 0] });
    });

    it('uses updated storage evidence after an integer selector becomes text', () => {
        const selector = typedArray(new BigInt64Array([0n]));
        expect(selectValues(new Set(['tables']), [rows(), selector])).toMatchObject({ shape: [1] });
        selector.items[0] = 'x';
        expect(formatValue(selectValues(new Set(['tables']), [rows(), selector]))).toBe('1 3');
    });

    it('retains failures in field lists without trusted storage', () => {
        const selector: RankArray = { kind: 'array', shape: [1], items: [] };
        Object.defineProperty(selector.items, '0', { get() { throw Error('host field'); } });
        expect(() => selectValues(new Set(['tables']), [rows(), selector])).toThrow('host field');
    });
});
