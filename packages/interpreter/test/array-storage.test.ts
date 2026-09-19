import { describe, expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, isNativeFunction, type RankArray, type RankValue } from '../src/index.js';
import { eagerArrayStorage } from '../src/array-storage.js';
import { MemoryIo } from './support.js';

describe('eager array storage', () => {
    it('copies outer storage and shape without coercing primitive values', () => {
        const values: RankValue[] = [2n ** 100n, -0, NaN, true];
        const shape = [2, 2];
        const input = createArraySnapshot(values, shape);
        values[0] = 0n;
        shape[0] = 1;
        expect(input.items).toEqual([2n ** 100n, -0, NaN, true]);
        expect(input.shape).toEqual([2, 2]);
        expect(Object.is(eagerArrayStorage(input)!.read(1), -0)).toBe(true);
        expect(() => createArraySnapshot([1n], [2])).toThrow('shape');
        expect(() => createArraySnapshot([], [-1])).toThrow('shape');
    });

    it('uses ordinary data properties and rechecks mutated elements', () => {
        const input = createArraySnapshot([1n, 2n]);
        expect(Object.getOwnPropertyDescriptor(input, 'items')!.value).toBe(input.items);
        expect(eagerArrayStorage(input)!.read(0)).toBe(1n);
        input.items[0] = 10n;
        expect(eagerArrayStorage(input)!.read(0)).toBe(10n);
        input.items[0] = 'not numeric';
        expect(eagerArrayStorage(input)).toBeUndefined();
        input.items[0] = 4n;
        expect(eagerArrayStorage(input)!.read(0)).toBe(4n);
    });

    it('never forces lazy Rank readers to check eligibility', () => {
        const input: RankArray = {
            kind: 'array', shape: [1], itemAt: () => 1n,
            get items(): RankValue[] { throw new Error('forced lazy value'); },
        };
        expect(eagerArrayStorage(input)).toBeUndefined();
        expect(eagerArrayStorage(createArraySnapshot([input]))).toBeUndefined();
    });

    it('fuses each name over the value that name holds', () => {
        const runtime = new Interpreter();
        runtime.execute('fun total A\n return (A * 2) + reduce\nend\nA = array 1 2\nB = A');
        expect(runtime.execute('A total')).toBe(6n);
        runtime.execute('B 0 = 10');
        expect(runtime.execute('A total')).toBe(6n);
        expect(runtime.execute('B total')).toBe(24n);
        runtime.dispose();
    });

    it('observes replacement of host storage between calls', () => {
        const runtime = new Interpreter();
        runtime.execute('fun total A\n return (A * 2) + reduce\nend');
        const fn = runtime.variables.get('total');
        if (!fn || !isNativeFunction(fn)) throw new Error('total');
        const input = createArraySnapshot([1n]);
        expect(fn.call([input])).toBe(2n);
        (input as { items: RankValue[] }).items = [3n];
        expect(fn.call([input])).toBe(6n);
        runtime.dispose();
    });

    it('retains a file inserted into a numeric array before closing its scope', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, { io });
        expect(runtime.execute('use io\nfun build Path\n A = array 0\n A 0 = Path open\n return A\nend\nA = "/input" build\nFile = A 0\nFile size')).toBe(4n);
        expect(io.handles[0].closed).toBe(true);
        runtime.dispose();
    });

    it('observes changes to the matrix between Rank loop iterations', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('use numbers\nA = array shape 2 2\n 1 2 3 4\nend\nTotal = 0\nfor Row in A\n Total += Row sum\n A 1 0 = 10\nend\nTotal')).toBe(17n);
        runtime.dispose();
    });
});
