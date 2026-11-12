import { expect, it } from 'vitest';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, isNativeFunction, type InterpreterOptions } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

function run(source: string, compilation = true, options: InterpreterOptions = {}, mode = 'ordinary') {
    const runtime = new Interpreter(() => {}, { ...options, compilation }), diagnostics = new RuntimeDiagnostics();
    let value: string | undefined, error: string | undefined;
    try {
        const execute = () => diagnostics.run(() => runtime.execute(source));
        try {
            const result = mode === 'budget' ? withDemandBudget(1000000, execute)
                : mode === 'inspection' ? withInterrupt(new Int32Array(1), execute, () => {})
                : mode === 'interrupt' ? withInterrupt(new Int32Array(1), execute) : execute();
            value = result === undefined ? undefined : formatValue(result);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { observation: { value, error }, diagnostics };
    } finally { runtime.dispose(); }
}
const total = `use sequences
Data = 1 to 1024 copy
Scale = 2
fun Size total
 Sum = 0
 for I in 0 till Size
  Sum += Data I * Scale
 end
 return Sum
end
3 total`;
const recursion = `fun N fibonacci
 if N less 2
  return N
 end
 Left = (N - 1) fibonacci
 Right = (N - 2) fibonacci
 return Left + Right
end
`;
it('borrows a completed captured integer vector and reads a scalar capture', () => {
    const compiled = run(total);
    expect(compiled.observation).toEqual(run(total, false).observation);
    expect(compiled.observation.value).toBe('12');
    expect(compiled.diagnostics.numberFunctions).toBeGreaterThan(0);
    expect(compiled.diagnostics.numberFunctionFallbacks).toBe(0);
});
it('borrows full scalar matrix addresses', () => {
    const source = `Grid = array shape 32 32 fill 5
Grid 1 2 = 9
fun Row cell Column
 return Grid Row Column
end
1 cell 2`;
    const compiled = run(source);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.value).toBe('9');
    expect(compiled.diagnostics.numberFunctions).toBeGreaterThan(0);
});
it('retains the exact route for higher-rank captured addresses', () => {
    const source = `Cube = array shape 2 3 4 fill 7
fun Row cell Column Depth
 return Cube Row Column Depth
end
1 cell 2 3`;
    expect(run(source).observation).toEqual(run(source, false).observation);
    expect(run(source).observation.value).toBe('7');
});
it('runs a closed read-only recursive integer graph in Number', () => {
    const source = recursion + '20 fibonacci', compiled = run(source);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.value).toBe('6765');
    expect(compiled.diagnostics.numberFunctions).toBeGreaterThan(1000);
    expect(compiled.diagnostics.numberFunctionFallbacks).toBe(0);
});
it.each(['budget', 'inspection', 'interrupt'])('keeps %s execution observable and exact', mode => {
    const source = recursion + '8 fibonacci', compiled = run(source, true, {}, mode);
    expect(compiled.observation).toEqual(run(source, false, {}, mode).observation);
    if (mode !== 'interrupt') expect(compiled.diagnostics.numberFunctions).toBe(0);
});
it('revalidates captured storage and scalar values between calls, preserving COW aliases', () => {
    const source = total.replace('3 total', `Saved = Data
First = 3 total
Data 0 = 9
Scale = 3
Second = 3 total
array First Second (Saved 0)`);
    const compiled = run(source);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.value).toBe('12 42 1');
});
it('replays a wide captured cell and recovers after later writes', () => {
    const source = total.replace('Data = 1 to 1024 copy', 'Data = array 9007199254740993 2 3').replace('3 total', `First = 3 total
Data 0 = 1
Second = 3 total
Third = 3 total
array First Second Third`);
    const compiled = run(source);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
});
it('replays intermediate recursive overflow with exact integer arithmetic', () => {
    const source = `fun N factorial
 if N less 2
  return 1
 end
 Previous = (N - 1) factorial
 return N * Previous
end
20 factorial`;
    const compiled = run(source);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.value).toBe('2432902008176640000');
    expect(compiled.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
});
it.each(['1 // N', 'Data 9'])('replays recursive errors and ordinary source frames for %s', expression => {
    const source = `Data = array 1 2
fun N probe
 if N equal 0
  return ${expression}
 end
 Previous = (N - 1) probe
 return Previous + N
end
4 probe`;
    const compiled = run(source);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.error).toBeDefined();
});
it.each(['-1', '1024', '9007199254740993'])('retains ordinary captured-vector bounds errors at %s', index => {
    const source = `use sequences
Data = 1 to 1024 copy
fun I read
 return Data I
end
${index} read`;
    expect(run(source).observation).toEqual(run(source, false).observation);
    expect(run(source).observation.error).toBeDefined();
});
it('keeps the logical recursion limit and restores depth after failure', () => {
    const source = recursion + '30 fibonacci';
    const compiled = run(source, true, { maxCallDepth: 8 });
    expect(compiled.observation).toEqual(run(source, false, { maxCallDepth: 8 }).observation);
    expect(compiled.observation.error).toMatch(/call depth/);
    const runtime = new Interpreter(() => {}, { maxCallDepth: 8 });
    try {
        runtime.execute(recursion);
        const fn = runtime.variables.get('fibonacci');
        if (!fn || !isNativeFunction(fn)) throw Error('missing function');
        expect(() => fn.call([30n])).toThrow(/call depth/);
        expect(fn.call([5n])).toBe(5n);
    } finally { runtime.dispose(); }
});
it('keeps existing constant-depth tail recursion', () => {
    const source = `fun N descend
 if N less 1
  return 0
 end
 return (N - 1) descend
end
1000 descend`;
    expect(run(source, true, { maxCallDepth: 8 }).observation).toEqual(run(source, false, { maxCallDepth: 8 }).observation);
    expect(run(source, true, { maxCallDepth: 8 }).observation.value).toBe('0');
});
it('retains observer calls instead of bypassing them inside numeric recursion', () => {
    let calls = 0;
    const compiled = run(recursion + '8 fibonacci', true, { onScalarFunctionExecuted: () => calls++ });
    expect(compiled.observation.value).toBe('21');
    expect(calls).toBeGreaterThan(20);
    expect(compiled.diagnostics.numberFunctions).toBe(0);
});
it('declines shared captured buffers without changing their values', () => {
    const shared = new BigInt64Array(new SharedArrayBuffer(24));
    shared.set([1n, 2n, 3n]);
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Data', typedArray(shared));
            expect(runtime.execute(total.slice(total.indexOf('Scale =')))).toBe(12n);
        } finally { runtime.dispose(); }
    }
});
it('polls an atomic cancellation during numeric recursion and recovers', async () => {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const startSignal = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(`const { workerData } = require('node:worker_threads');
const signal = new Int32Array(workerData[0]);
const startSignal = new Int32Array(workerData[1]);
Atomics.wait(startSignal, 0, 0);
const start = performance.now();
while (performance.now() - start < 10) {}
Atomics.store(signal, 0, 1);`, { eval: true, workerData: [signal.buffer, startSignal.buffer] });
    const ready = once(worker, 'online');
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        // Start cancellable, matching the editor's cancellable-to-turbo lifecycle.
        withInterrupt(signal, () => runtime.execute(recursion));
        const fn = runtime.variables.get('fibonacci');
        if (!fn || !isNativeFunction(fn)) throw Error('missing function');
        expect(withInterrupt(signal, () => fn.call([8n]))).toBe(21n);
        await ready;
        Atomics.store(startSignal, 0, 1); Atomics.notify(startSignal, 0);
        expect(() => diagnostics.run(() => withInterrupt(signal, () => fn.call([38n])))).toThrow(/Interrupted/);
        expect(diagnostics.numberFunctions).toBeGreaterThan(0);
        Atomics.store(signal, 0, 0);
        expect(fn.call([8n])).toBe(21n);
    } finally { runtime.dispose(); await worker.terminate(); }
}, 10000);

it('keeps opaque captured readers on their ordinary path', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    let reads = 0;
    try {
        runtime.variables.set('Data', { kind: 'array', shape: [3], items: [], itemAt: index => { reads++; return BigInt(index + 1); } });
        expect(diagnostics.run(() => runtime.execute(total.slice(total.indexOf('Scale ='))))).toBe(12n);
        expect(reads).toBe(3);
        expect(diagnostics.numberFunctions).toBe(0);
    } finally { runtime.dispose(); }
});

it('replays unsafe cells from a native Int64 capture exactly', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.variables.set('Data', typedArray(BigInt64Array.from([9007199254740993n, 2n, 3n])));
        expect(diagnostics.run(() => runtime.execute(total.slice(total.indexOf('Scale ='))))).toBe(18014398509481996n);
        expect(diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});
it('replays unsafe captured scalars instead of rounding them', () => {
    const source = total.replace('Scale = 2', 'Scale = 9007199254740993');
    const compiled = run(source);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
});

it('backs off wide recursive arguments and resumes numeric calls after they shrink', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(`fun Depth tree Value
 if Depth equal 0
  return Value
 end
 Left = (Depth - 1) tree Value
 Right = (Depth - 1) tree Value
 return Left + Right
end`);
        expect(diagnostics.run(() => runtime.execute('10 tree 1152921504606846976')))
            .toBe(1024n * 1152921504606846976n);
        expect(diagnostics.numberFunctionSkips).toBeGreaterThan(1000);
        const attempts = diagnostics.numberFunctions;
        expect(diagnostics.run(() => runtime.execute('10 tree 1'))).toBe(1024n);
        expect(diagnostics.numberFunctions).toBeGreaterThan(attempts);
    } finally { runtime.dispose(); }
});

it('keeps tiny captured lookups exact for exact callers and numeric for numeric callers', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(`use sequences
Data = 1 to 8 array
fun Index lookup
 return Data Index
end
fun Count total Start
 Answer = Start
 for I in 1 to Count
  Answer += (I mod 8) lookup
 end
 return Answer
end`);
        const exact = new RuntimeDiagnostics();
        expect(exact.run(() => runtime.execute('1000 total 1152921504606846976')))
            .toBe(1152921504606846976n + 4500n);
        expect(exact.numberFunctions).toBe(0);
        const numeric = new RuntimeDiagnostics();
        for (let attempt = 0; attempt < 3; attempt++)
            expect(numeric.run(() => runtime.execute('1000 total 0'))).toBe(4500n);
        expect(numeric.numberFunctions).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});

it('keeps moderate direct numeric recursion compiled and bounds deeper calls', () => {
    const source = `fun N total
 if N equal 0
  return 1
 end
 Next = (N - 1) total
 return Next + 1
end
`;
    const moderate = run(source + '300 total');
    expect(moderate.observation).toEqual({ value: '301', error: undefined });
    expect(moderate.diagnostics.numberFunctions).toBeGreaterThan(300);
    expect(moderate.diagnostics.numberFunctionFallbacks).toBe(0);
    const deep = run(source + '2000 total');
    expect(deep.observation).toEqual({ value: '2001', error: undefined });
    expect(deep.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
});
