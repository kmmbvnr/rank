import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';
import { typedArray, readArrayItem, derivedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
function run(operation: string, kind: string, keys: bigint[], compilation: boolean, seed = '') {
    const r = new Interpreter(() => {}, { compilation }), d = new RuntimeDiagnostics();
    try {
        r.variables.set('V', typedArray(Float64Array.from(keys, (_, i) => [1e16, -0, 1, 0, -1e16, NaN, Infinity, 4][i % 8])));
        const source = BigInt64Array.from([99n, ...keys, 99n]).subarray(1, keys.length + 1);
        r.variables.set('K', typedArray(source));
        const result = d.run(() => r.execute(`V ${kind} ${operation} by K${seed}`));
        if (!result || !isRankArray(result)) throw Error('expected array');
        return { values: Array.from({ length: result.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(result, i)), shape: result.shape, count: d.realKeyedFolds };
    } catch (error) { return { error: (error as Error).message, kind: (error as { errorKind?: string }).errorKind, count: d.realKeyedFolds }; }
    finally { r.dispose(); }
}
for (const operation of ['+', '*', 'min', 'max']) for (const kind of ['reduce', 'scan']) {
    it(`uses exact Int64 keys for real ${kind} ${operation}`, () => {
        const keys = [0n, 1n, 0n, 1n, 0n, 1n, 0n, 1n];
        const actual = run(operation, kind, keys, true), reference = run(operation, kind, keys, false);
        expect(actual.values).toEqual(reference.values); expect(actual.shape).toEqual(reference.shape);
        expect(actual.count).toBe(1); expect(reference.count).toBe(0);
    });
}
it.each([-1n, -(1n << 63n), 2147483648n, 4294967294n, 4294967295n, 4294967296n, 9007199254740993n, (1n << 63n) - 1n])('retains key validation before size validation at %s', key => {
    const actual = run('+', 'reduce', [0n, key], true, ' size 2'), reference = run('+', 'reduce', [0n, key], false, ' size 2');
    expect(actual.error).toBe(reference.error); expect(actual.kind).toBe(reference.kind); expect(actual.error).toBeTruthy();
});
it('retains exact mixed extrema seeds', () => {
    for (const operation of ['min', 'max']) {
        const actual = run(operation, 'reduce', [0n, 0n], true, ' with 9007199254740993');
        expect(actual).toEqual(run(operation, 'reduce', [0n, 0n], false, ' with 9007199254740993'));
        expect(actual.count).toBe(0);
    }
});
it('does not bypass opaque key reads or their errors', () => {
    const r = new Interpreter(() => {}), reads: number[] = [];
    try {
        r.variables.set('V', typedArray(new Float64Array([1, 2, 3])));
        r.variables.set('K', derivedArray([3], [], i => { reads.push(i); if (i === 2) throw Error('key reader'); return BigInt(i); }));
        expect(() => r.execute('V sum by K')).toThrow(/key reader/); expect(reads).toEqual([0, 1, 2]);
    } finally { r.dispose(); }
});
it('retains demand budgets and cancellation in wide-key real folds', () => {
    const r = new Interpreter(() => {}), signal = new Int32Array(new SharedArrayBuffer(4));
    try {
        r.variables.set('V', typedArray(new Float64Array(20000).fill(1)));
        r.variables.set('K', typedArray(new BigInt64Array(20000)));
        expect(() => withDemandBudget(4, () => r.execute('V sum by K'))).toThrow(/demand budget/);
        signal[0] = 1;
        expect(() => withInterrupt(signal, () => r.execute('V sum by K'))).toThrow(/interrupt|cancel/i);
    } finally { r.dispose(); }
});
