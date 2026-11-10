import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, parse, type RankValue, type RankArray } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const statement = 'Result = A * A equal B';
function run(text: string, a: RankArray, b: RankArray, compilation = true, mode = 'ordinary') {
    const r = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics(Infinity, true);
    r.variables.set('A', a); r.variables.set('B', b);
    try {
        let value: string | undefined, error: string | undefined;
        const execute = () => {
            try { const answer = diagnostics.run(() => r.execute(text)); value = answer === undefined ? undefined : formatValue(answer); }
            catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
        };
        if (mode === 'budget') withDemandBudget(1000000, execute);
        else if (mode === 'inspection') withInterrupt(new Int32Array(1), execute, () => {});
        else if (mode === 'interrupt') withInterrupt(new Int32Array(new SharedArrayBuffer(4)), execute);
        else execute();
        return { value, error, compiled: diagnostics.compilerObservations.some(entry => entry.backend === 'tensor' && entry.phase === 'execute' && entry.execution?.kinds.includes('compiled')) };
    } finally { r.dispose(); }
}
const result = ({ value, error }: ReturnType<typeof run>) => ({ value, error });
function inputs(n: number) {
    return [typedArray(Int32Array.from({ length: n }, (_, i) => i - 2048)),
        typedArray(BigInt64Array.from({ length: n }, (_, i) => BigInt((i - 2048) ** 2 + (i % 3 === 0 ? 1 : 0))))] as const;
}
it.each(['equal', 'not equal', 'less', 'at most', 'greater', 'at least'])('compiles a compound integer comparison using %s', comparison => {
    const [a, b] = inputs(4097), text = `Result = A * A ${comparison} B\nResult`;
    const actual = run(text, a, b);
    expect(result(actual)).toEqual(result(run(text, a, b, false)));
    expect(actual.error).toBeUndefined();
    expect(actual.compiled).toBe(true);
});
it.each([0, 1, 31, 32, 33, 63, 64, 65, 4095, 4096, 4097])('preserves bitmap tail and empty demand at size %s', n => {
    const [a, b] = inputs(n), text = 'use sequences\nResult = (A * A equal B) copy\nResult';
    expect(result(run(text, a, b))).toEqual(result(run(text, a, b, false)));
});
it('keeps unary not in a compound comparison', () => {
    const [a, b] = inputs(4096), text = 'Result = not (A * A equal B)\nResult';
    const actual = run(text, a, b);
    expect(result(actual)).toEqual(result(run(text, a, b, false)));
    expect(actual.compiled).toBe(true);
});
it.each(['budget', 'inspection', 'interrupt'])('rechecks cached execution policy for %s demand', mode => {
    const [a, b] = inputs(4096), text = `${statement}\nResult`;
    const actual = run(text, a, b, true, mode);
    expect(result(actual)).toEqual(result(run(text, a, b, false, mode)));
});
it('keeps wide operands and intermediate squares exact', () => {
    const cells = [1n, 94906265n, 94906266n, 9007199254740993n, -2147483648n];
    const a = typedArray(BigInt64Array.from(cells)), b = typedArray(BigInt64Array.from(cells.map(n => n * n > (1n << 63n) - 1n ? 0n : n * n)));
    const text = 'use sequences\nResult = (A * A equal B) copy\nResult', actual = run(text, a, b);
    expect(result(actual)).toEqual(result(run(text, a, b, false)));
    expect(actual.value).toBe('true true true false true');
});
it('retains exact near-square comparisons above Number precision', () => {
    const values = [9007199254740991n, 9007199254740992n, 9007199254740993n];
    const a = typedArray(BigInt64Array.from(values)), b = typedArray(BigInt64Array.from(values.map(n => n - 1n)));
    expect(result(run('Result = A - B equal 1\nResult', a, b))).toEqual(result(run('Result = A - B equal 1\nResult', a, b, false)));
});
it.each([Int32Array, BigInt64Array])('preserves shared %s integer storage', Type => {
    const buffer = new SharedArrayBuffer(4096 * Type.BYTES_PER_ELEMENT);
    const cells = Type === Int32Array ? new Int32Array(buffer) : new BigInt64Array(buffer);
    if (cells instanceof Int32Array) cells.fill(3); else cells.fill(3n);
    const a = typedArray(cells), b = typedArray(new Int32Array(4096).fill(9));
    const actual = run(`${statement}\nResult`, a, b);
    expect(result(actual)).toEqual(result(run(`${statement}\nResult`, a, b, false)));
});
it('preserves views, negative elements and changed backing types', () => {
    const [a, b] = inputs(4096);
    for (const text of ['use sequences\nResult = (A reverse) * (A reverse) equal (B reverse)\nResult',
        'use sequences\nRows = 0 till 4096 by 2\nResult = (A Rows) * (A Rows) equal B Rows\nResult',
        'A 0 = -2147483648\nResult = A * A equal B\nResult']) {
        expect(result(run(text, a, b))).toEqual(result(run(text, a, b, false)));
    }
});
it('keeps short-circuit operands, deferred errors and late division errors ordinary', () => {
    const a = typedArray(Int32Array.from([1, 2, 3])), b = typedArray(Int32Array.from([1, 1, 0]));
    for (const text of ['use sequences\nResult = (A // B less 4) copy\nResult',
        "Unused' = A // B less 4\n7", 'false and (A // B less 4)', 'true or (A // B less 4)']) {
        expect(result(run(text, a, b))).toEqual(result(run(text, a, b, false)));
    }
});
it('retains real ordering and NaN fallback', () => {
    const a = typedArray(Float64Array.from([1.5, -0, NaN, Infinity])), b = typedArray(Float64Array.from([2.25, 0, NaN, Infinity]));
    expect(result(run(`${statement}\nResult`, a, b))).toEqual(result(run(`${statement}\nResult`, a, b, false)));
});
it('rebinds one cached comparison kernel without retaining input buffers', () => {
    const [a, b] = inputs(4096), values = new Map<string, RankValue>([['A', a], ['B', b]]);
    const kernel = compileTensorKernel(parse('Result = (A * A equal B) copy').statements[0], {
        lookup: name => values.get(name), builtin: () => true,
    })!;
    expect(kernel).toBeDefined(); expect(kernel.run()).toBeDefined();
    const wide = typedArray(new BigInt64Array(4096).fill(9007199254740993n)); values.set('A', wide);
    const changed = kernel.run() as RankArray;
    expect(readArrayItem(changed, 0)).toBe(false);
    values.set('A', a);
    expect(formatValue(kernel.run()!)).toBe(formatValue(runValue(a, b)));
    function runValue(a: RankArray, b: RankArray) { return compileTensorKernel(parse('Result = (A * A equal B) copy').statements[0], { lookup: name => name === 'A' ? a : b, builtin: () => true })!.run()!; }
});
it('cancels a compound boolean copy and recovers the cached kernel', async () => {
    const signal = new Int32Array(new SharedArrayBuffer(4)), start = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(`const {workerData}=require('node:worker_threads');
const start=new Int32Array(workerData[0]), signal=new Int32Array(workerData[1]);
Atomics.wait(start,0,0); const began=performance.now(); while(performance.now()-began<10){}
Atomics.store(signal,0,1);`, { eval: true, workerData: [start.buffer, signal.buffer] });
    const ready = once(worker, 'online');
    const values = new Map<string, RankValue>();
    const kernel = compileTensorKernel(parse('Result = (A * A equal B) copy').statements[0], { lookup: name => values.get(name), builtin: () => true })!;
    const tiny = typedArray(new Int32Array(4096).fill(3)), squares = typedArray(new Int32Array(4096).fill(9));
    try {
        values.set('A', tiny); values.set('B', squares); expect(kernel.run()).toBeDefined();
        await ready;
        values.set('A', typedArray(new Int32Array(8000000).fill(3))); values.set('B', typedArray(new Int32Array(8000000).fill(9)));
        Atomics.store(start, 0, 1); Atomics.notify(start, 0);
        expect(() => withInterrupt(signal, () => kernel.run())).toThrow(/Interrupted/);
        Atomics.store(signal, 0, 0); values.set('A', tiny); values.set('B', squares);
        expect(readArrayItem(kernel.run() as RankArray, 4095)).toBe(true);
    } finally { await worker.terminate(); }
}, 10000);

it('compares stored integer matrices with broadcast shapes', () => {
    const a = typedArray(Int32Array.from({ length: 256 }, (_, i) => i - 100), [256, 1]);
    const b = typedArray(BigInt64Array.from({ length: 17 }, (_, i) => BigInt(i * 9)), [1, 17]);
    const actual = run(`${statement}\nResult`, a, b);
    expect(result(actual)).toEqual(result(run(`${statement}\nResult`, a, b, false)));
    expect(actual.compiled).toBe(true);
});
it('does not add opaque-reader demands while attempting a compound comparison', () => {
    const counts: number[] = [];
    for (const compilation of [false, true]) {
        let reads = 0;
        const a: RankArray = { kind: 'array', shape: [8], items: [], itemAt: index => { reads++; return BigInt(index + 1); } };
        const b = typedArray(BigInt64Array.from([1n, 4n, 9n, 16n, 25n, 36n, 49n, 64n]));
        expect(run(`${statement}\nResult`, a, b, compilation).error).toBeUndefined();
        counts.push(reads);
    }
    expect(counts[1]).toBe(counts[0]);
});
it('warms specialized broadcast comparisons without binding their input buffers', () => {
    const a = typedArray(Int32Array.from({ length: 256 }, (_, i) => i - 100), [256, 1]);
    const b = typedArray(BigInt64Array.from({ length: 17 }, (_, i) => BigInt(i * 9)), [1, 17]);
    const values = new Map<string, RankValue>([['A', a], ['B', b]]);
    const kernel = compileTensorKernel(parse('Result = (A * A equal B) copy').statements[0], { lookup: name => values.get(name), builtin: () => true })!;
    for (let attempt = 0; attempt < 12; attempt++) {
        const mask = kernel.run() as RankArray;
        expect(readArrayItem(mask, 100 * 17)).toBe(true);
        expect(readArrayItem(mask, 0)).toBe(false);
    }
    values.set('A', typedArray(new Int32Array(256).fill(3), [256, 1]));
    const rebound = kernel.run() as RankArray;
    expect(readArrayItem(rebound, 1)).toBe(true);
    expect(readArrayItem(rebound, 100 * 17)).toBe(false);
});
