import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';
import { borrowArrayStorage, filledArray, integer32Cells, prepareScalarArrayReader, prepareScalarArrayWriter, readArrayItem, typedElementKind, writeInteger32Cells } from '../src/array-storage.js';

const N = 10000;

describe('compact integer counters', () => {
    it('allocates four-byte cells and exposes Rank integers', () => {
        const array = filledArray(-2147483648n, [N]);
        expect(integer32Cells(array)?.byteLength).toBe(N * 4);
        expect(typedElementKind(array)).toBe('integer');
        expect(readArrayItem(array, N - 1)).toBe(-2147483648n);
        expect(array.items[0]).toBe(-2147483648n);
    });

    it('widens without truncation and keeps borrowed readers current', () => {
        const array = filledArray(0n, [N]);
        const borrowed = borrowArrayStorage(array);
        const write = prepareScalarArrayWriter(borrowed);
        const read = prepareScalarArrayReader(borrowed, () => { throw Error('unexpected fallback'); });
        write(0, 2147483647n);
        write(1, -2147483648n);
        expect(integer32Cells(array)).toBeDefined();
        write(2, 2147483648n);
        expect(integer32Cells(array)).toBeUndefined();
        expect(read(0n)).toBe(2147483647n);
        expect(read(1n)).toBe(-2147483648n);
        expect(read(2n)).toBe(2147483648n);
        write(3, -(1n << 80n));
        expect(read(3n)).toBe(-(1n << 80n));
        expect(array.items.slice(0, 3)).toEqual([2147483647n, -2147483648n, 2147483648n]);
    });

    it.each([true, false])('preserves aliases, selections, exact sums and overflow (compilation=%s)', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`A = array shape ${N} fill 0\nB = A\nS = A (0 to 2)\nA (0 to 2) += 2147483647\nA 1 += 1\nA 2 -= 4294967296`);
            expect(runtime.execute('A sum')).toBe(2147483646n);
            expect(runtime.execute('B sum')).toBe(0n);
            expect(runtime.execute('S sum')).toBe(0n);
            expect(runtime.execute('A 0')).toBe(2147483647n);
            expect(runtime.execute('A 1')).toBe(2147483648n);
            expect(runtime.execute('A 2')).toBe(-2147483649n);
            runtime.execute(`M = array shape 100 100 fill -7\nRow = M 3`);
            expect(runtime.execute('Row sum')).toBe(-700n);
            runtime.execute('M 3 0 = 8');
            expect(runtime.execute('Row 0')).toBe(-7n);
        } finally { runtime.dispose(); }
    });

    it.each([{}, { numberLoopCompilation: false }, { compilation: false }])('publishes prior writes on errors and replays unsafe arithmetic (%j)', options => {
        const runtime = new Interpreter(undefined, options);
        try {
            runtime.execute(`A = array shape ${N} fill 0`);
            expect(() => runtime.execute(`for I in 0 to 3
  A I += 1
  Quotient = 10 // (2 - I)
end`)).toThrow(/division by zero/);
            expect(runtime.execute('A sum')).toBe(3n);
            expect(runtime.execute('A 2')).toBe(1n);
            const diagnostics = new RuntimeDiagnostics();
            diagnostics.run(() => runtime.execute(`A = array shape ${N} fill 0
for I in 0 to 3
  A I = 9007199254740991 + I
end`));
            expect(runtime.execute('A sum')).toBe(4n * 9007199254740991n + 6n);
            expect(runtime.execute('A 3')).toBe(9007199254740994n);
            if (!('numberLoopCompilation' in options) && !('compilation' in options)) {
                expect(diagnostics.numberLoopOverflows).toBe(1);
            }
        } finally { runtime.dispose(); }
    });

    it('refuses a bulk commit before any store when one cell needs widening', () => {
        const array = filledArray(7n, [N]);
        const cells = new Float64Array(N).fill(8);
        const dirty = new Uint8Array(N).fill(1);
        cells[1] = 2147483648;
        expect(writeInteger32Cells(array, cells, dirty)).toBe(false);
        expect(readArrayItem(array, 0)).toBe(7n);
        expect(readArrayItem(array, 1)).toBe(7n);
    });

    it('keeps a prepared compact reader current through exposure and kind changes', () => {
        const array = filledArray(-1n, [N]);
        const borrowed = borrowArrayStorage(array);
        const write = prepareScalarArrayWriter(borrowed);
        const read = prepareScalarArrayReader(borrowed, () => { throw Error('unexpected fallback'); });
        expect(read(0n)).toBe(-1n);
        expect(() => read(-1n)).toThrow(/out of bounds/);
        expect(() => read(BigInt(N))).toThrow(/out of bounds/);
        expect(() => read(1n << 80n)).toThrow(/out of bounds/);
        array.items[0] = 23n;
        expect(read(0n)).toBe(23n);
        write(0, 0.5);
        expect(read(0n)).toBe(0.5);
    });

    it('preserves compact indexed reads and aliases in exact compiled loops', () => {
        const runtime = new Interpreter(undefined, { numberLoopCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const total = diagnostics.run(() => runtime.execute(`A = array shape ${N} fill -1
B = A
Total = 9007199254740992
for I in 0 till ${N}
  A I = I - 5000
  Total += A I
end
Total`));
            expect(total).toBe(9007199254740992n - 5000n);
            expect(runtime.execute('B sum')).toBe(-BigInt(N));
            expect(diagnostics.compiledLoops).toBe(1);
            expect(diagnostics.typedUnpacks).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('sums compact cells beyond the safe Number range exactly', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('A = array shape 4194305 fill 2147483647');
            expect(runtime.execute('A sum')).toBe(4194305n * 2147483647n);
            runtime.execute('A (0 to 9) *= -1');
            expect(runtime.execute('A sum')).toBe((4194305n - 20n) * 2147483647n);
        } finally { runtime.dispose(); }
    });

    it('keeps repeated-address increments and scan results exact', () => {
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        try {
            const total = diagnostics.run(() => runtime.execute(`
A = array shape ${N} fill 0
for I in 0 till 50000
  A (I mod 37) += 2
end
Total = 0
for I in 0 till ${N}
  Total += A I
end
Total`));
            expect(total).toBe(100000n);
            expect(runtime.execute('A sum')).toBe(100000n);
            const array = runtime.variables.get('A');
            expect(array && isRankArray(array) && integer32Cells(array)).toBeInstanceOf(Int32Array);
            expect(diagnostics.typedUnpacks).toBe(0);
        } finally { runtime.dispose(); }
    });
});
