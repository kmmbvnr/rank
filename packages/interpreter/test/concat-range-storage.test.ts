import { describe, expect, it } from 'vitest';
import { Interpreter, isRankSequence, RuntimeDiagnostics, withDemandBudget, withInterrupt } from '../src/index.js';
import { integer32Cells, integer64Cells, ownedArray, readArrayItem } from '../src/array-storage.js';
import { concatValues, copyArray } from '../src/modules/sequences.js';

function range(runtime: Interpreter, source: string) {
    const value = runtime.execute(source);
    if (!value || !isRankSequence(value)) throw Error('expected range');
    return value;
}
describe('native concatenation of integer ranges', () => {
    it('fills packed storage for increasing, decreasing and empty parts', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const parts = [range(runtime, '0 to 100000 by 3'), range(runtime, '99 to 1 by -7'),
                range(runtime, '4 till 4'), ownedArray([-17n])];
            const result = diagnostics.run(() => copyArray(concatValues(parts)));
            const expected: bigint[] = [];
            for (let i = 0; i <= 100000; i += 3) expected.push(BigInt(i));
            for (let i = 99; i >= 1; i -= 7) expected.push(BigInt(i));
            expected.push(-17n);
            expect(integer32Cells(result)).toBeDefined();
            expect(result.items).toEqual(expected);
            expect(diagnostics.nativeSequenceCopies).toBe(1);
        } finally { runtime.dispose(); }
    });
    it('handles one cell with an arbitrarily large stride', () => {
        const runtime = new Interpreter();
        try {
            const head = range(runtime, '1 to 1 by (10 ** 1000)');
            const result = copyArray(concatValues([head, ownedArray([2n])]));
            expect(integer32Cells(result)).toBeDefined();
            expect(result.items).toEqual([1n, 2n]);
        } finally { runtime.dispose(); }
    });
    it('keeps signed int64 endpoints exact', () => {
        const runtime = new Interpreter();
        try {
            const head = range(runtime, '9223372036854775806 to 9223372036854775807');
            const tail = range(runtime, '-9223372036854775808 to -9223372036854775807');
            const result = copyArray(concatValues([head, tail]));
            expect(integer64Cells(result)).toBeDefined();
            expect(result.items).toEqual([9223372036854775806n, 9223372036854775807n, -9223372036854775808n, -9223372036854775807n]);
        } finally { runtime.dispose(); }
    });
    it('retains arbitrary precision and mixed numeric domains', () => {
        const runtime = new Interpreter();
        try {
            const head = range(runtime, '(2 ** 80) to (2 ** 80 + 2)');
            const result = copyArray(concatValues([head, ownedArray([1n])]));
            expect(result.items).toEqual([2n ** 80n, 2n ** 80n + 1n, 2n ** 80n + 2n, 1n]);
            expect(() => copyArray(concatValues([head, ownedArray([1.5])]))).toThrow('arrays require one element type');
        } finally { runtime.dispose(); }
    });
    it.each(['iterate', 'at', 'size'] as const)('does not probe a replaced %s accessor', field => {
        const runtime = new Interpreter();
        let reads = 0;
        try {
            const head = range(runtime, '1 to 3');
            const original = head.plan[field];
            Object.defineProperty(head.plan, field, { configurable: true, get() {
                reads++;
                return field === 'iterate' ? function* () { yield 99n; } : original;
            } });
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => copyArray(concatValues([head, ownedArray([4n])])));
            expect(result.items).toEqual(field === 'iterate' ? [99n, 4n] : [1n, 2n, 3n, 4n]);
            expect(reads).toBe(field === 'at' ? 0 : 1);
            expect(diagnostics.nativeSequenceCopies).toBe(0);
        } finally { runtime.dispose(); }
    });
    it('does not inspect a replacement size proxy', () => {
        const runtime = new Interpreter();
        try {
            const head = range(runtime, '1 to 3');
            const size = new Proxy(head.plan.size, {
                getOwnPropertyDescriptor() { throw Error('probed foreign metadata'); },
            });
            Object.defineProperty(head.plan, 'size', { value: size });
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => copyArray(concatValues([head, ownedArray([4n])])));
            expect(result.items).toEqual([1n, 2n, 3n, 4n]);
            expect(diagnostics.nativeSequenceCopies).toBe(0);
        } finally { runtime.dispose(); }
    });
    it.each(['budget', 'observer'])('preserves the ordinary %s path', mode => {
        const runtime = new Interpreter();
        try {
            const value = concatValues([range(runtime, '1 to 3'), ownedArray([4n])]);
            const diagnostics = new RuntimeDiagnostics();
            const signal = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
            const run = () => copyArray(value);
            const result = diagnostics.run(() => mode === 'budget' ? withDemandBudget(10000, run) : withInterrupt(signal, run));
            expect(Array.from({ length: 4 }, (_, i) => readArrayItem(result, i))).toEqual([1n, 2n, 3n, 4n]);
            expect(diagnostics.nativeSequenceCopies).toBe(0);
        } finally { runtime.dispose(); }
    });
});
