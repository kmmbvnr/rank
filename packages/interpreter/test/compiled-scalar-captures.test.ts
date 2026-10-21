import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';
import { isFunctionStatement } from '@arrrank/language';
import { parse } from '../src/index.js';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';

function run(source: string, compilation = true) {
    let loops = 0, calls = 0;
    const runtime = new Interpreter(() => {}, { compilation,
        onIntegerLoopExecuted: () => loops++, onScalarFunctionExecuted: () => calls++,
    });
    try {
        let value: string | undefined, error: string | undefined;
        try { const result = runtime.execute(source); if (result !== undefined) value = formatValue(result); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { loops, calls, observation: { value, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]),
        } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const candidate = run(source);
    expect(candidate.observation).toEqual(run(source, false).observation);
    return candidate;
}

describe('guarded scalar captures in compiled functions', () => {
    it('keys shared syntax proofs by captured domains rather than observed values', () => {
        const fn = parse('K = 2\nfun X helper\n return X + K\nend').statements[1];
        if (!isFunctionStatement(fn)) throw new Error('expected function');
        const integers = compileScalarFunction(fn, ['integer'], true, new Map([['K', 'integer']]));
        const reals = compileScalarFunction(fn, ['integer'], true, new Map([['K', 'real']]));
        expect(integers).toBeDefined();
        expect(reals).toBeDefined();
        expect(reals).not.toBe(integers);
        expect(integers!.run([3n], error => error, [], [], [], [], [() => 2n])).toBe(5n);
        expect(integers!.run([3n], error => error, [], [], [], [], [() => 7n])).toBe(10n);
        expect(reals!.run([3n], error => error, [], [], [], [], [() => 0.5])).toBe(3.5);
    });

    it('selects a capture proof after hoisted globals have been initialized', () => {
        const result = compare(`Scale = 3
fun X scaled
 return X * Scale
end
5 scaled`);
        expect(result.observation.value).toBe('15');
        expect(result.calls).toBe(1);
    });

    it('reads current values across calls without retaining the first capture', () => {
        const result = compare(`Scale = 3
fun X scaled
 return X * Scale
end
Before = 5 scaled
Scale = 7
After = 5 scaled
array Before After`);
        expect(result.observation.value).toBe('15 35');
        expect(result.calls).toBe(2);
    });

    it('links a loop against read-only captured domains', () => {
        const result = compare(`Scale = 3
Mod = 7
fun X scaled
 return X * Scale mod Mod
end
Total = 0
for I in 1 to 4
 Total += I scaled
end
Total`);
        expect(result.observation.value).toBe('16');
        expect(result.loops).toBe(1);
        expect(result.calls).toBe(4);
    });

    it('keeps a caller that writes a capture outside the linked region', () => {
        const result = compare(`Scale = 3
fun X scaled
 return X * Scale
end
Total = 0
for I in 1 to 3
 Total += I scaled
 Scale += 1
end
Total`);
        expect(result.observation.value).toBe('26');
        expect(result.loops).toBe(0);
    });

    it.each([['1.5', 'X * Factor', '3'], ['true', 'Flag and X greater 0', 'true'],
        ['"prefix"', 'Prefix + (X text)', 'prefix2']])('keeps the scalar capture domain %s', (value, expression, expected) => {
        const name = expression.startsWith('X *') ? 'Factor' : expression.startsWith('Flag') ? 'Flag' : 'Prefix';
        const result = compare(`${name} = ${value}\nfun X helper\n return ${expression}\nend\n2 helper`);
        expect(result.observation.value).toBe(expected);
        expect(result.calls).toBe(1);
    });

    it('uses each enclosing invocation to resolve captured parameters', () => {
        const result = compare(`fun Offset outer
 fun X shifted
  return X + Offset
 end
 Total = 0
 for I in 1 to 2
  Total += I shifted
 end
 return Total
end
array (10 outer) (20 outer)`);
        expect(result.observation.value).toBe('23 43');
        expect(result.calls).toBeGreaterThan(0);
    });

    it('keeps zero and missing-name errors in their source evaluation order', () => {
        const result = compare(`Divisor = 0
fun X quotient
 return X // Divisor
end
for I in 1 to 2
 Before = I
 Result = I quotient
end`);
        expect(result.observation.error).toContain('division by zero');
        expect(result.calls).toBe(1);
        expect(compare('fun X helper\n return true or Missing\nend\n1 helper').observation.value).toBe('true');
    });

    it('revalidates host-replaced scalar domains before entering cached calls', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute('Scale = 2\nfun X scaled\n return X * Scale\nend');
            expect(runtime.execute('3 scaled')).toBe(6n);
            runtime.variables.set('Scale', 1.5);
            // Ordinary return contracts still decide whether the result domain may change.
            const reference = new Interpreter(() => {}, { compilation: false });
            try {
                reference.execute('Scale = 2\nfun X scaled\n return X * Scale\nend\n3 scaled');
                reference.variables.set('Scale', 1.5);
                const observe = (r: Interpreter) => {
                    try { return { value: r.execute('3 scaled') }; }
                    catch (error) { return { error: error instanceof RankError ? error.format() : String(error) }; }
                };
                expect(observe(runtime)).toEqual(observe(reference));
            } finally { reference.dispose(); }
        } finally { runtime.dispose(); }
    });

    it('declines scalar capture kernels when custom host polling can mutate bindings', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => calls++ });
        try {
            const source = 'Scale = 3\nfun X scaled\n return X * Scale\nend\n5 scaled';
            const signal = { length: 1, load: () => 0, store: () => {}, exchange: () => 0, wait: () => {} };
            expect(withInterrupt(signal, () => runtime.execute(source))).toBe(15n);
            expect(calls).toBe(0);
        } finally { runtime.dispose(); }
    });
});
