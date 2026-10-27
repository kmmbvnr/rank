import { describe, expect, it, vi } from 'vitest';
import { maskedArray, ownedArray, prepareScalarArrayReader, typedArray, writeArrayCell } from '../src/array-storage.js';
import { scalarSelection } from '../src/scalar-selection.js';
import { Interpreter, isNativeFunction } from '../src/index.js';
import { MISSING, type RankArray } from '../src/value.js';

function reader(array: RankArray) {
    const fallback = vi.fn(scalarSelection);
    return { read: prepareScalarArrayReader(array, fallback), fallback };
}

describe('live scalar array readers', () => {
    it('reads owned cells across writes without borrowing or generic selection', () => {
        const array = ownedArray([1n, 2n], [2], true);
        const { read, fallback } = reader(array);
        expect(read(0n)).toBe(1n);
        writeArrayCell(array, 0, 1n << 100n);
        expect(read(0n)).toBe(1n << 100n);
        array.items[1] = 7n;
        expect(read(1n)).toBe(7n);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('follows packed storage through widening, public exposure and type changes', () => {
        const array = typedArray(new Int32Array([1, 2]));
        const { read, fallback } = reader(array);
        expect(read(0n)).toBe(1n);
        writeArrayCell(array, 0, 2147483648n);
        expect(read(0n)).toBe(2147483648n);
        writeArrayCell(array, 1, 1n << 100n);
        expect(read(1n)).toBe(1n << 100n);
        array.items[0] = 3n;
        expect(read(0n)).toBe(3n);
        writeArrayCell(array, 0, 0.5);
        expect(read(0n)).toBe(0.5);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('keeps boolean and masked numeric cells visible', () => {
        const booleans = ownedArray([true, false], [2], true);
        const booleanReader = reader(booleans);
        expect(booleanReader.read(0n)).toBe(true);
        writeArrayCell(booleans, 0, false);
        expect(booleanReader.read(0n)).toBe(false);
        const masked = maskedArray(new BigInt64Array([5n, 9n]), new Uint32Array([1]), [2]);
        const maskedReader = reader(masked);
        expect(maskedReader.read(0n)).toBe(5n);
        expect(maskedReader.read(1n)).toBe(MISSING);
        writeArrayCell(masked, 1, 12n);
        expect(maskedReader.read(1n)).toBe(12n);
        expect(maskedReader.read(0n)).toBe(5n);
        expect(maskedReader.fallback).not.toHaveBeenCalled();
    });

    it.each([-1n, 2n, 9007199254740993n, 1n << 100n, 1n << 4096n, -(1n << 4096n)])('preserves selector errors for %s', index => {
        const array = ownedArray([1n, 2n], [2], true);
        const { read } = reader(array);
        let expected: unknown;
        try { scalarSelection(array, [index]); } catch (error) { expected = error; }
        expect(() => read(index)).toThrowError(expected as Error);
    });

    it('returns to ordinary selection after a host installs a reader', () => {
        const array = ownedArray([1n, 2n], [2], true);
        const { read, fallback } = reader(array);
        expect(read(0n)).toBe(1n);
        const itemAt = vi.fn((index: number) => BigInt(index + 40));
        Object.defineProperty(array, 'itemAt', { value: itemAt, configurable: true });
        expect(itemAt).not.toHaveBeenCalled();
        expect(read(1n)).toBe(41n);
        expect(fallback).toHaveBeenCalledOnce();
        expect(itemAt).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('observes a host replacing the shape after reader preparation', () => {
        const array = ownedArray([1n, 2n], [2], true);
        const { read, fallback } = reader(array);
        Object.defineProperty(array, 'shape', { value: [1], configurable: true });
        expect(() => read(1n)).toThrow('array index out of bounds on axis 0: 1');
        expect(fallback).toHaveBeenCalledOnce();
    });

    it('keeps a compiled reader current when linked-call callbacks change storage', () => {
        const array = ownedArray([1n], [1], true);
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => {
            calls++;
            if (calls === 2) writeArrayCell(array, 0, 11n);
            if (calls === 3) writeArrayCell(array, 0, 1n << 100n);
            if (calls === 4) Object.defineProperty(array, 'itemAt', { value: () => 37n, configurable: true });
        } });
        try {
            runtime.execute(`fun N identity
 return N
end
fun A helper N
 Total = 0
 for I in 1 to N
  Total += A 0
  Tick = I identity
  Total += A 0
 end
 return Total
end`);
            const helper = runtime.variables.get('helper');
            if (!helper || !isNativeFunction(helper)) throw new Error('missing helper');
            expect(helper.call([array, 3n])).toBe(2n * (1n << 100n) + 60n);
            expect(calls).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('does not inspect foreign or lazy cells while preparing', () => {
        const itemAt = vi.fn((index: number) => BigInt(index + 10));
        const array: RankArray = { kind: 'array', shape: [2], items: [], itemAt };
        const { read, fallback } = reader(array);
        expect(itemAt).not.toHaveBeenCalled();
        expect(read(1n)).toBe(11n);
        expect(itemAt).toHaveBeenCalledExactlyOnceWith(1);
        expect(fallback).toHaveBeenCalledOnce();
    });
});
