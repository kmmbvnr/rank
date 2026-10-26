import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type RankArray } from '../src/index.js';
import { arrayRange, registerArrayRange } from '../src/range-plan.js';
import { prepareIntegerRange } from '../src/integer-view.js';
import { readArrayItem, typedArray, writeArrayCell, writeIntegerSelection } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt, InterruptedError } from '../src/interrupt.js';

describe.each([false, true])('affine integer updates (compilation=%s)', compilation => {
    it('keeps repeated zero-stride addresses as snapshot writes', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute(`use sequences
A = array shape 128 fill 10
K = 0 till 64 array
At' = 0 * K + 3
A At += K
Answer = A 3`);
            expect(r.variables.get('Answer')).toBe(73n);
            expect(r.execute('A sum')).toBe(1343n);
        } finally { r.dispose(); }
    });

    it('checks affine bounds before RHS effects and leaves the target unchanged', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('use sequences\nA = array shape 128 fill 1\nK = 0 till 64 array\nAt\' = K * 3');
            expect(() => r.execute('A At += 1 // 0')).toThrow(/axis 0: 129/);
            expect(r.execute('A sum')).toBe(128n);
            r.execute("Negative' = 63 - K * 2");
            expect(() => r.execute('A Negative += 1')).toThrow(/nonnegative/);
        } finally { r.dispose(); }
    });

    it('gathers the RHS before descending writes and preserves aliases', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute(`use sequences
A = 0 till 128 array
Alias = A
K = 0 till 128 array
At' = 127 - K
A At += A + 1`);
            expect(r.execute('Alias sum')).toBe(8128n);
            expect(r.execute('A min')).toBe(128n);
            expect(r.execute('A max')).toBe(128n);
        } finally { r.dispose(); }
    });

    it('consumes affine selectors without computing their individual cells', () => {
        const r = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = array shape 10000 fill 1\nK = 2 to 100 array');
            diagnostics.run(() => r.execute("At' = 2 * K\nA At += K + 2"));
            expect(r.execute('A sum')).toBe(15247n);
            expect(diagnostics.cellsComputed).toBe(0);
        } finally { r.dispose(); }
    });
});

describe('compact update boundaries', () => {
    it.each(['+=', '-=', '*='] as const)('widens partway through %s without replaying the prefix', operator => {
        const initial = [3, 2147483647, -2147483648, 7];
        const operands = new Int32Array([2, 2, 2, 2]);
        const target = typedArray(Int32Array.from(initial));
        const combine = operator === '+=' ? (x: bigint, y: bigint) => x + y
            : operator === '-=' ? (x: bigint, y: bigint) => x - y : (x: bigint, y: bigint) => x * y;
        writeIntegerSelection(target, 4, i => i, operands, operator, { offset: 0, stride: 1 });
        expect(initial.map((_, i) => readArrayItem(target, i)))
            .toEqual(initial.map(x => combine(BigInt(x), 2n)));
    });

    it('invalidates a mapped progression when its native source or reader changes', () => {
        const r = new Interpreter();
        try {
            r.execute("use sequences\nK = 0 till 128 array\nAt' = K * 2");
            const k = r.variables.get('K') as RankArray;
            const at = r.execute('At') as RankArray;
            expect(prepareIntegerRange(at)).toMatchObject({ start: 0n, step: 2n, count: 128n });
            writeArrayCell(k, 1, 50n);
            expect(prepareIntegerRange(at)).toBeUndefined();
            expect(readArrayItem(at, 1)).toBe(100n);
            const source = registerArrayRange(typedArray(new Int32Array([0, 1, 2])), { start: 0n, step: 1n, count: 3n });
            Object.defineProperty(source, 'itemAt', { value: () => 99n });
            expect(arrayRange(source)).toBeUndefined();
        } finally { r.dispose(); }
    });

    it('does not narrow large cancelling integer operands through Number', () => {
        const r = new Interpreter();
        try {
            r.execute('A = array 9007199254740993 9007199254740994\nB = array 9007199254740992 9007199254740993');
            expect(formatValue(r.execute('A - B')!)).toBe('1 1');
        } finally { r.dispose(); }
    });

    it('retains cancellation and demand accounting for native ranges and writes', () => {
        const r = new Interpreter();
        try {
            r.execute('use sequences');
            expect(() => withDemandBudget(0, () => r.execute('A = 0 till 10000 array'))).toThrow();
            const signal = new Int32Array(new SharedArrayBuffer(4));
            signal[0] = 1;
            const target = typedArray(new Int32Array(10000));
            expect(() => withInterrupt(signal, () => writeIntegerSelection(target, 10000, i => i, 1n, '+=')))
                .toThrow(InterruptedError);
            expect(readArrayItem(target, 0)).toBe(0n);
        } finally { r.dispose(); }
    });
});
