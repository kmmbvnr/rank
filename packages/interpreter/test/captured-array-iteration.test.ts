import { expect, it } from 'vitest';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, isNativeFunction } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const definition = `fun Size walk
 Total = 0
 for Value Index in Data
  if Index at least Size
   break
  end
  Total += Value
 end
 return Total
end`;
function run(text: string, compilation: boolean, mode = 'ordinary') {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        const execute = () => runtime.execute(text);
        try {
            const value = mode === 'budget' ? withDemandBudget(100000, execute)
                : mode === 'inspection' ? withInterrupt(new Int32Array(1), execute, () => {})
                : mode === 'interrupt' ? withInterrupt(new Int32Array(1), execute)
                : mode === 'custom' ? withInterrupt({ length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} }, execute) : execute();
            return { value: value === undefined ? undefined : formatValue(value), calls };
        } catch (error) { return { error: error instanceof RankError ? error.format() : String(error), calls }; }
    } finally { runtime.dispose(); }
}
const source = `use sequences\nData = 1 to 1024 copy\n${definition}\n3 walk`;
it('compiles a captured integer vector with exact iteration ordinals', () => {
    const compiled = run(source, true);
    expect({ ...compiled, calls: 0 }).toEqual(run(source, false));
    expect(compiled.value).toBe('6');
    expect(compiled.calls).toBeGreaterThan(0);
});
it.each([0, 1, 1024, 1025])('retains empty, prefix and exhausted iteration at limit %s', n => {
    const text = source.replace('3 walk', `${n} walk`);
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
});
it('refreshes rebound storage between calls and retains COW aliases', () => {
    const text = source.replace('3 walk', `Saved = Data
First = 3 walk
Data = Data + 1
Second = 3 walk
array First Second (Saved 0)`);
    const compiled = run(text, true);
    expect({ ...compiled, calls: 0 }).toEqual(run(text, false));
    expect(compiled.value).toBe('6 9 1');
});
it('retains the existing alias-sensitive fallback for writes through an argument', () => {
    const text = `use sequences
Data = 1 to 8 copy
fun Buffer modify
 Total = 0
 for Value Index in Data
  Buffer Index += 10
  Total += Value
 end
 return Total
end
Saved = Data
Total = Data modify
array Total (Data sum) (Saved sum)`;
    const compiled = run(text, true);
    expect({ ...compiled, calls: 0 }).toEqual(run(text, false));
});
it('retains arbitrary-precision captured cells', () => {
    const text = `Data = array 9007199254740993 2 3\n${definition}\n3 walk`;
    const compiled = run(text, true);
    expect({ ...compiled, calls: 0 }).toEqual(run(text, false));
    expect(compiled.value).toBe('9007199254740998');
    expect(compiled.calls).toBeGreaterThan(0);
});
it('declines real captured vectors without changing their arithmetic', () => {
    const text = `Data = array 1.5 2.5 3.5\n${definition}\n3 walk`;
    expect(run(text, true)).toEqual(run(text, false));
});
it.each(['budget', 'inspection', 'interrupt', 'custom'])('preserves %s execution', mode => {
    const compiled = run(source, true, mode);
    expect({ ...compiled, calls: 0 }).toEqual(run(source, false, mode));
    if (mode !== 'interrupt') expect(compiled.calls).toBe(0);
    else expect(compiled.calls).toBeGreaterThan(0);
});
it('keeps opaque readers on their ordinary iterator with one read per cell', () => {
    for (const compilation of [false, true]) {
        let reads = 0;
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Data', { kind: 'array', shape: [3], items: [], itemAt: i => { reads++; return BigInt(i + 1); } });
            expect(runtime.execute(`${definition}\n3 walk`)).toBe(6n);
            expect(reads).toBe(3);
        } finally { runtime.dispose(); }
    }
});
it('reads shared integer storage without a speculative numeric borrow', () => {
    for (const compilation of [false, true]) {
        const cells = BigInt64Array.from([1n, 2n, 3n]);
        const shared = new BigInt64Array(new SharedArrayBuffer(cells.byteLength)); shared.set(cells);
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Data', typedArray(shared));
            expect(runtime.execute(`${definition}\n3 walk`)).toBe(6n);
        } finally { runtime.dispose(); }
    }
});

it.each([false, true])('cancels a captured-array loop and restores its call state with Number=%s', async number => {
    const signal = new Int32Array(new SharedArrayBuffer(4)), start = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(`const {workerData} = require('node:worker_threads');
const signal = new Int32Array(workerData[0]), start = new Int32Array(workerData[1]);
Atomics.wait(start,0,0);
const began = performance.now(); while (performance.now()-began < 10) {}
Atomics.store(signal,0,1);`, {eval:true,workerData:[signal.buffer,start.buffer]});
    const ready = once(worker, 'online');
    let calls = 0;
    const runtime = new Interpreter(() => {}, number ? {} : { onScalarFunctionExecuted: () => calls++ });
    const diagnostics = new RuntimeDiagnostics();
    const loop = definition.replace(' Total += Value', ' Total = Total * 33 + Value\n Total = Total mod 1000000007');
    try {
        withInterrupt(signal, () => runtime.execute(`use sequences\nData = 1 to 2000000 copy\n${loop}`));
        const fn = runtime.variables.get('walk');
        if (!fn || !isNativeFunction(fn)) throw Error('missing walk');
        expect(withInterrupt(signal, () => fn.call([3n]))).toBe(1158n);
        await ready;
        Atomics.store(start, 0, 1); Atomics.notify(start, 0);
        expect(() => diagnostics.run(() => withInterrupt(signal, () => fn.call([2000000n])))).toThrow(/Interrupted/);
        if (number) expect(diagnostics.numberFunctions).toBeGreaterThan(0);
        else expect(calls).toBeGreaterThan(1);
        Atomics.store(signal, 0, 0);
        expect(fn.call([3n])).toBe(1158n);
    } finally { runtime.dispose(); await worker.terminate(); }
}, 10000);

it('uses checked Number iteration for a completed private captured vector', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        expect(diagnostics.run(() => runtime.execute(source))).toBe(6n);
        expect(diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(diagnostics.numberFunctionFallbacks).toBe(0);
    } finally { runtime.dispose(); }
});
it('replays unsafe Int64 iterator cells exactly and recovers on a rebound vector', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(`Data = array 1 2 3\n${definition}`);
        const fn = runtime.variables.get('walk');
        if (!fn || !isNativeFunction(fn)) throw Error('missing walk');
        runtime.variables.set('Data', typedArray(BigInt64Array.from([1n, 2n, 9007199254740993n])));
        expect(diagnostics.run(() => fn.call([3n]))).toBe(9007199254740996n);
        expect(diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
        runtime.variables.set('Data', typedArray(Int32Array.from([4, 5, 6])));
        expect(fn.call([3n])).toBe(15n);
    } finally { runtime.dispose(); }
});

it.each(['Total greater 0', 'Total + 0.5'])('keeps checked numeric iteration with scalar result %s', result => {
    const text = source.replace('return Total', `return ${result}`);
    const ordinary = run(text, false), runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(text));
        expect(value === undefined ? undefined : formatValue(value)).toBe(ordinary.value);
        expect(diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(diagnostics.numberFunctionFallbacks).toBe(0);
    } finally { runtime.dispose(); }
});
it.each([false, true])('does not demand an external deferred capture before its branch with demand=%s', used => {
    const text = `use sequences
Base = array 1 2
Data' = Base (1 to 20)
fun Used probe
 if Used
  Total = 0
  for Value in Data
   Total += Value
  end
  return Total
 end
 return 7
end
${used} probe`;
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
});

it('retains the ordinary text-result route for a captured traversal', () => {
    const text = source.replace('return Total', 'return Total greater 0 choose "yes" "no"');
    expect({ ...run(text, true), calls: 0 }).toEqual(run(text, false));
});

it.each([['true', 'not Previous', 'true'], ['0.5', 'Previous + 0.5', '10.5']])('keeps recursive scalar result %s without integer coercion', (seed, result, expected) => {
    const text = `fun N recurse
 if N equal 0
  return ${seed}
 end
 Previous = (N - 1) recurse
 return ${result}
end
20 recurse`;
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(text));
        expect(formatValue(value!)).toBe(expected);
        expect(formatValue(value!)).toBe(run(text, false).value);
        expect(diagnostics.numberFunctions).toBeGreaterThan(1);
        expect(diagnostics.numberFunctionFallbacks).toBe(0);
    } finally { runtime.dispose(); }
});

it('preserves captured-text compilation, Unicode ordinals and rebinding', () => {
    const text = `Text = "A😀B"
fun Ignored count_text
 Total = 0
 for Letter Index in Text
  Total += Index
 end
 return Total
end
First = 0 count_text
Text = "Z"
Second = 0 count_text
array First Second`;
    const compiled = run(text, true);
    expect({ ...compiled, calls: 0 }).toEqual(run(text, false));
    expect(compiled.value).toBe('3 0');
    expect(compiled.calls).toBeGreaterThan(0);
});
