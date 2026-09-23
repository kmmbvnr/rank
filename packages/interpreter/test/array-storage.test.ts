import { describe, expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, isNativeFunction, type RankArray, type RankValue } from '../src/index.js';
import { eagerArrayStorage, isSharedArray } from '../src/array-storage.js';
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

    it('infers borrowed parameters so reader calls do not mark unique arrays as shared', () => {
        const runtime = new Interpreter();
        runtime.execute(`fun inspect V
  return V 0
end
A = array 10 20 30
First = A inspect`);
        const array = runtime.variables.get('A') as RankArray;
        expect(runtime.variables.get('First')).toBe(10n);
        // A must NOT be marked shared!
        expect(isSharedArray(array)).toBe(false);

        // Mutating A after inspect must happen in-place without cloning the buffer!
        const originalItems = array.items;
        runtime.execute('A 0 = 99');
        expect(array.items).toBe(originalItems);
        expect(array.items[0]).toBe(99n);
        runtime.dispose();
    });

    it('borrows through a resolved reader helper without copying the caller array', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`fun read V
  return V 0
end
fun inspect V
  return V read
end
A = array 10 20 30
First = A inspect`);
            const array = runtime.variables.get('A') as RankArray;
            expect(runtime.variables.get('First')).toBe(10n);
            expect(isSharedArray(array)).toBe(false);
            const items = array.items;
            runtime.execute('A 0 = 99');
            expect(array.items).toBe(items);
        } finally { runtime.dispose(); }
    });

    it('drops helper borrowing after the helper is redefined to return its argument', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`fun read V
  return V 0
end
fun inspect V
  return V read
end
A = array 10 20
First = A inspect`);
            expect(isSharedArray(runtime.variables.get('A') as RankArray)).toBe(false);
            runtime.execute('fun read V\n return V\nend\nB = A inspect');
            const array = runtime.variables.get('A') as RankArray;
            expect(isSharedArray(array)).toBe(true);
            runtime.execute('A 0 = 99');
            expect((runtime.variables.get('B') as RankArray).items[0]).toBe(10n);
        } finally { runtime.dispose(); }
    });

    it('keeps matrix rows on the ordinary ownership path', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`fun read V
  return V 0
end
fun inspect V
  return V read
end
A = array 1 2 3 4 shape 2 2
Row = A inspect`);
            expect(isSharedArray(runtime.variables.get('A') as RankArray)).toBe(true);
            runtime.execute('A 0 0 = 9');
            expect((runtime.variables.get('Row') as RankArray).items[0]).toBe(1n);
        } finally { runtime.dispose(); }
    });

    it('does not borrow a direct reader that returns a matrix row', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('fun read V\n return V 0\nend\nA = array 1 2 3 4 shape 2 2\nRow = A read');
            expect(isSharedArray(runtime.variables.get('A') as RankArray)).toBe(true);
            runtime.execute('A 0 0 = 9');
            expect((runtime.variables.get('Row') as RankArray).items[0]).toBe(1n);
        } finally { runtime.dispose(); }
    });

    it('keeps the same array shared when another parameter also binds it', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`fun read V
  return V 0
end
fun inspect A B
  return A read
end
Value = array 10 20`);
            const value = runtime.variables.get('Value') as RankArray;
            const inspect = runtime.variables.get('inspect');
            if (!inspect || !isNativeFunction(inspect)) throw new Error('inspect');
            expect(inspect.call([value, value])).toBe(10n);
            expect(isSharedArray(value)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('marks array shared when parameter is returned or mutated', () => {
        const runtime = new Interpreter();
        runtime.execute(`fun bump V
  V 0 = 99
  return V
end
A = array 10 20 30
B = A bump`);
        const arrayA = runtime.variables.get('A') as RankArray;
        const arrayB = runtime.variables.get('B') as RankArray;
        expect(arrayA.items[0]).toBe(10n);
        expect(arrayB.items[0]).toBe(99n);
        expect(arrayA.items).not.toBe(arrayB.items);
        runtime.dispose();
    });

    it.each([
        'A 0 = 99\n  return V 0',
        'Ignored = mutate\n  return V 0',
        'return mutate + (V 0)',
    ])('isolates writes through another name: %s', body => {
        const runtime = new Interpreter();
        try {
            expect(runtime.execute(`A = array 10 20
fun mutate
  A 0 = 99
  return 0
end
fun inspect V
  ${body}
end
A inspect`)).toBe(10n);
            expect(runtime.execute('A 0')).toBe(10n);
        } finally {
            runtime.dispose();
        }
    });

    it('protects arrays when another parameter is a callback', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`A = array 10 20
fun mutate
  A 0 = 99
  return 0
end
fun inspect V F
  return F + (V 0)
end`);
            const inspect = runtime.variables.get('inspect');
            if (!inspect || !isNativeFunction(inspect)) throw new Error('inspect');
            expect(inspect.call([
                runtime.variables.get('A')!, runtime.variables.get('mutate')!,
            ])).toBe(10n);
            expect(runtime.execute('A 0')).toBe(10n);
        } finally {
            runtime.dispose();
        }
    });

    it('copies a captured parameter before a nested function writes it', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`fun outer V
  fun mutate
    V 0 = 99
    return 0
  end
  Ignored = mutate
  return 0
end
A = array 10 20
Ignored = A outer`);
            expect(runtime.execute('A 0')).toBe(10n);
        } finally {
            runtime.dispose();
        }
    });
});
