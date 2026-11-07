import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withInterrupt } from '../src/interrupt.js';
import { modularKeyed } from '../src/modular-fold.js';

it.each(['values', 'keys'])('declines shared %s buffers', field => {
    const runtime = new Interpreter();
    const shared = new Int32Array(new SharedArrayBuffer(12));
    shared.set(field === 'values' ? [3, 5, 7] : [0, 1, 0]);
    runtime.variables.set('Values', typedArray(field === 'values' ? shared : Int32Array.of(3, 5, 7)));
    runtime.variables.set('Keys', typedArray(field === 'keys' ? shared : Int32Array.of(0, 1, 0)));
    const diagnostics = new RuntimeDiagnostics();
    try {
        const result = diagnostics.run(() => runtime.execute('(Values reduce * by Keys) mod 17')) as RankArray;
        expect(result.items).toEqual([4n, 5n]);
        expect(diagnostics.integerKeyedFolds).toBe(0);
    } finally { runtime.dispose(); }
});
it.each(['shape', 'columnNames', 'itemAt'])('does not inspect a replaced %s accessor', field => {
    const values = typedArray(Int32Array.of(3, 5, 7));
    const keys = typedArray(Int32Array.of(0, 1, 0));
    let reads = 0;
    Object.defineProperty(values, field, { configurable: true, get() { reads++; throw Error('foreign header'); } });
    expect(modularKeyed('reduce', '*', values, keys, undefined, undefined, 17n)).toBeUndefined();
    expect(reads).toBe(0);
});
it('retains observable host polling', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    const signal = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
    runtime.variables.set('Values', typedArray(Int32Array.of(3, 5, 7)));
    runtime.variables.set('Keys', typedArray(Int32Array.of(0, 1, 0)));
    try {
        const result = diagnostics.run(() => withInterrupt(signal,
            () => runtime.execute('(Values reduce * by Keys) mod 17'))) as RankArray;
        expect(result.items).toEqual([4n, 5n]);
        expect(diagnostics.integerKeyedFolds).toBe(0);
    } finally { runtime.dispose(); }
});
it.each([['negative', [0, -1, 0], [3], ''], ['outside', [0, 3, 0], [3], ' size 2'],
    ['shape', [0, 1, 0], [1, 3], '']] as const)('preserves %s key errors', (_, indices, shape, suffix) => {
    const run = (tensorFusion: boolean) => {
        const runtime = new Interpreter(undefined, { tensorFusion });
        runtime.variables.set('Values', typedArray(Int32Array.of(3, 5, 7), [3]));
        runtime.variables.set('Keys', typedArray(Int32Array.from(indices), [...shape]));
        try { runtime.execute(`(Values reduce * by Keys${suffix}) mod 17`); return undefined; }
        catch (error) { return String(error); }
        finally { runtime.dispose(); }
    };
    expect(run(true)).toEqual(run(false));
    expect(run(true)).toBeDefined();
});
it.each(['reduce', 'scan'] as const)('keeps empty %s and wide negative seeds exact', kind => {
    const values = typedArray(new Int32Array(0)), keys = typedArray(new Int32Array(0));
    const seed = -(2n ** 120n), residue = (seed % 17n + 17n) % 17n;
    const result = modularKeyed(kind, '*', values, keys, seed, 6n, 17n)!;
    expect(result.items).toEqual(kind === 'scan' ? [] : Array(6).fill(residue));
});
it('retains exact wide values and moduli', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    runtime.variables.set('Values', typedArray(BigInt64Array.of(2n ** 62n, -(2n ** 62n), 7n)));
    runtime.variables.set('Keys', typedArray(Int32Array.of(0, 1, 0)));
    const mod = (n: bigint) => (n % 2147483647n + 2147483647n) % 2147483647n;
    try {
        const result = diagnostics.run(() => runtime.execute('(Values reduce * by Keys) mod 2147483647')) as RankArray;
        expect(result.items).toEqual([mod(2n ** 62n * 7n), mod(-(2n ** 62n))]);
        expect(diagnostics.integerKeyedFolds).toBe(0);
    } finally { runtime.dispose(); }
});
