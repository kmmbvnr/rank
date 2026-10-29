import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { checkpoint, InterruptedError, withDemandBudget, withInterrupt } from '../src/interrupt.js';
import { prepareCompiledBuiltin, preparePositionalBuiltin, withNumberCalls } from '../src/typed-native.js';
import type { RankValue } from '../src/value.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

for (const positional of [false, true]) describe(`cooperative numeric calls (positional=${positional})`, () => {
    it.each(['gcd', 'lcm'])('requires a registered cooperative signature for %s', name => {
        let ordinary = 0, plain = 0, cooperative = 0;
        const result = name === 'gcd' ? 2 : 12;
        const standard = withNumberCalls(native(name, 2, () => { ordinary++; checkpoint('computing numbers'); return BigInt(result); }),
            { 'integer,integer': () => { plain++; return result; } },
            { 'integer,integer': () => { cooperative++; checkpoint('computing numbers'); return result; } });
        let value: RankValue = standard;
        let options: InterpreterOptions = {};
        const host = { modules: new Set(['numbers']), options: () => options,
            builtins: { is: (_module: string, _name: string, candidate: RankValue) => candidate === standard }, resolve: () => value };
        const invoke = () => positional
            ? (preparePositionalBuiltin(host, 'numbers', name, ['integer', 'integer'], true)() as unknown as (a: number, b: number) => number)(4, 6)
            : prepareCompiledBuiltin(host, 'numbers', name, ['integer', 'integer'], true)()!([4, 6]);
        expect(invoke()).toBe(result);
        expect([ordinary, plain, cooperative]).toEqual([0, 1, 0]);
        withInterrupt(new Int32Array(new SharedArrayBuffer(12)), () => expect(invoke()).toBe(result));
        expect([ordinary, plain, cooperative]).toEqual([0, 1, 1]);
        withDemandBudget(0, () => expect(invoke).toThrow('demand budget exhausted'));
        options = { typedNativeCalls: false };
        withInterrupt(new Int32Array(new SharedArrayBuffer(12)), () => expect(invoke()).toBe(result));
        expect(ordinary).toBe(1);
        options = {};
        withInterrupt(new Int32Array(new SharedArrayBuffer(12)), () => {
            value = { ...standard };
            expect(prepareCompiledBuiltin(host, 'numbers', name, ['integer', 'integer'], true)()).toBeUndefined();
        });
    });
    it('retains native cancellation checks before and after a kernel', () => {
        const signal = new Int32Array(new SharedArrayBuffer(12));
        let calls = 0;
        const standard = withNumberCalls(native('gcd', 2, () => 2n), { 'integer,integer': () => 2 },
            { 'integer,integer': () => { calls++; Atomics.store(signal, 0, 1); return 2; } });
        const host = { modules: new Set(['numbers']), options: () => ({}),
            builtins: { is: (_module: string, _name: string, candidate: RankValue) => candidate === standard }, resolve: () => standard };
        withInterrupt(signal, () => {
            const invoke = positional
                ? () => (preparePositionalBuiltin(host, 'numbers', 'gcd', ['integer', 'integer'], true)() as unknown as (a: number, b: number) => number)(4, 6)
                : () => prepareCompiledBuiltin(host, 'numbers', 'gcd', ['integer', 'integer'], true)()!([4, 6]);
            expect(invoke).toThrow(InterruptedError);
            expect(calls).toBe(1);
            Atomics.store(signal, 0, 1);
            expect(invoke).toThrow(/gcd/);
            expect(calls).toBe(1);
        });
    });
    it('keeps unregistered signatures, custom polling and inspection on the native path', () => {
        let ordinary = 0, cooperative = 0;
        const standard = withNumberCalls(native('gcd', 2, () => { ordinary++; return 2n; }), { 'integer,integer': () => 2 },
            { real: () => { cooperative++; return 2; } });
        const host = { modules: new Set(['numbers']), options: () => ({}), builtins: { is: () => true }, resolve: () => standard };
        const invoke = () => positional
            ? (preparePositionalBuiltin(host, 'numbers', 'gcd', ['integer', 'integer'], true)() as unknown as (a: number, b: number) => number)(4, 6)
            : prepareCompiledBuiltin(host, 'numbers', 'gcd', ['integer', 'integer'], true)()!([4, 6]);
        withInterrupt(new Int32Array(new SharedArrayBuffer(12)), () => expect(invoke()).toBe(2));
        expect(ordinary).toBe(1);
        withNumberCalls(standard, { 'integer,integer': () => 2 }, { 'integer,integer': () => { cooperative++; return 2; } });
        withInterrupt(new Int32Array(new SharedArrayBuffer(12)), () => expect(invoke()).toBe(2), () => {});
        withInterrupt({ length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} }, () => expect(invoke()).toBe(2));
        expect(ordinary).toBe(3);
        expect(cooperative).toBe(0);
    });
});

function observe(source: string, typedNativeCalls: boolean, mode = 'flag') {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { typedNativeCalls });
    const signal = new Int32Array(new SharedArrayBuffer(12));
    if (mode === 'cancel') signal[0] = 1;
    let error: string | undefined;
    const run = () => {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
    };
    try {
        if (mode === 'budget') withDemandBudget(30, run);
        else if (mode === 'inspection') withInterrupt(signal, run, () => {});
        else if (mode === 'custom') withInterrupt({ length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} }, run);
        else withInterrupt(signal, run);
        return { error, values: [...runtime.variables].map(([name, value]) => [name, formatValue(value)] as const), numberLoops: diagnostics.numberLoops };
    } finally { runtime.dispose(); }
}

describe('cooperative gcd in a numeric region', () => {
    it.each([['0', '0', '0'], ['0', '-34', '34'], ['-34', '55', '1'],
        ['9007199254740991', '9007199254740990', '1'], ['9007199254740993', '3', '3']])('preserves exact gcd(%s, %s)', (a, b, expected) => {
        const source = `use numbers\nA = ${a}\nB = ${b}\nValue = 0\nfor I in 1 to 2\n Value = A gcd B\nend`;
        const actual = observe(source, true);
        expect(actual).toEqual(observe(source, false));
        expect(actual.error).toBeUndefined();
        expect(new Map(actual.values).get('Value')).toBe(expected);
        if (a === '9007199254740993') expect(actual.numberLoops).toBe(0);
    });
    it.each(['cancel', 'budget', 'inspection', 'custom'])('preserves partial stores and errors in %s mode', mode => {
        const source = `use numbers
A = 34
B = 55
Total = 0
Before = 0
After = 0
for I in 1 to 10000
 Before = I
 Total += A gcd B
 After = I
end`;
        const actual = observe(source, true, mode);
        expect(actual).toEqual(observe(source, false, mode));
        if (mode === 'cancel') {
            expect(actual.error).toContain('Interrupted while gcd');
            expect(new Map(actual.values).get('Before')).toBe('1');
            expect(new Map(actual.values).get('Total')).toBe('0');
            expect(new Map(actual.values).get('After')).toBe('0');
        } else if (mode === 'budget') expect(actual.error).toContain('demand budget exhausted');
        else expect(actual.numberLoops).toBe(0);
    });
});
