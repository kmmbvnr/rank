import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse, type NativeFunction, type RankArray, type RankTuple, type RankValue } from '../src/index.js';
import { isFunctionStatement } from '@arrrank/language';
import { compileNumericFunction } from '../src/jit/numeric-function.js';
import { createArraySnapshot, typedArray } from '../src/array-storage.js';
import { withInterrupt } from '../src/interrupt.js';

const stage = readFileSync(new URL('../../../demos/classic/fft.ra', import.meta.url), 'utf8').split('rem Radix-2')[0];
const vector = (n: number, offset = 0) => Float64Array.from({ length: n }, (_, i) => Math.sin(i * .71 + offset));
function fixture(arrayFunctionCompilation = true, source = stage, name = 'fftStage') {
    const generated: string[] = [], diagnostics = new RuntimeDiagnostics(), output: string[] = [];
    const runtime = new Interpreter(text => output.push(text), {
        arrayFunctionCompilation,
        onFunctionBodyCompiled: text => { if (text.includes('numeric-array-function')) generated.push(text); },
    });
    runtime.execute(source);
    const fn = runtime.variables.get(name) as NativeFunction;
    return { runtime, generated, diagnostics, output,
        call: (args: RankValue[]) => diagnostics.run(() => fn.call(args)),
    };
}
function argumentsFor(n: number, size: bigint | number = BigInt(n), boxed = false): RankValue[] {
    const array = (x: Float64Array) => boxed ? createArraySnapshot(x) : typedArray(x);
    return [array(vector(n)), array(vector(n, .37)),
        array(Float64Array.from({ length: n / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / n))),
        array(Float64Array.from({ length: n / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / n))), size];
}
function normalized(value: RankValue): unknown {
    if (typeof value === 'object' && value.kind === 'tuple') return value.items.map(normalized);
    if (typeof value === 'object' && value.kind === 'array') return { shape: [...value.shape], items: [...value.items] };
    return value;
}
function result(f: ReturnType<typeof fixture>, args: RankValue[]) {
    try { return { value: normalized(f.call(args)), output: [...f.output] }; }
    catch (error) { return { error: (error as Error).message, output: [...f.output] }; }
}
function compare(args: RankValue[], source = stage, name = 'fftStage') {
    const reference = fixture(false, source, name), compiled = fixture(true, source, name);
    try {
        const actual = result(compiled, args);
        expect(actual).toEqual(result(reference, args));
        return { ...actual, executions: compiled.diagnostics.compiledArrayFunctions, generated: compiled.generated };
    } finally { reference.runtime.dispose(); compiled.runtime.dispose(); }
}

describe('pure structural numeric functions', () => {
    it('reuses preparation while reading fresh input buffers', () => {
        const f = fixture(), reference = fixture(false);
        try {
            for (let i = 0; i < 4; i++) {
                const args = argumentsFor(64);
                args[0] = typedArray(vector(64, i * .29));
                expect(normalized(f.call(args))).toEqual(normalized(reference.call(args)));
            }
            expect(f.diagnostics.numericFunctionPreparations).toBe(1);
            expect(f.diagnostics.numericFunctionPlanHits).toBe(3);
        } finally { f.runtime.dispose(); reference.runtime.dispose(); }
    });
    it('distinguishes scalar negative zero and uses current scalar values', () => {
        const source = `use sequences
fun X scaled Scale
 return (X reshape #) * Scale
end`;
        const f = fixture(true, source, 'scaled'), reference = fixture(false, source, 'scaled');
        try {
            for (const scalar of [-0, 0, -0, 2.5, -1.5]) {
                const args = [typedArray(new Float64Array(8).fill(1)), scalar];
                expect(normalized(f.call(args))).toEqual(normalized(reference.call(args)));
            }
            expect(f.diagnostics.numericFunctionPreparations).toBe(4);
            expect(f.diagnostics.numericFunctionPlanHits).toBe(1);
        } finally { f.runtime.dispose(); reference.runtime.dispose(); }
    });
    it('guards shape, scalar kind and bounds after warming', () => {
        const f = fixture(), reference = fixture(false);
        try {
            for (const [n, size] of [[16, 16n], [64, 16n], [16, 16n], [16, 6n], [16, 16.0], [16, 0n]] as const) {
                expect(result(f, argumentsFor(n, size))).toEqual(result(reference, argumentsFor(n, size)));
            }
        } finally { f.runtime.dispose(); reference.runtime.dispose(); }
    });
    it('rechecks input kinds and failed arithmetic on a cached plan', () => {
        const f = fixture(), reference = fixture(false), args = argumentsFor(16);
        try {
            expect(result(f, args)).toEqual(result(reference, args));
            (args[0] as RankArray).items[0] = NaN;
            expect(result(f, args)).toEqual(result(reference, args));
            (args[0] as RankArray).items[0] = 3n;
            expect(result(f, args)).toEqual(result(reference, args));
            expect(f.diagnostics.compiledArrayFunctions).toBe(1);
        } finally { f.runtime.dispose(); reference.runtime.dispose(); }
    });
    it('rechecks native operations on a warm specialization', () => {
        const statement = parse('use sequences\nfun X flattened\n N = X len\n return X reshape N\nend').statements[1];
        if (!isFunctionStatement(statement)) throw new Error('fixture');
        let available = true, executed = 0, generated = 0, reads = 0;
        const input = typedArray(vector(16));
        const plan = compileNumericFunction(statement, {
            lookup: () => { reads++; return input; }, builtin: () => available,
            compiled: () => generated++, executed: () => executed++,
        })!;
        expect(plan.run()).toBeDefined(); expect(generated).toBe(1);
        available = false; reads = 0;
        expect(plan.run()).toBeUndefined(); expect(reads).toBe(0); expect(executed).toBe(1);
        available = true;
        expect(plan.run()).toBeDefined(); expect(generated).toBe(1); expect(executed).toBe(2);
    });
    it('bounds the preparation cache and rebuilds an evicted specialization', () => {
        const statement = parse('use sequences\nfun X scaled Scale\n return (X reshape #) * Scale\nend').statements[1];
        expect(isFunctionStatement(statement)).toBe(true);
        if (!isFunctionStatement(statement)) throw new Error('fixture');
        const variables = new Map<string, RankValue>([['X', typedArray(vector(8))], ['Scale', 1.0]]);
        let generated = 0;
        const plan = compileNumericFunction(statement, { lookup: name => variables.get(name),
            builtin: () => true, compiled: () => generated++, executed: () => {} })!;
        for (let i = 1; i <= 40; i++) { variables.set('Scale', i); expect(plan.run()).toBeDefined(); }
        expect(generated).toBe(40);
        expect(plan.run()).toBeDefined(); expect(generated).toBe(40);
        variables.set('Scale', 1.0); expect(plan.run()).toBeDefined(); expect(generated).toBe(41);
    });
    it.each(['+=', '-=', '*=', '/='])('retains compound assignment semantics for %s', operator => {
        const source = `use sequences
fun X update
 A = X reshape #
 A ${operator} A * 0.25
 return A reshape #
end`;
        const result = compare([typedArray(vector(16, .37))], source, 'update');
        expect(result.executions).toBe(0);
    });
    it.each([false, true])('compiles every stage with completed real inputs (boxed=%s)', boxed => {
        const f = fixture();
        try {
            for (const n of [2, 4, 8, 16, 64, 256]) for (let size = 2; size <= n; size *= 2) {
                const reference = fixture(false);
                try {
                    const args = argumentsFor(n, BigInt(size), boxed);
                    expect(normalized(f.call(args))).toEqual(normalized(reference.call(args)));
                } finally { reference.runtime.dispose(); }
            }
            expect(f.diagnostics.compiledArrayFunctions).toBe(24);
            expect(f.generated.length).toBeGreaterThan(0);
        } finally { f.runtime.dispose(); }
    });
    it('does not depend on the function name or FFT-specific matching', () => {
        const renamed = stage.split('fftStage').join('transformBlocks');
        const r = compare(argumentsFor(64), renamed, 'transformBlocks');
        expect(r.executions).toBe(1);
    });
    it('compiles a different reshape and broadcast pipeline', () => {
        const source = `use sequences
fun X reshapeArithmetic Scale
 N = X len
 Grid = X reshape # 2
 Shifted = Grid * Scale + 0.5
 return Shifted reshape N
end`;
        const r = compare([typedArray(vector(32)), 2.0], source, 'reshapeArithmetic');
        expect(r.executions).toBe(1);
    });
    it('compiles a return-only structural expression', () => {
        const source = `use sequences
fun X flatten
 return X reshape #
end`;
        const r = compare([typedArray(vector(12), [3, 4])], source, 'flatten');
        expect(r.executions).toBe(1);
    });
    it.each([0, 1])('maps concatenation and nontrailing broadcast on axis %s', axis => {
        const source = `use sequences
fun X Y combine
 A = X reshape 2 3
 B = Y reshape 2 1
 C = A + B
 return concat C (C * 0.5) axis ${axis}
end`;
        const r = compare([typedArray(vector(6)), typedArray(vector(2))], source, 'combine');
        expect(r.executions).toBe(1);
    });
    it('preserves inline metadata expression behavior', () => {
        const source = `use sequences
fun X inlineLength Z
 return X reshape ((X / Z) len)
end`;
        compare([typedArray(vector(16)), 0.0], source, 'inlineLength');
    });
    it('keeps exact scalar remainders near the safe integer boundary', () => {
        const source = `use sequences
fun X A shifted B
 Shift = (A mod B) + 2
 Grid = X reshape #
 return Grid + Shift
end`;
        const r = compare([typedArray(vector(16)), 9007199254740991n, -3n], source, 'shifted');
        expect(r.executions).toBe(1);
    });
    it.each([0n, -2n, 6n, 4.0, 1n << 70n])('preserves errors for invalid scalar dimensions: %s', size => {
        const r = compare(argumentsFor(16, size));
        expect(r).toHaveProperty('error'); expect(r.executions).toBe(0);
    });
    it('preserves a valid non-power-of-two stage width', () => {
        const r = compare(argumentsFor(16, 3n)); expect(r.executions).toBe(1);
    });
    it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE])('preserves non-finite values and large intermediates: %s', value => {
        const args = argumentsFor(16), cells = vector(16); cells[7] = value;
        if (value === Number.MAX_VALUE) cells.fill(value);
        args[0] = typedArray(cells); compare(args);
    });
    it('keeps signed zero', () => {
        const args = argumentsFor(8);
        args[0] = typedArray(new Float64Array([0, -0, 0, -0, -0, 0, -0, 0]));
        args[1] = typedArray(new Float64Array(8)); compare(args);
    });
    it('keeps gather bounds and shape errors', () => {
        const args = argumentsFor(16); args[2] = typedArray(new Float64Array(1));
        expect(compare(args)).toHaveProperty('error');
    });
    it('does not skip an unused array binding that raises', () => {
        const source = `use sequences
fun X invalid
 Dead = X / 0.0
 Out = X reshape # 2
 return Out + 0.5
end`;
        const r = compare([typedArray(vector(16))], source, 'invalid');
        expect(r).toHaveProperty('error'); expect(r.executions).toBe(0);
    });
    it('does not skip array computation used only through its shape', () => {
        const source = `use sequences
fun X invalidLength Z
 Bad = X / Z
 N = Bad len
 Out = X reshape N
 return Out + 0.5
end`;
        const r = compare([typedArray(vector(16)), 0.0], source, 'invalidLength');
        expect(r).toHaveProperty('error'); expect(r.executions).toBe(0);
    });
    it('preserves local rank-stability contracts', () => {
        const source = `use sequences
fun X invalidRank
 A = X reshape # 2
 A = A reshape #
 return A + 0.5
end`;
        const r = compare([typedArray(vector(16))], source, 'invalidRank');
        expect(r).toHaveProperty('error'); expect(r.executions).toBe(0);
    });
    it('preserves earlier arithmetic errors before a later invalid reshape', () => {
        const source = `use sequences
fun X invalidOrder Z
 A = X / Z
 B = A reshape 3 3
 return B + 0.5
end`;
        const r = compare([typedArray(vector(16)), 0.0], source, 'invalidOrder');
        expect(r).toHaveProperty('error'); expect(r.executions).toBe(0);
    });
    it('does not eliminate observable statements or captured values', () => {
        const source = `use sequences
use io
Offset = 0.5
fun X observable
 99 print
 A = X reshape # 2
 return A + Offset
end`;
        const r = compare([typedArray(vector(16))], source, 'observable');
        expect(r.output).toEqual(['99']); expect(r.executions).toBe(0);
    });
    it('retains independent results across calls and input writes', () => {
        const f = fixture();
        try {
            const args = argumentsFor(64), first = f.call(args) as RankTuple, saved = normalized(first);
            f.call(argumentsFor(64, 4n)); (args[0] as RankArray).items[0] = 999;
            expect(normalized(first)).toEqual(saved);
        } finally { f.runtime.dispose(); }
    });
    it('retains ordinary checkpoints when interruption is observable', () => {
        const f = fixture();
        try {
            const signal = new Int32Array(new SharedArrayBuffer(12));
            withInterrupt(signal, () => f.call(argumentsFor(16)), () => {});
            expect(f.diagnostics.compiledArrayFunctions).toBe(0);
        } finally { f.runtime.dispose(); }
    });
});
