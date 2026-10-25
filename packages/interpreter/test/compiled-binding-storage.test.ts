import { describe, expect, it } from 'vitest';
import { Interpreter, DemandBudgetExhausted, withDemandBudget, isRankArray } from '../src/index.js';
import { materializedArrayItems, ownedArray, readArrayItem } from '../src/array-storage.js';

const cases = [
    { body: 'Saved = X take 2\n return Saved', shape: [2], expected: [1n, 2n] },
    { body: 'Saved = X drop 1\n return Saved', shape: [2], expected: [2n, 3n] },
    { body: 'First = X take 3\n Saved = First drop 1\n return Saved', shape: [2], expected: [2n, 3n] },
    { body: 'Saved = X take 0\n return Saved', shape: [0], expected: [] },
] as const;

describe.each([false, true])('compiled completion boundaries (compilation=%s)', compilation => {
    it.each(cases)('stores completed local array cells: $body', ({ body, shape, expected }) => {
        let kernels = 0;
        const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => kernels++ });
        const source = ownedArray([1n, 2n, 3n]);
        runtime.variables.set('Input', source);
        try {
            const result = runtime.execute(`use sequences\nfun X probe\n ${body}\nend\nInput probe`);
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(result.shape).toEqual(shape);
            expect(materializedArrayItems(result)).toEqual(expected);
            if (compilation) expect(kernels).toBeGreaterThan(0);
            else expect(kernels).toBe(0);
            Object.defineProperty(source, 'itemAt', { value: () => { throw Error('source reader changed'); } });
            expect(result.items).toEqual(expected);
        } finally { runtime.dispose(); }
    });

    it('preserves rank and exact integers when completing a tensor slice', () => {
        let kernels = 0;
        const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => kernels++ });
        const exact = 2n ** 90n + 1n;
        const input = ownedArray([exact, -exact, 3n, 4n, 5n, 6n], [2, 3]);
        runtime.variables.set('Input', input);
        try {
            const result = runtime.execute('use sequences\nfun X firstrow\n Saved = X take 1\n return Saved\nend\nInput firstrow');
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(result.shape).toEqual([1, 3]);
            expect(materializedArrayItems(result)).toEqual([exact, -exact, 3n]);
            if (compilation) expect(kernels).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('completes ordinary locals even when their ready argument uses a deferred parameter', () => {
        let kernels = 0;
        const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => kernels++ });
        try {
            const result = runtime.execute("use sequences\nfun X' prefix\n Saved = X take 2\n return Saved\nend\n(array 1 2 3) prefix");
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(materializedArrayItems(result)).toEqual([1n, 2n]);
            if (compilation) expect(kernels).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('finishes a local before returning or publishing the caller binding', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('Input', ownedArray(Array.from({ length: 4096 }, (_, i) => BigInt(i))));
        try {
            runtime.execute('use sequences\nfun X prefix\n Saved = X take 4095\n return Saved\nend\nKept = array 9');
            runtime.execute('Input prefix'); // Prepare type guards outside the bounded demands.
            expect(() => withDemandBudget(10, () => runtime.execute('Input prefix'))).toThrow(DemandBudgetExhausted);
            expect(() => withDemandBudget(10, () => runtime.execute('Kept = Input prefix'))).toThrow(DemandBudgetExhausted);
            expect(runtime.execute('Kept 0')).toBe(9n);
            const result = runtime.execute('Input prefix');
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(materializedArrayItems(result)).toBeDefined();
            expect(readArrayItem(result, 4094)).toBe(4094n);
        } finally { runtime.dispose(); }
    });

    it('keeps a bare return as a view rather than adding a completion boundary', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const result = runtime.execute('use sequences\nfun X prefix\n return X take 2\nend\n(array 1 2 3) prefix');
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(materializedArrayItems(result)).toBeUndefined();
            expect(result.items).toEqual([1n, 2n]);
        } finally { runtime.dispose(); }
    });

    it('completes a linked callee array result before publishing a loop binding', () => {
        let loops = 0;
        const runtime = new Interpreter(() => {}, {
            compilation, scalarEntryCompilation: false, onIntegerLoopExecuted: () => loops++,
        });
        const input = ownedArray([1n, 2n, 3n]);
        runtime.variables.set('Input', input);
        try {
            runtime.execute(`use sequences
fun X prefix
 return X take 2
end
Saved = array 0 0
for I in 1 to 2
 Saved = Input prefix
end`);
            const saved = runtime.variables.get('Saved')!;
            if (!isRankArray(saved)) throw Error('expected array');
            expect(materializedArrayItems(saved)).toEqual([1n, 2n]);
            expect(loops).toBe(compilation ? 1 : 0);
            Object.defineProperty(input, 'itemAt', { value: () => { throw Error('source reader changed'); } });
            expect(readArrayItem(saved, 0)).toBe(1n);
        } finally { runtime.dispose(); }
    });
});


describe.each([false, true])('snapshots inside borrowed write regions (compilation=%s)', compilation => {
    it.each([
        { fill: '0', update: '(Phase + 1) * -5000000000', expected: -5000000000n },
        { fill: '0.0', update: '(Phase + 1) * 0.5', expected: 0.5 },
    ])('keeps a copied slice independent of later stores: $fill', ({ fill, update, expected }) => {
        let loops = 0;
        const runtime = new Interpreter(() => {}, {
            compilation, scalarEntryCompilation: false, numberLoopCompilation: false,
            onIntegerLoopExecuted: () => loops++,
        });
        try {
            runtime.execute(`use sequences
A = array shape 70000 fill ${fill}
Saved = array shape 0 fill ${fill}
for Phase in 0 to 1
 if Phase equal 1
  Saved = A (0 till 2) copy
 end
 A 0 = ${update}
end`);
            expect(runtime.execute('Saved 0')).toBe(expected);
            expect(runtime.execute('A 0')).toBe(typeof expected === 'bigint' ? expected * 2n : expected * 2);
            expect(loops).toBe(compilation ? 1 : 0);
        } finally { runtime.dispose(); }
    });
});
