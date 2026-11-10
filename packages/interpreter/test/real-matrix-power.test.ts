import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { RuntimeDiagnostics, type RankArray, type RankValue } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { prepareMatrixPower } from '../src/modules/linalg.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const cells = (value: RankArray) => Array.from({ length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));
function execute(data: number[], size: number, power: bigint, slow = false) {
    const diagnostics = new RuntimeDiagnostics(), source = typedArray(Float64Array.from(data), [size, size]);
    const call = () => diagnostics.run(() => {
        try { return { values: cells(prepareMatrixPower(source, power).run()) }; }
        catch (error) { return { error: (error as Error).message }; }
    });
    return { result: slow ? withDemandBudget(1000000, call) : call(), diagnostics };
}
it.each([0n, 1n, 2n, 3n, 4n, 8n, 13n])('keeps small real Fibonacci powers exact: %s', power => {
    const actual = execute([1, 1, 1, 0], 2, power);
    expect(actual.result).toEqual(execute([1, 1, 1, 0], 2, power, true).result);
    if (power >= 2n) expect(actual.diagnostics.costs['matpow.real-work']?.calls).toBe(1);
});
it.each([-1n, -2n, -5n])('retains the inverse path for power %s', power => {
    const actual = execute([2, 0, 0, 4], 2, power);
    expect(actual.result).toEqual({ values: [2 ** Number(power), 0, 0, 4 ** Number(power)] });
    expect(actual.result).toEqual(execute([2, 0, 0, 4], 2, power, true).result);
});
it.each([[0, -0, 1, -1], [NaN, 1, 0, 2], [Infinity, 0, 1, 2], [-Infinity, 0, Infinity, -0],
    [1e308, 0, 0, 1e308], [Number.MIN_VALUE, -0, -0, Number.MIN_VALUE]].map(data => [data]))('matches ordered arithmetic and errors for %s', data => {
    expect(execute(data, 2, 3n).result).toEqual(execute(data, 2, 3n, true).result);
});
it.each([0, 1, 2, 3, 4, 7])('retains output cells for size %s', size => {
    const data = Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? 0.5 : 0);
    expect(execute(data, size, 6n).result).toEqual(execute(data, size, 6n, true).result);
});
it('snapshots inputs and keeps work buffers private across prepared runs', () => {
    const data = Float64Array.from([1, 1, 1, 0]), source = typedArray(data, [2, 2]), prepared = prepareMatrixPower(source, 5n);
    data[0] = 99;
    const first = prepared.run(), second = prepared.run();
    expect(cells(first)).toEqual([8, 5, 5, 3]);
    (first.items as RankValue[])[0] = 1000;
    expect(cells(second)).toEqual([8, 5, 5, 3]);
    expect(cells(prepared.run())).toEqual([8, 5, 5, 3]);
    expect(data[0]).toBe(99);
});
it('retains prepared power-one identity without untracked aliases', () => {
    const source = typedArray(Float64Array.from([2, 0, 0, 3]), [2, 2]), prepared = prepareMatrixPower(source, 1n), first = prepared.run();
    expect(first === prepared.run()).toBe(true);
    (first.items as RankValue[])[0] = 7;
    expect(cells(source)).toEqual([2, 0, 0, 3]);
});
it('rechecks budgets and observable polling after ordinary preparation', () => {
    const source = typedArray(Float64Array.from([1, 1, 1, 0]), [2, 2]), prepared = prepareMatrixPower(source, 8n), expected = cells(prepared.run());
    for (const policy of [(run: () => RankArray) => withDemandBudget(1000000, run),
        (run: () => RankArray) => withInterrupt(new Int32Array(1), run, () => {})]) {
        const stats = new RuntimeDiagnostics();
        expect(cells(policy(() => stats.run(() => prepared.run())))).toEqual(expected);
        expect(stats.costs['matpow.real-work']?.calls ?? 0).toBe(0);
    }
});
it('uses at most three product buffers and one transpose', () => {
    const stats = new RuntimeDiagnostics(), source = typedArray(new Float64Array(64).fill(0.125), [8, 8]);
    stats.run(() => prepareMatrixPower(source, 365n).run());
    expect(stats.costs['matpow.real-work'].allocatedBytes).toBeLessThanOrEqual(4 * 64 * 8);
    expect(stats.costs['matpow.real-snapshot'].copiedBytes).toBe(64 * 8);
});
it('cancels real squaring and recovers the prepared input', async () => {
    const signal = new Int32Array(new SharedArrayBuffer(4)), start = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(`const {workerData}=require('node:worker_threads');
const start=new Int32Array(workerData[0]), signal=new Int32Array(workerData[1]);
Atomics.wait(start,0,0); const began=performance.now(); while(performance.now()-began<10){}
Atomics.store(signal,0,1);`, { eval: true, workerData: [start.buffer, signal.buffer] });
    const ready = once(worker, 'online'), size = 128, source = typedArray(new Float64Array(size * size).fill(1 / size), [size, size]);
    const prepared = prepareMatrixPower(source, 1n << 60n);
    try {
        await ready; Atomics.store(start, 0, 1); Atomics.notify(start, 0);
        expect(() => withInterrupt(signal, () => prepared.run())).toThrow(/Interrupted/);
        Atomics.store(signal, 0, 0);
        const result = prepared.run();
        expect(readArrayItem(result, 0)).toBe(1 / size);
        expect(readArrayItem(result, size * size - 1)).toBe(1 / size);
        expect(readArrayItem(source, 0)).toBe(1 / size);
    } finally { await worker.terminate(); }
}, 20000);

it.each([0n, 1n, 3n])('keeps malformed physical storage on its ordinary validation path: %s', power => {
    expect(execute([], 2, power).result).toEqual(execute([], 2, power, true).result);
});

it('retains a replaced reader on otherwise native real storage', () => {
    const source = typedArray(Float64Array.from([1, 1, 1, 0]), [2, 2]);
    const alternate = [2, 0, 0, 3]; let reads = 0;
    (source as { itemAt?: (index: number) => RankValue }).itemAt = index => { reads++; return alternate[index]; };
    const result = prepareMatrixPower(source, 2n).run();
    expect(cells(result)).toEqual([4, 0, 0, 9]);
    expect(reads).toBe(4);
});
