import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { greatestCommonDivisor, safeIntegerGcd } from '../src/integer-gcd.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function observe(source: string, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    let result: string | undefined, error: string | undefined;
    try {
        try {
            const value = diagnostics.run(() => runtime.execute(source));
            result = value === undefined ? undefined : formatValue(value);
        } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { result, error, values: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const candidate = observe(source);
    expect(candidate.state).toEqual(observe(source, { compilation: false }).state);
    expect(candidate.state).toEqual(observe(source, { numberLoopCompilation: false }).state);
    expect(candidate.state).toEqual(observe(source, { typedNativeCalls: false }).state);
    return candidate;
}

describe('catalogue scalar builtins in private Number loops', () => {
    it('keeps Number Euclid exact at safe-integer boundaries', () => {
        for (const a of [0, 1, -1, 2 ** 31, 2 ** 52 - 1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
            for (const b of [0, 30, -30, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER - 2]) {
                expect(BigInt(safeIntegerGcd(a, b))).toBe(greatestCommonDivisor(BigInt(a), BigInt(b)));
            }
        }
    });

    it.each(['I gcd -30', 'I lcm 30', 'I 3 17 powmod', '(I + 2) binomial 2', 'I sin', 'I atan2 2'])
    ('uses the shared scalar call adapter for %s', expression => {
        const source = `use numbers\nA = array shape 6 fill ${expression.includes('sin') || expression.includes('atan2') ? '0.0' : '0'}\nfor I in 0 to 5\n A I = ${expression}\nend\nA`;
        const result = compare(source);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it.each([
        'use numbers\nA = array 0 0 0\nB = A\nfor I in 0 to 2\n A I = (9007199254740991 - I) lcm 2\nend\nA',
        'use numbers\nA = array 0 0 0\nfor I in 0 to 2\n A I = (100 + I) binomial 30\nend\nA',
    ])('replays exactly when a builtin result exceeds safe integers: %s', source => {
        const result = compare(source);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it.each(['2 (1 - I) 7 powmod', '(1 - I) binomial 2', '(I - 1) atanh'])
    ('preserves native errors and preceding private writes for %s', expression => {
        const source = `use numbers\nA = array 0 0 0\nB = A\nfor I in 0 to 2\n A I = I + 1\n R = ${expression}\nend`;
        const result = compare(source);
        expect(result.state.error).toBeDefined();
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('rechecks a cached builtin identity before selecting a Number kernel', () => {
        const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
        try {
            runtime.execute('use numbers\nfun work\n S = 0\n for I in 1 to 5\n  S += I gcd 30\n end\n return S\nend\nBefore = work');
            runtime.execute('fun A replacement B\n return 42\nend');
            runtime.variables.set('gcd', runtime.variables.get('replacement')!);
            runtime.execute('After = work');
            expect(runtime.variables.get('After')).toBe(210n);
        } finally { runtime.dispose(); }
    });
});


describe('guarded integer powers in private loops', () => {
    it.each([
        'S = 0\nfor I in 0 to 20\n S += 2 ** I\nend\nS',
        'S = 0\nfor I in 0 to 20\n S += -I ** (I mod 3)\nend\nS',
        'S = 0\nfor I in 0 to 20\n S += (-I) ** (I mod 3)\nend\nS',
        'S = 0\nfor I in 0 to 3\n S += I ** (0)\nend\nS',
        'A = array 0 0 0\nfor I in 0 to 2\n A I = 3 ** (33 - I)\nend\nA',
        'S = 0\nfor I in 4294967296 to 4294967298\n S += (-1) ** I\nend\nS',
    ])('compiles exact powers without approximate JS exponentiation: %s', source => {
        const result = compare(source);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
        expect(result.diagnostics.fallbacks['loop:unsupported-op:**']).toBeUndefined();
    });

    it.each([
        'S = 0\nfor I in 53 to 55\n S += 2 ** I\nend\nS',
        'Huge = 1267650600228229401496703205376\nS = 0\nfor I in 0 to 3\n S += Huge ** I\nend\nS',
        'S = 0\nfor I in 0 to 1\n S += 3 ** 33\nend\nS',
    ])('keeps exact BigInt registers after a private overflow: %s', source => {
        const result = compare(source);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    });

    it.each([
        'A = array 0 0 0\nB = A\nfor I in 0 to 2\n A I = 2 ** (53 + I)\nend\nA',
        'for I in 1 to 3\n R = 2 ** (1 - I)\nend\nR',
        'for I in 1 to 3\n Before = I\n R = 0 ** (1 - I)\nend',
        'S = 0\nfor I in 1 to 3\n S += 2 ** (1 - I)\nend',
        'A = array 0 0 0\nfor I in 0 to 3\n A I = 2 ** I\nend',
    ])('preserves exact replay, real results, errors and partial stores: %s', source => {
        compare(source);
    });
});
