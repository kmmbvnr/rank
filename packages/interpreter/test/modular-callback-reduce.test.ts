import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, isRankSequence, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, options), diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute('use sequences\n' + source));
        return { value: value === undefined ? undefined : formatValue(value), diagnostics };
    } finally { runtime.dispose(); }
}
const definition = (operator: string, modulus: bigint) => `Mod = ${modulus}\nfun Acc combine Value = (Acc ${operator} Value) mod Mod\n`;
const normalize = (x: bigint, m: bigint) => (x % m + m) % m;
const cases = [
    { start: -12n, step: 3n, count: 9, seed: undefined },
    { start: 17n, step: -4n, count: 8, seed: -123n },
    { start: 10n ** 30n, step: 10n ** 24n + 7n, count: 8, seed: 10n ** 40n },
];
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('native modular callback range reductions %j', options => {
    it.each(['+', '*'])('keeps exact %s folds, signed inputs and wide progressions', operator => {
        for (const modulus of [1n, 7n, 100000007n, 1073741824n, 2147483647n, 2147483648n]) for (const row of cases) {
            const values = Array.from({ length: row.count }, (_, i) => row.start + BigInt(i) * row.step);
            let expected = row.seed ?? values[0];
            for (const value of values.slice(row.seed === undefined ? 1 : 0)) expected = normalize(operator === '+' ? expected + value : expected * value, modulus);
            const source = definition(operator, modulus) + `Span' = ${row.start} to ${values.at(-1)} by ${row.step}\n` +
                `Span reduce combine${row.seed === undefined ? '' : ' with ' + row.seed}`;
            const actual = execute(source, options);
            expect(actual.value).toBe(String(expected));
            expect(actual.diagnostics.modularCallbackReductions).toBe(1);
        }
    });
    it.each(["Span' = 1 till 1\nSpan reduce combine with 123", "Span' = 5 to 5\nSpan reduce combine"])
        ('does not demand an unused failing modulus: %s', tail => {
        const actual = execute("Mod' = 1 // 0\nfun Acc combine Value = Acc * Value mod Mod\n" + tail, options);
        expect(actual.value).toBe(tail.includes('123') ? '123' : '5');
    });
    it('preserves empty reduction errors and array seeds', () => {
        expect(() => execute(definition('*', 7n) + "Span' = 1 till 1\nSpan reduce combine", options)).toThrow('requires an initial value');
        const actual = execute(definition('*', 7n) + "Span' = 1 to 3\nSpan reduce combine with (array 2 3)", options);
        expect(actual.value).toBe('5 4');
        expect(actual.diagnostics.modularCallbackReductions).toBe(0);
    });
    it('keeps wide moduli on the ordinary exact route', () => {
        const actual = execute(definition('*', 10n ** 20n + 7n) + "Span' = 1 to 5\nSpan reduce combine with 1", options);
        expect(actual.value).toBe('120');
        expect(actual.diagnostics.modularCallbackReductions).toBe(0);
    });
});
it('retains execution hooks and visible callback calls', () => {
    let calls = 0;
    const actual = execute(definition('*', 101n) + "Span' = 1 to 8\nSpan reduce combine with 1", {
        onScalarFunctionExecuted: () => { calls++; },
    });
    expect(actual.diagnostics.modularCallbackReductions).toBe(0);
    expect(calls).toBe(8);
});
it('keeps ordinary budget charging instead of publishing a partial scalar', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute('use sequences\n' + definition('*', 101n));
        expect(() => withDemandBudget(10, () => runtime.execute("Span' = 1 to 1000\nAnswer = Span reduce combine with 1"))).toThrow(DemandBudgetExhausted);
        expect(runtime.variables.has('Answer')).toBe(false);
    } finally { runtime.dispose(); }
});

it('reads a fresh captured modulus on every reduction', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('use sequences\n' + definition('*', 7n) + "Span' = 1 to 5");
        expect(diagnostics.run(() => runtime.execute('Span reduce combine with 1'))).toBe(1n);
        runtime.execute('Mod = 11');
        expect(diagnostics.run(() => runtime.execute('Span reduce combine with 1'))).toBe(10n);
        runtime.execute('Mod = 0');
        expect(() => runtime.execute('Span reduce combine with 1')).toThrow();
        expect(diagnostics.modularCallbackReductions).toBe(2);
    } finally { runtime.dispose(); }
});

it('does not probe an opaque indexed reader while folding its iterator', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('use sequences\n' + definition('*', 101n));
        const source = runtime.execute('1 to 4');
        if (!source || !isRankSequence(source)) throw Error('expected range');
        const reader = source.plan.at;
        let probes = 0;
        Object.defineProperty(source.plan, 'at', { get() { probes++; return reader; } });
        runtime.variables.set('Source', source);
        expect(diagnostics.run(() => runtime.execute('Source reduce combine with 1'))).toBe(24n);
        expect(diagnostics.modularCallbackReductions).toBe(0);
        expect(probes).toBe(0);
    } finally { runtime.dispose(); }
});
it('honors a host-replaced range iterator', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('use sequences\n' + definition('*', 101n));
        const source = runtime.execute('1 to 4');
        if (!source || !isRankSequence(source)) throw Error('expected range');
        source.plan.iterate = function* () { yield 77n; };
        runtime.variables.set('Source', source);
        expect(diagnostics.run(() => runtime.execute('Source reduce combine with 1'))).toBe(77n);
        expect(diagnostics.modularCallbackReductions).toBe(0);
    } finally { runtime.dispose(); }
});
