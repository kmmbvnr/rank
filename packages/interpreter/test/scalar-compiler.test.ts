import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, formatValue, isNativeFunction, type RankValue } from '../src/index.js';

function evaluate(expression: string, a: RankValue, b: RankValue, enabled: boolean) {
    let entries = 0;
    const runtime = new Interpreter(undefined, { scalarEntryCompilation: false, scalarCompilation: enabled, tensorFusion: false,
        onScalarExecuted: () => entries++ });
    try {
        runtime.execute(`fun calc A B\n  return ${expression}\nend`);
        const fn = runtime.variables.get('calc');
        if (!fn || !isNativeFunction(fn)) throw new Error('missing calc');
        const value = fn.call([a, b]);
        return { value: typeof value === 'object' ? formatValue(value) : value, entries };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), entries };
    } finally { runtime.dispose(); }
}

describe('compiled scalar expressions', () => {
    it.each(['A * 3 + B', '(A + B) * (A - B)', '(A + B) // B', '(A - B) % B',
        '(A + B) less B', '(A + B) equal A', '-(A + B)', 'not (A less B)'])('%s preserves numeric and fallback semantics', expression => {
        for (const [a, b] of [[7n, 3n], [-7n, 3n], [7n, -3n], [-7n, -3n], [1n, 0n],
            [2n ** 100n, 7n], [1.25, 2.5], [-0, -0], [Infinity, -Infinity], [NaN, 1],
            [1n, 0.25], ['a', 'b'], [true, false],
            [{ kind: 'array', shape: [2], items: [1n, 2n] }, 2n]] as [RankValue, RankValue][]) {
            const reference = evaluate(expression, a, b, false);
            const compiled = evaluate(expression, a, b, true);
            expect({ ...compiled, entries: 0 }).toEqual({ ...reference, entries: 0 });
            expect(compiled.entries).toBeGreaterThan(0);
        }
    });

    it('preserves failure order before reading a later unknown name', () => {
        const source = 'fun calc A B\n  return (A + B) * Missing\nend\n1 "text" calc';
        const errors = [false, true].map(scalarCompilation => {
            const runtime = new Interpreter(undefined, { scalarCompilation });
            try { runtime.execute(source); } catch (error) {
                return error instanceof RankError ? error.format() : String(error);
            } finally { runtime.dispose(); }
            return undefined;
        });
        expect(errors[1]).toEqual(errors[0]);
        expect(errors[1]).toContain('+ expects');
    });

    it('keeps fixed variable types and branches outside the expression compiler', () => {
        for (const scalarCompilation of [false, true]) {
            const runtime = new Interpreter(undefined, { scalarCompilation });
            expect(() => runtime.execute('X = 1\nX = 1.0 * 2.0 + 3.0')).toThrow(/cannot receive/);
            runtime.dispose();
        }
    });

    it('reuses generated code while binding separate local closures', () => {
        let compiled = 0;
        const runtime = new Interpreter(undefined, { onScalarCompiled: () => compiled++ });
        const value = runtime.execute(`fun outer A
  fun inner X
    return A * 2 + X
  end
  return 3 inner
end
A = 4 outer
B = 7 outer
array A B
`);
        expect(formatValue(value!)).toBe('11 17');
        expect(compiled).toBe(1);
        runtime.dispose();
    });

    it('falls back when dynamic code generation is unavailable', () => {
        const blocked = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try { expect(evaluate('A * 3 + B', 2n, 4n, true)).toEqual({ value: 10n, entries: 0 }); }
        finally { blocked.mockRestore(); }
    });
});
