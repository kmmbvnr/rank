import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction, type RankArray } from '../src/index.js';
import { denseScalarItems, ownedArray, typedArray } from '../src/array-storage.js';
import { withInterrupt } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`compact sort pipeline (compilation=${compilation})`, () => {
    it('shares contiguous stored slices and detaches either value before writes', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const cells = BigInt64Array.from({ length: 10000 }, (_, i) => BigInt(i));
            runtime.variables.set('A', typedArray(cells));
            runtime.execute('use sequences\nS = A (1 till 9999 array)\nT = A (0 till 3)');
            const slice = denseScalarItems(runtime.variables.get('S') as RankArray) as BigInt64Array;
            expect(slice.buffer).toBe(cells.buffer);
            expect(slice.byteOffset).toBe(8);
            runtime.execute('A 1 = 42\nS 0 = 99');
            expect(runtime.execute('A 1')).toBe(42n);
            expect(runtime.execute('S 0')).toBe(99n);
            expect(runtime.execute('T 1')).toBe(1n);
            expect(runtime.execute('S 1')).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('preserves noncontiguous, repeated, empty and invalid materialized selectors', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use sequences\nA = 10 to 20 array');
            expect(runtime.execute('(A (array 3 1 4)) sum')).toBe(38n);
            expect(runtime.execute('(A (array 3 3 3)) sum')).toBe(39n);
            expect(runtime.execute('(A (5 to 1 by -2 array)) sum')).toBe(39n);
            expect(runtime.execute('(A (0 till 0 array)) len')).toBe(0n);
            expect(() => runtime.execute('A (array 0 1 11)')).toThrow('out of bounds');
            expect(() => runtime.execute('A (array 1 0 -1)')).toThrow('nonnegative');
        } finally { runtime.dispose(); }
    });

    it('converts masks without unpacking and retains independent integer cells', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 0 till 10000 array\nFlags = A mod 3 equal 0');
            diagnostics.run(() => runtime.execute('Ints = Flags integer'));
            expect(diagnostics.typedUnpacks).toBe(0);
            expect(runtime.execute('Ints sum')).toBe(3334n);
            runtime.execute('Flags 0 = false\nInts 1 = 7');
            expect(runtime.execute('Ints 0')).toBe(1n);
            expect(runtime.execute('Flags 1')).toBe(false);
            expect(runtime.execute('Ints 1')).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('keeps integer conversion shape, exact wide values and error behavior', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use sequences\nA = (array true false true false) reshape 2 2\nB = A integer');
            expect((runtime.variables.get('B') as RankArray).shape).toEqual([2, 2]);
            expect(runtime.execute('B sum')).toBe(2n);
            runtime.variables.set('Reals', typedArray(new Float64Array([3.75, -2.75])));
            expect(runtime.execute('(Reals integer) sum')).toBe(1n);
            runtime.execute('Text = array "2147483648" "1208925819614629174706176"\nWide = Text integer');
            expect(runtime.execute('Wide 1')).toBe(1n << 80n);
            expect(() => runtime.execute('(array "1" "bad") integer')).toThrow('invalid integer text');
            runtime.variables.set('Bad', typedArray(new Float64Array([1, Infinity])));
            expect(() => runtime.execute('Bad integer')).toThrow('finite real');
        } finally { runtime.dispose(); }
    });

    it.each(['', ' .ascending', ' .descending'])('sorts a rebound exclusive int64 buffer%s', direction => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('A', typedArray(new BigInt64Array([9007199254740993n, -5n, 9007199254740992n, -5n])));
            runtime.execute('A = A');
            const original = denseScalarItems(runtime.variables.get('A') as RankArray) as BigInt64Array;
            diagnostics.run(() => runtime.execute(`A = A sort${direction}`));
            const cells = denseScalarItems(runtime.variables.get('A') as RankArray) as BigInt64Array;
            const expected = [-5n, -5n, 9007199254740992n, 9007199254740993n];
            expect(Array.from(cells)).toEqual(direction === ' .descending' ? expected.reverse() : expected);
            expect(cells.buffer === original.buffer).toBe(compilation);
            expect(diagnostics.numericInPlaceSorts).toBe(compilation ? 1 : 0);
        } finally { runtime.dispose(); }
    });

    it('preserves aliases, saved slices, deferred readers and ordinary sort inputs', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 10000 to 1 by -1 array\nAlias = A\nS = A (0 till 3)\nSorted = A sort');
            diagnostics.run(() => runtime.execute('A = A sort'));
            expect(diagnostics.numericInPlaceSorts).toBe(0);
            expect(runtime.execute('Alias 0')).toBe(10000n);
            expect(runtime.execute('S sum')).toBe(29997n);
            expect(runtime.execute('Sorted 0')).toBe(1n);
            runtime.execute("B = 10000 to 1 by -1 array\nLater' = B + 1\nB = B sort");
            expect(runtime.execute('Later 0')).toBe(10001n);
        } finally { runtime.dispose(); }
    });

    it('keeps observable interruption and replaced standard functions on the ordinary path', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 10000 to 1 by -1 array');
            const signal = new Int32Array(new SharedArrayBuffer(4));
            diagnostics.run(() => withInterrupt(signal, () => runtime.execute('A = A sort')));
            expect(diagnostics.numericInPlaceSorts).toBe(0);
            runtime.execute('op = sort');
            const operation = runtime.variables.get('op')!;
            if (!isNativeFunction(operation)) throw Error('expected native');
            Object.defineProperty(operation, 'call', { value: () => ownedArray([9n, 7n]) });
            runtime.execute('A = A sort');
            expect(runtime.execute('A 0')).toBe(9n);
        } finally { runtime.dispose(); }
    });

    it('does not consume a borrowed function parameter', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`use sequences
fun X ordered
  X = X sort
  return X
end
A = 10000 to 1 by -1 array`);
            diagnostics.run(() => runtime.execute('B = A ordered'));
            expect(runtime.execute('A 0')).toBe(10000n);
            expect(runtime.execute('B 0')).toBe(1n);
            expect(diagnostics.numericInPlaceSorts).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('keeps wide integers and real signed zero on their exact fallback paths', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences');
            runtime.variables.set('Wide', ownedArray([1n << 80n, 2n, -(1n << 80n)]));
            runtime.variables.set('Real', typedArray(new Float64Array([0, -0, NaN, 1])));
            runtime.execute('Wide = Wide\nReal = Real');
            diagnostics.run(() => runtime.execute('Wide = Wide sort\nReal = Real sort'));
            expect((runtime.variables.get('Wide') as RankArray).items).toEqual([-(1n << 80n), 2n, 1n << 80n]);
            const reals = (runtime.variables.get('Real') as RankArray).items;
            expect(reals).toEqual([0, -0, NaN, 1]);
            expect(diagnostics.numericInPlaceSorts).toBe(0);
        } finally { runtime.dispose(); }
    });
});
