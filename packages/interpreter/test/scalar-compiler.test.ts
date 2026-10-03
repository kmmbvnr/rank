import { describe, expect, it, vi } from 'vitest';
import { compiledOperators, isFunctionStatement, isReturnStatement, isNameExpression } from '@arrrank/language';
import { withInterrupt } from '../src/interrupt.js';
import { compileScalarExpression } from '../src/scalar-compiler.js';
import { Interpreter, RankError, formatValue, isNativeFunction, parse, type RankValue } from '../src/index.js';

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


describe('scalar-expression catalogue profiles', () => {
    const values = { integer: [7n, 3n], real: [1.25, 0.5], boolean: [true, false] } as const;
    const spelling: Record<string, string> = { atmost: 'at most', atleast: 'at least', notequal: 'not equal' };
    for (const operation of compiledOperators) {
        for (const signature of operation.scalarExpression ?? []) {
            it(`inlines ${operation.name}(${signature.inputs.join(', ')}) without a fallback`, () => {
                const name = spelling[operation.name] ?? operation.name;
                const inner = signature.inputs.length === 1 ? `${name} A` : `A ${name} B`;
                // This compiler deliberately requires at least two operations.
                const expression = `${signature.result === 'boolean' ? 'not' : '+'} (${inner})`;
                const a = values[signature.inputs[0]][0], b = values[signature.inputs[1] ?? signature.inputs[0]][1];
                const statement = parse(`fun calc A B\nreturn ${expression}\nend`).statements[0];
                if (!isFunctionStatement(statement)) throw new Error('expected function');
                const returned = statement.statements[0];
                if (!isReturnStatement(returned) || !returned.value) throw new Error('expected return');
                const fallback = () => { throw new Error('declared overload fell back'); };
                const kernel = compileScalarExpression(returned.value, {
                    leaf: node => isNameExpression(node) ? () => node.name === 'A' ? a : b : undefined,
                    binary: fallback, unary: fallback,
                });
                const reference = evaluate(expression, a, b, false);
                expect(reference).not.toHaveProperty('error');
                expect(kernel).toBeDefined();
                expect(kernel!()).toEqual(reference.value);
            });
        }
    }
    it.each(['+(A / B)', '+(A ** B)', 'not (A and B)', 'not (A or B)', 'not (A xor B)'])(
        'retains the unsupported operator boundary for %s', expression => {
            const boolean = expression.startsWith('not');
            const a = boolean ? true : 7n, b = boolean ? false : 3n;
            const reference = evaluate(expression, a, b, false);
            const compiled = evaluate(expression, a, b, true);
            expect(compiled).toEqual(reference);
            expect(compiled.entries).toBe(0);
        });
});


describe('resumable expression fallback', () => {
    function run(source: string, scalarCompilation: boolean) {
        let entries = 0;
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), {
            scalarCompilation, scalarEntryCompilation: false, scalarFunctionCompilation: false,
            integerLoopCompilation: false, tensorFusion: false, blockCompilation: false,
            onScalarExecuted: () => entries++,
        });
        try {
            return { value: formatValue(runtime.execute(source)!), output, entries };
        } catch (error) {
            return { error: error instanceof RankError ? error.format() : String(error), output, entries };
        } finally { runtime.dispose(); }
    }

    it.each([
        `use io
Count = 0
fun tap X
  Count += 1
  Count print
  return X
end
Result = (2 tap) * 3 + (4 tap) * 5
array Result Count`,
        `use io
fun later X
  X print
  return X
end
(1 // 0) * 2 + (3 later) * 4`,
        `use io
fun forbidden X
  X print
  return true
end
not ((true or (1 forbidden)) equal true)`,
    ])('preserves execution and effects in %s', source => {
        const reference = run(source, false), compiled = run(source, true);
        expect({ ...compiled, entries: 0 }).toEqual({ ...reference, entries: 0 });
        expect(compiled.entries).toBeGreaterThan(0);
    });
});


it('keeps resumed child calls visible when inspection starts after preparation', () => {
    let entries = 0;
    const runtime = new Interpreter(undefined, {
        scalarEntryCompilation: false, scalarFunctionCompilation: false, blockCompilation: false,
        onScalarExecuted: () => entries++,
    });
    try {
        runtime.execute(`fun tap X
  return X
end
fun calc X
  return (X tap) * 2 + 1
end`);
        const calc = runtime.variables.get('calc');
        if (!calc || !isNativeFunction(calc)) throw new Error('missing calc');
        expect(calc.call([2n])).toBe(5n);
        expect(entries).toBeGreaterThan(0);
        const before = entries;
        expect(withInterrupt(new Int32Array(new SharedArrayBuffer(12)), () => calc.call([3n]), () => {})).toBe(7n);
        expect(entries).toBe(before);
    } finally { runtime.dispose(); }
});
