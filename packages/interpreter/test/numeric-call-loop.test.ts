import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type NativeFunction, type RankValue } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const helper = `use sequences
fun X transform Scale
 Grid = X reshape # 2
 return (Grid * Scale + 0.5) reshape #
end`;
const initial = `A = array 1.0 -2.0 3.0 4.0
Saved = A
Count = 3`;
const loop = `for Count greater 0
 A = A transform 1.25
 Count -= 1
end`;
function observe(source: string, compilation = true, numberLoopCompilation = true, hooks = false) {
    const output: string[] = [], diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(text => output.push(text), { compilation, numberLoopCompilation,
        ...(hooks ? { onIntegerLoopExecuted: () => {} } : {}) });
    try {
        let result: string | undefined, error: string | undefined;
        try { const value = diagnostics.run(() => runtime.execute(source)); result = value === undefined ? undefined : formatValue(value); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { result, error, output,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const actual = observe(source);
    expect(actual.observation).toEqual(observe(source, false).observation);
    expect(actual.observation).toEqual(observe(source, true, false).observation);
    return actual;
}
function normalized(value: RankValue): unknown {
    if (typeof value === 'object' && value.kind === 'tuple') return value.items.map(normalized);
    if (typeof value === 'object' && value.kind === 'array') return { shape: [...value.shape], items: [...value.items] };
    return value;
}

describe('private numeric helper calls in loops', () => {
    it('keeps saved inputs and publishes only final arrays', () => {
        const r = compare(`${helper}\n${initial}\n${loop}\nSaved`);
        expect(r.observation.error).toBeUndefined();
        expect(r.diagnostics.compiledNumericCallLoops).toBe(1);
        expect(r.diagnostics.numericLoopCalls).toBe(3);
    });
    it.each(['A = A transform 1.25', 'unpack A B = A B channels 0.25'])('preserves last call result: %s', call => {
        const source = `${helper}
fun X Y channels Scale
 Grid = X reshape # 2
 Other = Y reshape # 2
 return tuple ((Grid + Other * Scale) reshape #) ((Grid - Other * Scale) reshape #)
end
${initial}
B = A
for Count greater 0
 Count -= 1
 ${call}
end`;
        const r = compare(source);
        expect(r.observation.error).toBeUndefined(); expect(r.diagnostics.numericLoopCalls).toBe(3);
    });
    it('handles multiple sites, changing scalar arguments and signed zero', () => {
        const r = compare(`${helper}
${initial}
B = A
for Count greater 0
 A = A transform Count
 Count -= 1
 B = B transform -0.0
end
tuple A B`);
        expect(r.observation.error).toBeUndefined(); expect(r.diagnostics.numericLoopCalls).toBe(6);
    });
    it.each(['Count -= 1', 'Count = Count - 1', 'Count //= 2', 'Count = -Count + Count - 1'])('retains scalar schedule for %s', update => {
        const r = compare(`${helper}\n${initial}\nfor Count greater 0\n A = A transform Count\n ${update}\nend`);
        expect(r.observation.error).toBeUndefined(); expect(r.diagnostics.compiledNumericCallLoops).toBe(1);
    });
    it('preserves an empty loop', () => {
        const r = compare(`${helper}\n${initial}\nCount = 0\n${loop}`);
        expect(r.observation.error).toBeUndefined(); expect(r.diagnostics.numericLoopCalls).toBe(0);
    });
    it.each([
        'Count = 1025',
        'Count = 3.0',
    ])('declines unsupported control: %s', setup => {
        const r = compare(`${helper}\n${initial.replace('Count = 3', setup)}\n${loop}`);
        expect(r.observation.error).toBeUndefined(); expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
    });
    it.each([
        'Count //= (Count - 2)',
        'Count = 9007199254740991 + Count',
    ])('replays scalar failures after preceding calls: %s', update => {
        // The wide result changes the condition to false and avoids an unbounded fallback loop.
        const condition = update.includes('9007') ? 'Count less 10' : 'Count greater 0';
        const r = compare(`${helper}\n${initial}\nCount = 4\nfor ${condition}\n A = A transform 1.25\n ${update}\nend`);
        expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
    });
    it.each([
        ['return (X reshape # 2 Count) reshape #', 'Count'],
        ['return (X reshape #) / (Count - 2)', 'Count'],
        ['return (X reshape #) * 1.0e308', 'Count'],
        ['return X reshape 2 2', 'Count'],
    ])('replays failed array guards and preserves partial state: %s', (returned, parameter) => {
        const r = compare(`use sequences\nfun X transform ${parameter}\n ${returned}\nend\n${initial}\nfor Count greater 0\n A = A transform Count\n Count -= 1\nend`);
        expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
    });
    it.each([
        'A = A + 1.0',
        'Saved = A',
        'A 0 = 1.0',
        'A print',
    ])('declines unsupported/effectful statements: %s', extra => {
        const r = compare(`use io\n${helper}\n${initial}\nfor Count greater 0\n A = A transform 1.25\n ${extra}\n Count -= 1\nend`);
        expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
    });
    it('keeps exact floor division with a negative divisor', () => {
        const r = compare(`${helper}\n${initial}\nfor Count not equal 0\n A = A transform Count\n Count //= -2\nend`);
        expect(r.observation.error).toBeUndefined(); expect(r.diagnostics.numericLoopCalls).toBe(4);
    });
    it('does not bypass memo argument validation', () => {
        const r = compare(`${helper.replace('fun X', 'memo X')}\n${initial}\n${loop}`);
        expect(r.observation.error).toBeDefined(); expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
    });
    it('declines local helper declarations with captured scope', () => {
        const r = compare(`use sequences
fun X repeated
 Scale = 1.25
 fun Y step
  return (Y reshape #) * Scale
 end
 A = X
 Count = 3
 for Count greater 0
  A = A step
  Count -= 1
 end
 return A
end
(array 1.0 2.0 3.0 4.0) repeated`);
        expect(r.observation.error).toBeUndefined(); expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
    });
    it('retains observable compilation hooks', () => {
        const source = `${helper}\n${initial}\n${loop}`;
        const r = observe(source, true, true, true);
        expect(r.observation).toEqual(observe(source, false).observation);
        expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
    });
    it('declines captured and effectful helpers', () => {
        for (const body of ['return (X reshape #) * Scale + Global', 'X print\n return (X reshape #) * Scale']) {
            const r = compare(`use io\nGlobal = 0.5\nuse sequences\nfun X transform Scale\n ${body}\nend\n${initial}\n${loop}`);
            expect(r.diagnostics.compiledNumericCallLoops).toBe(0);
        }
    });
    it('borrows fresh inputs on repeated calls and retains earlier outputs', () => {
        const source = `${helper}
fun X repeated
 A = X
 Count = 4
 ${loop}
 return A
end`;
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false }), reference = new Interpreter(() => {}, { compilation: false });
        try {
            runtime.execute(source); reference.execute(source);
            const fn = runtime.variables.get('repeated') as NativeFunction, ordinary = reference.variables.get('repeated') as NativeFunction;
            const diagnostics = new RuntimeDiagnostics(), retained: RankValue[] = [], snapshots: unknown[] = [];
            for (let j = 0; j < 4; j++) {
                const args = [typedArray(Float64Array.from({ length: [16, 32, 16, 8][j] }, (_, i) => i + j * .5))];
                const result = diagnostics.run(() => fn.call(args));
                expect(normalized(result)).toEqual(normalized(ordinary.call(args)));
                retained.push(result); snapshots.push(normalized(result));
            }
            expect(retained.map(normalized)).toEqual(snapshots);
            expect(diagnostics.compiledNumericCallLoops).toBe(4);
            expect(diagnostics.numericFunctionPlanHits).toBeGreaterThan(0);
        } finally { runtime.dispose(); reference.dispose(); }
    });
    it('retains cancellation and bounded demand observation', () => {
        for (const run of [<T>(f: () => T) => withInterrupt(new Int32Array(new SharedArrayBuffer(4)), f),
            <T>(f: () => T) => withDemandBudget(100000, f)]) {
            const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
            try {
                run(() => diagnostics.run(() => runtime.execute(`${helper}\n${initial}\n${loop}`)));
                expect(diagnostics.compiledNumericCallLoops).toBe(0);
            } finally { runtime.dispose(); }
        }
    });
    it('runs unchanged FFT through twelve private helper calls', () => {
        const source = readFileSync(new URL('../../../demos/classic/fft.ra', import.meta.url), 'utf8').split('\n\nX =')[0];
        const runtime = new Interpreter(() => {}), reference = new Interpreter(() => {}, { numberLoopCompilation: false });
        try {
            runtime.execute(source); reference.execute(source);
            const args = [typedArray(Float64Array.from({ length: 4096 }, (_, i) => Math.sin(i * .37)))];
            const fn = runtime.variables.get('fftReal') as NativeFunction, ordinary = reference.variables.get('fftReal') as NativeFunction;
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => fn.call(args));
            expect(normalized(result)).toEqual(normalized(ordinary.call(args)));
            expect(diagnostics.compiledNumericCallLoops).toBe(1); expect(diagnostics.numericLoopCalls).toBe(12);
        } finally { runtime.dispose(); reference.dispose(); }
    });
});
