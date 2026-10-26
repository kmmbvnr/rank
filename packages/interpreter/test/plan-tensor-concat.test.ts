import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, demand } from '../src/index.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { runExecution } from '../src/execution.js';
import { materializeTensorMap } from '../src/tensor-map.js';
import type { RankArray } from '../src/value.js';

// These are actual native plans, rather than inline source expressions. Each
// demand must retain concat's routing, completion and first-error order.
describe.each([false, true])('native concat plans (compilation=%s)', compilation => {
    it.each([0, 1, 2, -1])('fuses deferred branches along axis %i', axis => {
        let entries = 0;
        const r = new Interpreter(undefined, { compilation, onTensorKernelExecuted: () => entries++ });
        try {
            r.variables.set('Input', ownedArray(Array.from({ length: 8 }, (_, i) => BigInt(i)), [2, 2, 2]));
            r.execute(`use sequences
Left' = Input + 1
Right' = Input * 2
Joined' = concat Left Right axis ${axis}`);
            expect(entries).toBe(0);
            const d = new RuntimeDiagnostics();
            const value = d.run(() => r.execute('Saved = Joined'));
            if (!isRankArray(value!)) throw Error('expected array');
            const dimension = axis < 0 ? 2 : axis;
            const shape = [2, 2, 2]; shape[dimension] = 4;
            expect(value.shape).toEqual(shape);
            const expected = [];
            for (let x = 0; x < shape[0]; x++) for (let y = 0; y < shape[1]; y++) for (let z = 0; z < shape[2]; z++) {
                const at = [x, y, z], right = at[dimension] >= 2;
                at[dimension] %= 2;
                const n = BigInt(at[0] * 4 + at[1] * 2 + at[2]);
                expected.push(right ? n * 2n : n + 1n);
            }
            expect(expected.map((_, i) => readArrayItem(value, i))).toEqual(expected);
            expect(entries).toBe(compilation ? 1 : 0);
            if (compilation) expect(d.cellsComputed).toBe(0);
        } finally { r.dispose(); }
    });

    it.each(['Joined', 'Joined copy'])('completes %s once and retains snapshots', expression => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute(`use sequences
Input = array 1 2
Left' = Input + 1
Joined' = concat Input Left
Saved = ${expression}
Old = Saved
Saved 0 = 99`);
            expect(r.execute('Old sum')).toBe(8n);
            expect(r.execute('Saved sum')).toBe(106n);
            expect(r.execute('Joined sum')).toBe(8n);
            expect(r.execute('Joined sum')).toBe(8n);
        } finally { r.dispose(); }
    });

    it('does not evaluate later segments before a short-circuit consumer', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute(`use sequences
Input = array 1 2
Zero = array 0 0
Good' = Input greater 0
Bad' = (Input mod Zero) equal 0
Joined' = concat Good Bad`);
            expect(r.execute('Joined any')).toBe(true);
            expect(() => r.execute('Saved = Joined copy')).toThrow('division by zero');
            expect(r.variables.has('Saved')).toBe(false);
        } finally { r.dispose(); }
    });

    it('keeps host reads in concat order and leaves unused plans unread', () => {
        const reads: number[] = [];
        const host: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt: i => { reads.push(i); return BigInt(i + 1); } };
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', host);
            r.execute("use sequences\nLeft' = Input + 1\nJoined' = concat Left Input");
            expect(reads).toEqual([]);
            expect(r.execute('Saved = Joined copy\nSaved sum')).toBe(8n);
            expect(reads).toEqual([0, 1, 0, 1]);
            expect(r.execute('Joined sum')).toBe(8n);
            expect(reads).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
        } finally { r.dispose(); }
    });

    it('keeps homogeneous-cell checks even when a following map promotes both segments', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute("use sequences\nInput = array 1 2\nOther = array 3.0 4.0\nLeft' = Input + 0\nJoined' = concat Left Other");
            expect(() => r.execute('Saved = (Joined + 0.5) copy')).toThrow();
        } finally { r.dispose(); }
    });

    it('handles empty branches and empty outputs', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            expect(r.execute(`use sequences
Input = array 1 2
Empty = array shape 0 fill 0
Left' = Input + 1
Joined' = concat Empty Left Empty
Saved = Joined copy
Saved sum`)).toBe(5n);
            expect(r.execute("EmptyMap' = Empty + 1\nSaved = (concat EmptyMap Empty) copy\nSaved len")).toBe(0n);
        } finally { r.dispose(); }
    });

    it('retains arbitrary-precision integers when compact output overflows', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', ownedArray([1n << 100n, -7n]));
            expect(r.execute("use sequences\nLeft' = Input * 3\nJoined' = concat Input Left\nSaved = Joined copy\nSaved sum"))
                .toBe((4n << 100n) - 28n);
        } finally { r.dispose(); }
    });

    it('declines a replaced native reader', () => {
        let entries = 0;
        const r = new Interpreter(undefined, { compilation, onTensorKernelExecuted: () => entries++ });
        try {
            r.execute("use sequences\nInput = array 1 2\nLeft' = Input + 1\nJoined' = concat Input Left");
            const value = runExecution(demand(r.variables.get('Joined')!));
            if (!isRankArray(value!)) throw Error('expected array');
            const reads: number[] = [];
            Object.defineProperty(value, 'itemAt', { value: (i: number) => { reads.push(i); return 10n; } });
            expect(materializeTensorMap(value)).toBeUndefined();
            expect(reads).toEqual([]);
            expect(entries).toBe(0);
        } finally { r.dispose(); }
    });

    it('retains ordinary completion errors when dynamic code generation is unavailable', () => {
        const mock = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw Error('CSP'); });
        const r = new Interpreter(undefined, { compilation });
        try {
            expect(r.execute("use sequences\nInput = array 1 2\nLeft' = Input + 1\nJoined' = concat Left Input\nSaved = Joined copy\nSaved sum")).toBe(8n);
        } finally { r.dispose(); mock.mockRestore(); }
    });
});
