import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';

function run(source: string, nativeLoopCompilation: boolean, typedNativeCalls = true) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(undefined, { scalarEntryCompilation: false, nativeLoopCompilation, typedNativeCalls });
    try {
        let result: string | undefined, error: string | undefined;
        try {
            const value = diagnostics.run(() => runtime.execute(source));
            result = value === undefined ? undefined : formatValue(value);
        } catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
        const values = [...runtime.variables].filter(([, value]) => typeof value !== 'object' || isRankArray(value))
            .map(([name, value]) => [name, formatValue(value)]);
        return { result, error, values, loops: diagnostics.compiledLoops };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), compiled = run(source, true);
    expect(run(source, true, false)).toEqual(compiled);
    expect({ ...compiled, loops: 0 }).toEqual({ ...reference, loops: 0 });
    return compiled;
}

describe('integer numeric calls in compiled loops', () => {
    it.each([
        ['I gcd 6', '22'], ['I isqrt', '18'], ['I lcm 6', '174'],
        ['I 3 7 powmod', '28'], ['I binomial 2', '165'], ['I abs', '54'],
    ])('compiles %s with the ordinary native implementation', (expression, expected) => {
        const result = compare(`use numbers\nS = 0\nfor I in 2 to 10\n S += ${expression}\nend\nS`);
        expect(result.result).toBe(expected);
        expect(result.loops).toBe(1);
    });

    it('compiles the complete nested coprime search', () => {
        const result = compare(`use numbers
S = 0
for A in 1 to 50
 for B in 1 to 50
  if A gcd B equal 1
   S += 1
  end
 end
end
S`);
        expect(result.result).toBe('1547');
        expect(result.loops).toBe(1);
    });

    it.each([
        ['I gcd -6', '-3', '3', '18'], ['I gcd 0', '0', '1', '1'],
        ['I lcm -6', '-3', '3', '36'], ['I lcm 0', '0', '1', '0'],
        ['I isqrt', '0', '30', '100'], ['I 0 1 powmod', '-3', '3', '0'],
        ['I 3 7 powmod', '-3', '3', '21'], ['I binomial 0', '0', '5', '6'],
    ])('preserves signed and boundary arithmetic: %s', (expression, start, end, expected) => {
        const result = compare(`use numbers\nS = 0\nfor I in ${start} to ${end}\n S += ${expression}\nend\nS`);
        expect(result.result).toBe(expected);
        expect(result.loops).toBe(1);
    });

    it('keeps exact integers beyond both safe Number and signed 64-bit ranges', () => {
        const result = compare(`use numbers
Huge = 1267650600228229401496703205376
S = 0
for I in 1 to 3
 S += (I * Huge) gcd (2 * Huge)
 S += (Huge * Huge + I) isqrt
 S += (I * Huge) lcm (3 * Huge)
 S += Huge 5 (Huge + 7) powmod
 S += (Huge + I) binomial 2
end
S`);
        expect(result.error).toBeUndefined();
        expect(result.loops).toBe(1);
        expect(BigInt(result.result!)).toBeGreaterThan(2n ** 100n);
    });

    it.each([
        '(1 - I) isqrt', '2 (1 - I) 7 powmod', '2 3 (2 - I) powmod', '(1 - I) binomial 0',
    ])('retains error location and assignments before %s fails', expression => {
        const result = compare(`use numbers\nS = 0\nX = 99\nfor I in 1 to 3\n S += 1\n X = ${expression}\nend\nS`);
        expect(result.error).toBeDefined();
        expect(result.loops).toBe(1);
        expect(result.values).toContainEqual(['S', '2']);
    });

    it('keeps numeric error frames and caller state across a compiled function loop', () => {
        const result = compare(`use numbers
fun N helper
 Total = 0
 for I in 1 to N
  Total += 1
  Root = (1 - I) isqrt
 end
 return Total
end
S = 99
S = 3 helper`);
        expect(result.error).toContain('isqrt expects a nonnegative integer');
        expect(result.values).toContainEqual(['S', '99']);
        expect(result.loops).toBe(1);
    });

    it('does not evaluate native calls in skipped branches or short-circuited operands', () => {
        const result = compare(`use numbers
S = 0
for I in 1 to 3
 if I less 0 and (((0 - I) isqrt) equal 1)
  S += 100
 end
 if I greater 0 or (((0 - I) isqrt) equal 1)
  S += 1
 end
 if I less 0
  S += (0 - I) isqrt
 end
end
S`);
        expect(result.result).toBe('3');
        expect(result.loops).toBe(1);
    });

    it('does not execute domain-invalid calls in empty loops', () => {
        const result = compare('use numbers\nS = 0\nfor I in 1 till 1\n S += (0 - 1) isqrt\nend\nS');
        expect(result.result).toBe('0');
    });

    it.each(['I gcd 1.5', 'I gcd .NA', 'I binomial .NA', '(array I 6) lcm', '(array I 6) gcd 2'])
    ('retains fallback and mapping for %s', expression => {
        compare(`use numbers\nS = 0\nfor I in 1 to 3\n X = ${expression}\n S += 1\nend\nX`);
    });

    it('retains the missing-import diagnostic', () => {
        expect(compare('S = 0\nfor I in 1 to 3\n S += I gcd 2\nend').error).toContain('use numbers');
    });

    it.each([
        ['gcd', 'A B', 'I 2'], ['isqrt', 'A', 'I'], ['lcm', 'A B', 'I 2'],
        ['powmod', 'A B C', 'I 2 7'], ['binomial', 'A B', 'I 2'],
    ])('keeps compiling a user function named %s without numbers imported', (name, parameters, arguments_) => {
        const call = parameters === 'A B' ? `I ${name} 2` : `${arguments_} ${name}`;
        const result = compare(`fun ${parameters} ${name}\n return A * 2\nend\nS = 0\nfor I in 1 to 3\n S += ${call}\nend\nS`);
        expect(result.result).toBe('12');
        expect(result.loops).toBe(1);
    });

    it('binds a cached numeric loop after recovering from a missing import', () => {
        const runtime = new Interpreter(undefined, { scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`fun helper
 S = 0
 for I in 1 to 3
  S += I gcd 2
 end
 return S
end`);
            expect(() => runtime.execute('helper')).toThrow('use numbers');
            runtime.execute('use numbers');
            for (let call = 0; call < 2; call++) {
                expect(diagnostics.run(() => runtime.execute('helper'))).toBe(4n);
            }
            expect(diagnostics.compiledLoops).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('rechecks function inputs across repeated calls and recovers after invalid arguments', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use numbers
fun A helper B
 S = 0
 for I in 1 to 3
  S += A gcd B
 end
 return S
end`);
            expect(runtime.execute('12 helper 18')).toBe(18n);
            expect(() => runtime.execute('1.5 helper 18')).toThrow('expected integer input');
            expect(runtime.execute('0 helper -18')).toBe(54n);
            expect(runtime.execute('12 helper 18')).toBe(18n);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['1000000 binomial 500000', 'computing binomial'],
        ['2 Exponent 7 powmod', 'computing numbers'],
        ['A gcd B', 'computing numbers'],
    ])('can interrupt inside a single long numeric call: %s', (expression, activity) => {
        let checks = 0;
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {},
            exchange: () => ++checks === 5 ? 1 : 0 };
        const runtime = new Interpreter();
        const diagnostics = new RuntimeDiagnostics();
        try {
            let a = 0n, b = 1n;
            for (let i = 0; i < 10000; i++) [a, b] = [b, a + b];
            runtime.variables.set('A', a); runtime.variables.set('B', b);
            runtime.variables.set('Exponent', 1n << 10000n);
            runtime.execute('use numbers\nS = 0\nX = 99');
            expect(() => diagnostics.run(() => withInterrupt(signal, () => runtime.execute(
                `for I in 1 to 1\n S += 1\n X = ${expression}\nend`))))
                .toThrow(`Interrupted while ${activity}`);
            expect(diagnostics.compiledLoops).toBe(1);
            expect(runtime.variables.get('S')).toBe(1n);
            expect(runtime.variables.get('X')).toBe(99n);
            expect(runtime.execute('6 gcd 9')).toBe(3n);
        } finally { runtime.dispose(); }
    });
});
