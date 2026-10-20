import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type RankArray, type RankValue } from '../src/index.js';
import { ownedArray, typedArray, maskedArray, allPresent, readArrayItem, derivedArray } from '../src/array-storage.js';
import { sliceSource } from '../src/slice-source.js';
import { registerScalarView } from '../src/integer-view.js';
import { numericKernel } from '../src/numeric-kernels.js';
import { mapDenseArrays } from '../src/tensor.js';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`stored slice arithmetic (compilation=${compilation})`, () => {
    it.each([
        ['(A drop 1) - (A take 5)', '1 1 1 1 1'],
        ['A (1 to #) - A (0 till 5)', '1 1 1 1 1'],
        ['A (5 to # by -2) - A (0 to 4 by 2)', '5 1 -3'],
        ['((A drop 1) take 4) - A (0 till 4)', '1 1 1 1'],
        ['(A drop 99) + (A take 0)', ''],
        ['(A take 99) * 2', '2 4 6 8 10 12'],
        ['(A drop 0) + 1.5', '2.5 3.5 4.5 5.5 6.5 7.5'],
    ])('handles %s', (expression, expected) => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('use sequences\nA = 1 to 6 array');
            expect(formatValue(r.execute(expression)!)).toBe(expected);
        } finally { r.dispose(); }
    });

    it('borrows direct and named operands without building lazy cell caches', () => {
        const r = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nB = A * A');
            const result = diagnostics.run(() => r.execute(`
Left = B drop 1
Right = B (0 till 9999)
R = Left - Right
R sum`));
            expect(result).toBe(99999999n);
            expect(diagnostics.cellsComputed).toBe(0);
            // A retained result and both inputs remain independent of a later write.
            r.execute('B 0 = 99');
            expect(r.execute('Right 0')).toBe(1n);
            expect(r.execute('Left 0')).toBe(4n);
            expect(r.execute('R sum')).toBe(99999999n);
            expect(r.execute('(Right + 1) 0')).toBe(2n);
            // B is packed, so its slice copies on write instead of refusing it.
            r.execute('Right 0 = 5');
            expect(r.execute('Right 0')).toBe(5n);
            expect(r.execute('Left 0')).toBe(4n);
        } finally { r.dispose(); }
    });

    it('handles leading-axis tensor slices, columns and broadcasting', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('use sequences\nA = (1 to 12 array) reshape 4 3');
            expect(formatValue(r.execute('((A drop 1) - (A take 3)) reshape 9')!)).toBe('3 3 3 3 3 3 3 3 3');
            expect(formatValue(r.execute('((A (1 to #) #) - (A (0 till 3) #)) reshape 9')!)).toBe('3 3 3 3 3 3 3 3 3');
            expect(formatValue(r.execute('((A # (1 to 2)) + (array 10 20)) reshape 8')!)).toBe('12 23 15 26 18 29 21 32');
        } finally { r.dispose(); }
    });

    it('keeps failing arithmetic lazy, and leaves unread callbacks unread', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute(`use sequences
A = 1 to 2000 array
R = (A drop 1) // ((A take 1999) - 1)`);
            expect(r.execute('R 1')).toBe(3n);
            expect(() => r.execute('R 0')).toThrow(/zero/);
            r.execute(`fun X checked rank 0
  if X equal 2000
    .overread raise
  end
  return X
end
Lazy = (1 to 2000) checked
S = (Lazy drop 1) + (Lazy take 1999)`);
            expect(r.execute('S 0')).toBe(3n);
            expect(() => r.execute('S 1998')).toThrow('overread');
        } finally { r.dispose(); }
    });

    it('preserves slice binding contracts after a numeric read', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('use sequences\nA = 1 to 2000 array\nCut = A drop 1\nR = Cut + 1');
            r.execute('Cut = (((1 to 2000 array) real rank 0) drop 1)');
            expect(() => r.execute('Cut 0')).toThrow(/cannot receive/);
        } finally { r.dispose(); }
    });
});

const subtract = numericKernel('-', () => { throw new Error('unexpected fallback'); });

describe('stored slice kernel boundaries', () => {
    for (const size of [1023, 1024, 65535, 65536, 65537]) {
        it(`handles ${size} selected integer cells without narrowing BigInts`, () => {
            const base = 2n ** 100n;
            const source = ownedArray(Array.from({ length: size + 1 }, (_, i) => base + BigInt(i)), [size + 1], true);
            const a = sliceSource(source)!.slice(1n, true) as RankArray;
            const b = sliceSource(source)!.slice(BigInt(size), false) as RankArray;
            const result = mapDenseArrays(a, b, subtract, 1, true)!;
            expect(result.shape).toEqual([size]);
            expect(readArrayItem(result, 0)).toBe(1n);
            expect(readArrayItem(result, size - 1)).toBe(1n);
            expect(readArrayItem(a, 0)).toBe(base + 1n);
        });
    }

    it.each(['integer', 'real'] as const)('reads %s typed storage without copying slice inputs', kind => {
        const cells = kind === 'integer' ? BigInt64Array.from({ length: 2001 }, (_, i) => BigInt(i))
            : Float64Array.from({ length: 2001 }, (_, i) => i + 0.5);
        const source = typedArray(cells, [2001]);
        const a = sliceSource(source)!.slice(1n, true) as RankArray;
        const b = sliceSource(source)!.slice(2000n, false) as RankArray;
        const op = numericKernel('-', (a, b) => Number(a) - Number(b));
        const result = mapDenseArrays(a, b, op, 1)!;
        expect(readArrayItem(result, 0)).toBe(kind === 'integer' ? 1n : 1);
        expect(readArrayItem(result, 1999)).toBe(kind === 'integer' ? 1n : 1);
    });

    it('uses typed real kernels for named and descending slices, without bypassing contracts', () => {
        const r = new Interpreter();
        try {
            r.variables.set('Values', typedArray(Float64Array.from([1, 2, 3, 4, 5, 6]), [6]));
            r.execute('use sequences\nA = Values (1 to # by 2)\nB = Values (0 to 4 by 2)');
            for (const [op, expected] of [
                ['+', [3, 7, 11]], ['-', [1, 1, 1]], ['*', [2, 12, 30]],
                ['/', [2, 4 / 3, 6 / 5]], ['**', [2, 64, 7776]],
            ] as const) {
                expect((r.execute(`A ${op} B`) as RankArray).items).toEqual([...expected]);
            }
            expect((r.execute('(Values (5 to # by -2)) - B') as RankArray).items).toEqual([5, 1, -3]);
            r.execute('Cut = (1 to 6 array) drop 1\nSeen = Cut + 1\nCut = Values (1 to #)\nR = Cut + 1.0');
            expect(() => r.execute('R 0')).toThrow(/cannot receive/);
        } finally { r.dispose(); }
    });

    it('does not speculate through an unestablished arbitrary check', () => {
        const source = typedArray(Float64Array.from([1, 2, 3]), [3]);
        let checks = 0;
        const view = registerScalarView(derivedArray([3], [source], index => readArrayItem(source, index)),
            source, index => index, { accepts: () => false, check: value => { checks++; return value; },
                linear: () => ({ offset: 0, stride: 1 }) });
        expect(mapDenseArrays(view, view, subtract, 1, true)).toBeUndefined();
        expect(checks).toBe(0);
    });

    it('keeps material selections writable and isolates aliases on first write', () => {
        const r = new Interpreter();
        try {
            r.variables.set('Typed', typedArray(Float64Array.from([1, 2, 3, 4]), [4]));
            r.execute('use sequences\nPart = Typed (1 to #)\nAlias = Part\nPart 0 = 9.0');
            expect(r.execute('Part 0')).toBe(9);
            expect(r.execute('Alias 0')).toBe(2);
            expect(r.execute('Typed 1')).toBe(2);
            r.execute('A = 1 to 65537 array\nCut = A (1 to #)\nCut 0 = 0');
            expect(r.execute('Cut 0')).toBe(0n);
            expect(r.execute('A 1')).toBe(2n);
        } finally { r.dispose(); }
    });

    it('retains masked validity and integer overflow semantics', () => {
        const r = new Interpreter();
        try {
            const validity = allPresent(2001);
            validity[0] &= ~(1 << 1);
            r.variables.set('A', maskedArray(Float64Array.from({ length: 2001 }, (_, i) => i), validity, [2001]));
            r.variables.set('B', typedArray(BigInt64Array.from([-(2n ** 63n), 2n ** 63n - 1n]), [2]));
            r.execute('use sequences\nR = (A drop 1) - (A take 2000)');
            expect(formatValue(r.execute('R 0')!)).toBe('.NA');
            expect(formatValue(r.execute('R 1')!)).toBe('.NA');
            expect(r.execute('R 2')).toBe(1);
            expect(r.execute('((B drop 1) - (B take 1)) 0')).toBe(2n ** 64n - 1n);
        } finally { r.dispose(); }
    });

    it('does not probe host getters when selecting a kernel', () => {
        let reads = 0;
        const source: RankArray = { kind: 'array', shape: [2001], itemAt: i => { reads++; return BigInt(i); },
            get items(): RankValue[] { throw new Error('host materialization'); } };
        const a = sliceSource(source)!.slice(1n, true) as RankArray;
        expect(mapDenseArrays(a, a, subtract, 1)).toBeUndefined();
        expect(reads).toBe(0);
    });

    it('retains cancellation checkpoints in a borrowed kernel', () => {
        const source = ownedArray(Array(10000).fill(1n), [10000], true);
        const cut = sliceSource(source)!.slice(1n, true) as RankArray;
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => mapDenseArrays(cut, cut, subtract, 1))).toThrow(InterruptedError);
    });
});
