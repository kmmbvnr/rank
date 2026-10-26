import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';

// Native extrema must keep demand, completion and scalar tie semantics while
// composing with arithmetic; no operand is read merely to prepare a kernel.
describe.each([false, true])('native extrema plans (compilation=%s)', compilation => {
    it.each([['min', 16n], ['max', 20n]] as const)('fuses %s between deferred arithmetic stages', (operation, expected) => {
        let entries = 0;
        const runtime = new Interpreter(undefined, { compilation, onTensorKernelExecuted: () => entries++ });
        const d = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Input', ownedArray([1n, 2n, 3n]));
            runtime.execute(`use sequences
Shifted' = Input + 1
Clipped' = Shifted ${operation} 3
Scaled' = Clipped * 2`);
            expect(entries).toBe(0);
            expect(d.run(() => runtime.execute('Scaled sum'))).toBe(expected);
            expect(d.run(() => runtime.execute('Scaled sum'))).toBe(expected);
            expect(entries).toBe(compilation ? 2 : 0);
            if (compilation) expect(d.cellsComputed).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each([['min', 18n], ['max', 39n]] as const)('broadcasts %s over rows', (operation, expected) => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('Input', ownedArray([1n, 2n, 3n, 4n, 5n, 6n], [2, 3]));
            runtime.variables.set('Bounds', ownedArray([0n, 10n], [2, 1]));
            expect(runtime.execute(`use sequences
Shifted' = Input + 1
Clipped' = Shifted ${operation} Bounds
Clipped sum`)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('retains completed snapshots and independent later demands', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute(`use sequences
Input = array 1 2 3
Shifted' = Input + 1
Clipped' = Shifted max 3
Saved = Clipped
Saved 0 = 99
Clipped sum`)).toBe(10n);
            expect(runtime.execute('Saved sum')).toBe(106n);
        } finally { runtime.dispose(); }
    });

    it('does not read unused host plans or change host read order', () => {
        const reads: number[] = [];
        const input: RankArray = { kind: 'array', shape: [3], items: [],
            itemAt: index => { reads.push(index); return BigInt(index); } };
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('Input', input);
            runtime.execute("use sequences\nShifted' = Input + 1\nClipped' = Shifted max 2");
            expect(reads).toEqual([]);
            expect(runtime.execute('Clipped sum')).toBe(7n);
            expect(reads).toEqual([0, 1, 2]);
        } finally { runtime.dispose(); }
    });

    it('preserves signed zero ties and NaN fallback', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('Input', ownedArray([-0, 0, NaN]));
            const saved = runtime.execute("use sequences\nClipped' = Input min 0.0\nSaved = Clipped");
            if (saved === undefined || !isRankArray(saved)) throw Error('expected array');
            expect(Object.is(readArrayItem(saved, 0), -0)).toBe(true);
            expect(Object.is(readArrayItem(saved, 1), 0)).toBe(true);
            expect(readArrayItem(saved, 2)).toBeNaN();
        } finally { runtime.dispose(); }
    });

    it('keeps the first signed zero in a compiled tie', () => {
        let entries = 0;
        const runtime = new Interpreter(undefined, { compilation, onTensorKernelExecuted: () => entries++ });
        try {
            runtime.variables.set('Input', ownedArray([-0, 0]));
            const saved = runtime.execute("use sequences\nClipped' = Input min 0.0\nSaved = Clipped");
            if (saved === undefined || !isRankArray(saved)) throw Error('expected array');
            expect(Object.is(readArrayItem(saved, 0), -0)).toBe(true);
            expect(Object.is(readArrayItem(saved, 1), 0)).toBe(true);
            expect(entries).toBe(compilation ? 1 : 0);
        } finally { runtime.dispose(); }
    });

    it('retains exact mixed integer and real comparisons through fallback', () => {
        for (const [input, expected] of [[9007199254740993n, 9007199254740993n],
            [9007199254740995n, 9007199254740994]] as const) {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.variables.set('Input', ownedArray([input, input]));
                const saved = runtime.execute(`use sequences
Shifted' = Input + 0
Clipped' = Shifted min 9007199254740994.0
Saved = Clipped`);
                if (saved === undefined || !isRankArray(saved)) throw Error('expected array');
                expect(readArrayItem(saved, 0)).toBe(expected);
                expect(readArrayItem(saved, 1)).toBe(expected);
            } finally { runtime.dispose(); }
        }
    });

    it('preserves a heterogeneous result error at ordinary completion', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
Input = array 9007199254740993 9007199254740995
Shifted' = Input + 0
Clipped' = Shifted min 9007199254740994.0
Before = 1`);
            expect(() => runtime.execute('Saved = Clipped\nAfter = 2')).toThrow(/one element type/);
            expect(runtime.variables.has('Saved')).toBe(false);
            expect(runtime.variables.has('After')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('honors replaced native implementations', () => {
        const runtime = new Interpreter(undefined, { compilation });
        let calls = 0;
        try {
            const operation = runtime.execute('max');
            if (typeof operation !== 'object' || operation === null) throw Error('expected function');
            Object.defineProperty(operation, 'call', { value: () => { calls++; return 77n; } });
            expect(runtime.execute("use sequences\nInput = array 1 2 3\nShifted' = Input + 1\nClipped' = Shifted max 3\nClipped sum")).toBe(231n);
            expect(calls).toBe(3);
        } finally { runtime.dispose(); }
    });

    it('retains exact large integers', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute(`use sequences
Input = array 9007199254740993 9007199254740995
Shifted' = Input + 1
Clipped' = Shifted max 9007199254740995
Clipped sum`)).toBe(18014398509481991n);
        } finally { runtime.dispose(); }
    });

    it('does not evaluate an unused domain error and fails at completion', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("use sequences\nInput = array true false\nClipped' = Input max 2\nBefore = 7");
            expect(runtime.variables.get('Before')).toBe(7n);
            expect(() => runtime.execute('Saved = Clipped\nAfter = 9')).toThrow();
            expect(runtime.variables.has('Saved')).toBe(false);
            expect(runtime.variables.has('After')).toBe(false);
        } finally { runtime.dispose(); }
    });
});
