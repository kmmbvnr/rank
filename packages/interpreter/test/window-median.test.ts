import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { integer32Cells, realCells, readArrayItem, typedArray } from '../src/array-storage.js';
import { windowMedian } from '../src/runtime/window-median.js';
import { slidingWindow, windowValue } from '../src/sequence.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

function oracle(values: number[], width: number) {
    return Array.from({ length: Math.max(0, values.length - width + 1) }, (_, i) => {
        const sorted = values.slice(i, i + width).sort((a, b) => a - b);
        return (sorted[Math.floor((width - 1) / 2)] + sorted[Math.floor(width / 2)]) / 2;
    });
}
for (const compilation of [false, true]) describe(`sliding window median (compilation=${compilation})`, () => {
    for (const values of [[1, 7, 2, 9, 3, 5], [-3, -1, 0, -3, -5, 9], [7, 7, 7, 7, 7], [0, 100, 0, 100, 0, 100], [2147483647, 2147483646, 2147483645], [-2147483648, -2147483647, -2147483646], []]) {
        for (const width of [1, 2, 3, 5, 8]) it(`matches sorted cells, width=${width}, values=${values}`, () => {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.variables.set('Values', typedArray(Int32Array.from(values)));
                const result = runtime.execute(`use sequences\nuse stats\nWindows' = Values window ${width}\nWindows median axis 1`);
                if (!result || !isRankArray(result)) throw Error('expected array');
                expect(realCells(result)).toBeDefined();
                expect(Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i))).toEqual(oracle(values, width));
            } finally { runtime.dispose(); }
        });
    }
});
describe('window median admission', () => {
    it('bounds alternating long jumps for odd and even windows', () => {
        const values = Array.from({ length: 4096 }, (_, i) => i % 2 ? 10000 : -100);
        const source = typedArray(Int32Array.from(values));
        for (const width of [1, 2, 3, 100, 101]) {
            const windows = windowValue(source, BigInt(width));
            if (!isRankArray(windows)) throw Error('expected windows');
            const result = windowMedian(windows, [1]);
            expect(result).toBeDefined();
            expect(result && Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i))).toEqual(oracle(values, width));
        }
    });
    it('matches deterministic random windows across block boundaries', () => {
        let state = 123456;
        const values = Array.from({ length: 512 }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % 1024 - 512; });
        const source = typedArray(Int32Array.from(values));
        for (const width of [1, 2, 3, 7, 64, 255, 512]) {
            const windows = windowValue(source, BigInt(width));
            if (!isRankArray(windows)) throw Error('expected windows');
            const result = windowMedian(windows, [1]);
            expect(result).toBeDefined();
            expect(result && Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i))).toEqual(oracle(values, width));
        }
    });
    it('declines opaque readers without reading any cell', () => {
        let calls = 0;
        const source = { kind: 'array' as const, shape: [4], items: [], itemAt: () => { calls++; return 7n; } };
        const windows = windowValue(source, 2n);
        if (!isRankArray(windows)) throw Error('expected windows');
        expect(windowMedian(windows, [1])).toBeUndefined();
        expect(calls).toBe(0);
    });
    it('declines changed source geometry and shared buffers', () => {
        const source = { kind: 'array' as const, shape: [4], items: [1n, 2n, 3n, 4n] };
        const windows = windowValue(source, 2n);
        if (!isRankArray(windows)) throw Error('expected windows');
        expect(slidingWindow(windows)).toBeDefined();
        source.shape[0] = 3;
        expect(windowMedian(windows, [1])).toBeUndefined();
        const shared = typedArray(new Int32Array(new SharedArrayBuffer(16)));
        const sharedWindows = windowValue(shared, 2n);
        if (!isRankArray(sharedWindows)) throw Error('expected windows');
        expect(windowMedian(sharedWindows, [1])).toBeUndefined();
    });
    it('retains earlier outputs and falls back after host writes', () => {
        const source = typedArray(Int32Array.from([1, 4, 2, 8, 3]));
        const windows = windowValue(source, 3n);
        if (!isRankArray(windows)) throw Error('expected windows');
        const first = windowMedian(windows, [1]);
        if (!first) throw Error('expected native median');
        source.items[0] = 100n;
        const second = windowMedian(windows, [1]);
        expect(second).toBeUndefined();
        const runtime = new Interpreter(() => {}, { compilation: false });
        try {
            runtime.variables.set('Windows', windows);
            expect(runtime.execute('use stats\nNow = Windows median axis 1\nNow 0')).toBe(4);
            expect(readArrayItem(first, 0)).toBe(2);
        } finally { runtime.dispose(); }
    });
    it('retains custom median dispatch and finite-real errors', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        try {
            runtime.execute('use stats\nuse sequences');
            runtime.variables.set('Values', typedArray(Int32Array.from([1, 2, 3, 4])));
            let calls = 0;
            runtime.variables.set('median', native('median', 1, () => { calls++; return 42n; }));
            const result = runtime.execute('Values window 2 median rank 1');
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(Array.from({ length: 3 }, (_, i) => readArrayItem(result, i))).toEqual([42n, 42n, 42n]);
            expect(calls).toBe(3);
        } finally { runtime.dispose(); }
        const ordinary = new Interpreter(() => {}, { compilation: false });
        try {
            ordinary.variables.set('Values', typedArray(Float64Array.from([0.5, 1.5, 2.5])));
            expect(ordinary.execute('use stats\nuse sequences\nResult = Values window 2 median axis 1\nResult 0')).toBe(1);
            ordinary.variables.set('Bad', typedArray(Float64Array.from([1, Infinity])));
            expect(() => ordinary.execute('Result = Bad window 2 median axis 1')).toThrow('median expects finite');
        } finally { ordinary.dispose(); }
    });
    it('retains cancellation and declines inspected or host-observed work', () => {
        const source = typedArray(new Int32Array(8192));
        const windows = windowValue(source, 3n);
        if (!isRankArray(windows)) throw Error('expected windows');
        const flag = new Int32Array(new SharedArrayBuffer(12));
        expect(withInterrupt(flag, () => windowMedian(windows, [1]), () => {})).toBeUndefined();
        let calls = 0;
        const signal = { length: 1, load: () => { calls++; return 0; }, store() {}, exchange: () => 0, wait() {} };
        expect(withInterrupt(signal, () => windowMedian(windows, [1]))).toBeUndefined();
        expect(calls).toBe(0);
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => windowMedian(windows, [1]))).toThrow('Interrupted');
        expect(readArrayItem(source, 0)).toBe(0n);
    });
    it('declines sparse domains and budgeted calls', () => {
        const dense = typedArray(Int32Array.from([1, 2, 3, 4]));
        const sparse = typedArray(Int32Array.from([-2147483648, 2147483647]));
        const windows = windowValue(dense, 2n);
        if (!isRankArray(windows)) throw Error('expected window array');
        expect(windowMedian(windows, [1])).toBeDefined();
        expect(withDemandBudget(100, () => windowMedian(windows, [1]))).toBeUndefined();
        const wide = windowValue(sparse, 2n);
        if (!isRankArray(wide)) throw Error('expected window array');
        expect(windowMedian(wide, [1])).toBeUndefined();
    });
    it('declines host geometry getters without observing them during admission', () => {
        let reads = 0;
        const source = { kind: 'array' as const, get shape() { reads++; return [4]; }, items: [1n, 2n, 3n, 4n] };
        const windows = windowValue(source, 2n);
        if (!isRankArray(windows)) throw Error('expected windows');
        const before = reads;
        expect(slidingWindow(windows)).toBeUndefined();
        expect(windowMedian(windows, [1])).toBeUndefined();
        expect(reads).toBe(before);
    });
    it('does not accept a replaced window reader', () => {
        const source = typedArray(Int32Array.from([1, 2, 3]));
        const windows = windowValue(source, 2n);
        if (!isRankArray(windows)) throw Error('expected window array');
        expect(integer32Cells(source)).toBeDefined();
        Object.defineProperty(windows, 'itemAt', { value: () => 99n });
        expect(windowMedian(windows, [1])).toBeUndefined();
    });
});
