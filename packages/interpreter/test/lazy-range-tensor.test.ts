import { expect, it } from 'vitest';
import { isRankSequenceMask } from '../src/value.js';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';

function run(source: string, compilation: boolean) {
    let kernels = 0;
    const runtime = new Interpreter(() => {}, { compilation,
        onTensorKernelExecuted: () => kernels++,
    });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute('use sequences\nuse numbers\n' + source));
        return { value: formatValue(value!), kernels, numeric: diagnostics.numberTensors };
    } finally { runtime.dispose(); }
}

it.each([
    "N' = 1 till 1000\nAnswer = (N mod 3) sum",
    "N' = 10 to -10 by -2\nAnswer = (N * -1) sum",
    "N' = 9007199254740993 to 9007199254740995\nAnswer = (N + 1) sum",
    "N' = 1 till 1\nAnswer = (N + 1) sum",
])('compiles scalar maps of finite progressions: %s', source => {
    const actual = run(source, true);
    expect(actual.value).toBe(run(source, false).value);
    expect(actual.kernels).toBeGreaterThan(0);
});

it.each([
    "N' = 1 to 3\n(N + (array 10 20 30)) array",
    "N' = 1 to 3\n((N + 1) + (array 10 20 30)) array",
])('preserves sequence zip semantics: %s', source => {
    expect(run(source, true).value).toBe(run(source, false).value);
});

it('fuses the deferred Euler mask chain into one pass', () => {
    const source = `N' = 1 till 1000
Mask' = N mod 3 equal 0
Mask' or= N mod 5 equal 0
Answer = N Mask sum`;
    const actual = run(source, true);
    expect(actual.value).toBe('233168');
    expect(actual.value).toBe(run(source, false).value);
    for (const compilation of [false, true]) {
        expect(actual.value).toBe(run(source.replace("N' =", 'N ='), compilation).value);
    }
    expect(actual.kernels).toBe(1);
    expect(actual.numeric).toBe(1);
});

// Stored and sequence operands have different alignment rules. Errors, too,
// must stay on the reference path when a graph is not a scalar range map.
function outcome(source: string, compilation: boolean) {
    try { return run(source, compilation).value; }
    catch (error) { return error instanceof RankError ? error.format() : String(error); }
}

it.each([
    "N' = 1 to 3\nAnswer = (N + (array 10 20)) sum",
    "N' = 1 to 3\nAnswer = ((N + 1) + (array 10 20)) sum",
    "N' = 1 to 3\nAnswer = (-N) sum",
    "N' = 1 to 3\nMask' = N mod 0 equal 0\nAnswer = N Mask sum",
    "N' = 1 to 3\nM' = 10 to 11\nValues' = N + M\nAnswer = Values sum",
    "N' = 1 to 3\nMask' = N equal 99\nAnswer = N Mask sum",
    "N' = 10 to -10 by -2\nMask' = N mod -3 equal -1\nAnswer = N Mask sum",
    "N' = 9007199254740993 to 9007199254740999\nMask' = N mod 3 equal 0\nAnswer = N Mask sum",
    "N' = -9007199254740991 to 9007199254740991 by 9007199254740991\nMask' = N equal 0\nAnswer = N Mask sum",
    "N' = 1 to 100\nValues' = N * N\nAnswer = Values sum",
])('keeps reference values and errors: %s', source => {
    expect(outcome(source, true)).toBe(outcome(source, false));
});

it('does not compile a replaced native sequence reader', () => {
    const runtime = new Interpreter();
    try {
        const value = runtime.execute("use sequences\nN' = 1 to 10\nMapped' = N * 2\nMapped");
        if (!value || typeof value !== 'object' || value.kind !== 'sequence') throw Error('expected sequence');
        value.plan.iterate = function* () { yield 77n; };
        runtime.variables.set('Changed', value);
        expect(runtime.execute('Answer = Changed sum')).toBe(77n);
    } finally { runtime.dispose(); }
});

it('does not compile a replaced native mask predicate', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute("use sequences\nN' = 1 to 10\nMask' = N mod 3 equal 0");
        const mask = runtime.execute('Mask');
        if (!mask || !isRankSequenceMask(mask)) throw Error('expected mask');
        Reflect.set(mask.predicate, 'test', () => false);
        runtime.variables.set('Changed', mask);
        expect(runtime.execute('Answer = N Changed sum')).toBe(0n);
    } finally { runtime.dispose(); }
});
