import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { mapIntegerBits } from '../src/jit/bit-array-kernel.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
import { InterruptedError, withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import type { RankArray } from '../src/value.js';

const wide = (1n << 4097n) | (1n << 128n) | (1n << 31n) | 5n;

describe.each([false, true])('bulk bit (compilation=%s)', compilation => {
    it.each([
        ['0 to 4200', Array.from({ length: 4201 }, (_, i) => BigInt(i))],
        ['4200 to 0 by -3', Array.from({ length: 1401 }, (_, i) => BigInt(4200 - i * 3))],
        ['array 4097 0 31 31 128 9007199254740993', [4097n, 0n, 31n, 31n, 128n, 9007199254740993n]],
    ] as const)('reads arbitrary positions: %s', (positions, indices) => {
        const rt = new Interpreter(() => {}, { compilation });
        try {
            const result = rt.execute(`use bits\nPositions = ${positions}\n${wide} bit Positions`);
            expect(result).toBeDefined();
            expect(formatValue(result!)).toBe(formatValue(ownedArray(indices.map(i =>
                i > 4097n ? false : (wide & (1n << i)) !== 0n))));
        } finally { rt.dispose(); }
    });

    it('broadcasts both operands and retains exact wide values', () => {
        const rt = new Interpreter(() => {}, { compilation });
        try {
            rt.execute('use bits');
            const values = [0n, 0xffffffffn, wide, 1n << 63n];
            const positions = [0n, 31n, 32n, 63n, 128n, 4097n];
            rt.variables.set('Values', ownedArray(values, [4, 1]));
            rt.variables.set('Positions', ownedArray(positions, [1, 6]));
            const result = rt.execute('Values bit Positions') as RankArray;
            expect(result.shape).toEqual([4, 6]);
            expect(Array.from({ length: 24 }, (_, i) => readArrayItem(result, i)))
                .toEqual(values.flatMap(v => positions.map(p => (v & (1n << p)) !== 0n)));
        } finally { rt.dispose(); }
    });

    it('composes masks and reductions and rechecks replaced bindings', () => {
        const rt = new Interpreter(() => {}, { compilation });
        try {
            rt.execute(`use bits\nuse sequences\nN = 0 to 5000\nBits = ${wide}`);
            expect(rt.execute('N (not (Bits bit N)) sum')).toBe(12502500n - 4258n);
            expect(rt.execute('(Bits bit N) count')).toBe(5n);
            expect(rt.variables.get('Bits')).toBe(wide);
            rt.variables.set('bit', native('replacement', 2, () => false));
            expect(rt.execute('(Bits bit N) count')).toBe(0n);
        } finally { rt.dispose(); }
    });

    it('avoids scalar ranked work for a whole mask pipeline', () => {
        const rt = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            rt.execute(`use bits\nN = 1 to 5000\nBits = ${wide}`);
            expect(diagnostics.run(() => rt.execute('N (not (Bits bit N)) sum')))
                .toBe(12502500n - 4258n);
            expect(diagnostics.cellsComputed).toBeLessThan(10);
        } finally { rt.dispose(); }
    });

    it('retains a completed mask across source writes', () => {
        const rt = new Interpreter(() => {}, { compilation });
        try {
            rt.execute('use bits\nValues = array 1 2 3\nMask = Values bit 0\nValues 0 = 0');
            expect(rt.execute('Mask 0')).toBe(true);
            expect(rt.execute('(Values bit 0) 0')).toBe(false);
        } finally { rt.dispose(); }
    });

    it('keeps later domain failures unread when selecting a valid cell', () => {
        const rt = new Interpreter(() => {}, { compilation });
        try {
            rt.execute('use bits\nPositions = array 0 -1\nValues = array 1 -1');
            expect(rt.execute('(1 bit Positions) 0')).toBe(true);
            expect(rt.execute('(Values bit 0) 0')).toBe(true);
            expect(() => rt.execute('(1 bit Positions) 1')).toThrow('shift count must be nonnegative');
            expect(() => rt.execute('(Values bit 0) 1')).toThrow('bit expects a nonnegative integer');
        } finally { rt.dispose(); }
    });
});

describe('bulk bit demand guards', () => {
    it('declines invalid domains without exposing partial results', () => {
        expect(mapIntegerBits(-1n, ownedArray([0n]))).toBeUndefined();
        expect(mapIntegerBits(1n, ownedArray([0n, -1n]))).toBeUndefined();
        expect(mapIntegerBits(ownedArray([1n, -1n]), 0n)).toBeUndefined();
        expect(mapIntegerBits(1n, ownedArray([0.5]))).toBeUndefined();
    });

    it('does not read opaque sources speculatively', () => {
        let reads = 0;
        const source: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt() { reads++; return 0n; } };
        expect(mapIntegerBits(1n, source)).toBeUndefined();
        expect(reads).toBe(0);
    });

    it('handles empty frames and reads checked slices', () => {
        expect(mapIntegerBits(-1n, ownedArray([], [0]))).toBeUndefined();
        const rt = new Interpreter(() => {});
        try {
            rt.execute('use bits\nPositions = 0 to 200\nSlice = Positions (10 to 100 by 3)');
            const result = rt.execute(`${wide} bit Slice`) as RankArray;
            expect(Array.from({ length: 31 }, (_, i) => readArrayItem(result, i)))
                .toEqual(Array.from({ length: 31 }, (_, i) => (wide & (1n << BigInt(10 + 3 * i))) !== 0n));
            expect((rt.execute('(-1 bit (array shape 0 fill 0))') as RankArray).shape).toEqual([0]);
        } finally { rt.dispose(); }
    });

    it('keeps host polling and demand budgets on the ordinary path', () => {
        const positions = ownedArray([0n, 1n]);
        const signal: InterruptSignal = { length: 1, load: () => 0,
            store: () => {}, exchange: () => 0, wait: () => {} };
        expect(withInterrupt(signal, () => mapIntegerBits(1n, positions))).toBeUndefined();
        expect(withDemandBudget(100, () => mapIntegerBits(1n, positions))).toBeUndefined();
    });

    it('propagates cancellation without retrying scalar work', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const positions = ownedArray(Array.from({ length: 4096 }, (_, i) => BigInt(i)));
        signal[0] = 1;
        expect(() => withInterrupt(signal, () => mapIntegerBits(1n, positions)))
            .toThrow(InterruptedError);
    });
});
