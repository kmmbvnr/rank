import {describe, expect, it} from 'vitest';
import {Interpreter, RankError, RuntimeDiagnostics, formatValue} from '../src/index.js';
import {native} from '../src/modules/shared.js';
import {isNativeFunction} from '../src/value.js';

const program = (expression: string, input = '5') => `use numbers
fun N probe
  Values = array shape 2 fill 0
  Values 0 = N + 1
  Values 1 = ${expression}
  return Values 0 + Values 1
end
Result = 0
for I in 1 to 1
  Result = (${input}) probe
end
Result`;

function evaluate(source: string, mode: 'compiled' | 'exact' | 'reference') {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, {
        compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact',
    });
    try {
        let result: string | undefined, error: string | undefined;
        try {
            const value = diagnostics.run(() => runtime.execute(source));
            result = value === undefined ? undefined : formatValue(value);
        } catch (cause) {
            if (!(cause instanceof RankError)) throw cause;
            error = cause.format();
        }
        return {result, error, globals: [...runtime.variables]
            .filter(([name]) => ['Result', 'I'].includes(name))
            .map(([name, value]) => [name, formatValue(value)]), diagnostics};
    } finally { runtime.dispose(); }
}

function compare(source: string) {
    const {diagnostics, ...compiled} = evaluate(source, 'compiled');
    for (const mode of ['reference', 'exact'] as const) {
        const {diagnostics: _, ...ordinary} = evaluate(source, mode);
        expect(compiled).toEqual(ordinary);
    }
    return {diagnostics, ...compiled};
}

describe('Number helpers with private arrays and numeric builtins', () => {
    it.each(['floor', 'ceil'])('compiles checked %s of integer and real expressions', operation => {
        for (const input of ['5', '-5', '0', '9007199254740991']) {
            for (const expression of [`N ${operation}`, `(N / 2) ${operation}`]) {
                // Leave room for the prefix store in the largest case.
                const source = program(expression, input).replace('Values 0 = N + 1', 'Values 0 = 0');
                const result = compare(source);
                expect(result.error).toBeUndefined();
                expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
                expect(result.diagnostics.numberFunctionFallbacks).toBe(0);
            }
        }
    });

    it.each(['N ** 0', 'N ** 2', '-N ** 2', '(-N) ** 2', '-N ** 3', 'N ** 9', '(N / 2 floor) ** 2'])(
        'preserves integer powers and unary precedence: %s', expression => {
            for (const input of ['5', '-5', '0']) {
                const result = compare(program(expression, input));
                expect(result.error).toBeUndefined();
                expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
                expect(result.diagnostics.numberFunctionFallbacks).toBe(0);
            }
        });

    it('uses checked products for a large safe power and retains negative-exponent guards', () => {
        const large = compare(program('N ** 33', '3'));
        expect(large.result).toBe('5559060566555527');
        expect(large.diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(large.diagnostics.numberFunctionFallbacks).toBe(0);
        const computed = compare(program('N ** N', '3'));
        expect(computed.result).toBe('31');
        // This call site cannot certify the existing nonnegative-argument
        // precondition; retain ordinary dispatch rather than widening its proof.
        expect(computed.diagnostics.numberFunctions).toBe(0);
        const negative = compare(program('N ** N', '-3'));
        expect(negative.error).toContain('cannot receive array rank 1 of real');
        expect(negative.diagnostics.numberFunctions).toBe(0);
    });

    it.each(['N ** 2', '-N ** 3', '(N * 2.0) floor', '(N * 2.0) ceil'])(
        'replays after private prefix writes on unsafe %s', expression => {
            const result = compare(program(expression, '9007199254740991')
                .replace('Values 0 = N + 1', 'Values 0 = 17'));
            expect(result.error).toBeUndefined();
            expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
            expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
        });

    it.each(['(N / 0) floor', '(N / 0) ceil', '((10.0 ** 1000) floor)', '((10.0 ** 1000) ceil)'])(
        'preserves domain errors, location and call stack: %s', expression => {
            const result = compare(program(expression));
            expect(result.error).toBeDefined();
            expect(result.diagnostics.numberFunctions).toBeGreaterThan(0);
        });

    it('preserves a later error after an overflowing power forces exact replay', () => {
        const result = compare(program('N ** 2', '9007199254740991')
            .replace('Values 0 = N + 1', 'Values 0 = 17')
            .replace('return Values 0 + Values 1', 'return Values 1 // (N - N)'));
        expect(result.error).toContain('division by zero');
        expect(result.diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    });

    it.each(['floor', 'ceil'])('rechecks the %s binding and native implementation after warmup', operation => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(() => {});
        try {
            diagnostics.run(() => runtime.execute(program(`(N / 2) ${operation}`)));
            expect(diagnostics.numberFunctions).toBeGreaterThan(0);
            const before = diagnostics.numberFunctions;
            let replacements = 0;
            const replacement = native('replacement', 1, () => { replacements++; return 40n; });
            runtime.variables.set(operation, replacement);
            expect(diagnostics.run(() => runtime.execute('5 probe'))).toBe(46n);
            Object.defineProperty(replacement, 'call', {value: () => { replacements++; return 50n; }});
            expect(diagnostics.run(() => runtime.execute('5 probe'))).toBe(56n);
            expect(diagnostics.numberFunctions).toBe(before);
            expect(replacements).toBe(2);
        } finally { runtime.dispose(); }
    });

    it.each(['floor', 'ceil'])('rejects an overridden call on the original %s object', operation => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(`use numbers\nsaved = ${operation}`);
            const original = runtime.variables.get('saved');
            if (!original || !isNativeFunction(original)) throw Error('missing builtin');
            runtime.execute(program(`(N / 2) ${operation}`));
            runtime.execute(`fun work
  Total = 0
  for I in 1 to 2
    Total += 5 probe
  end
  return Total
end`);
            diagnostics.run(() => runtime.execute('work'));
            expect(diagnostics.numberFunctions).toBeGreaterThan(0);
            const before = diagnostics.numberFunctions;
            Object.defineProperty(original, 'call', {value: () => 40n});
            expect(diagnostics.run(() => runtime.execute('work'))).toBe(92n);
            expect(diagnostics.numberFunctions).toBe(before);
        } finally { runtime.dispose(); }
    });
});
