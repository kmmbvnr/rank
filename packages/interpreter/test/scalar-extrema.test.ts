import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction, type RankValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';

function call(body: string, args: RankValue[], compilation: boolean) {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute(`fun X probe Y\n${body}\nend`);
        const fn = runtime.variables.get('probe');
        if (!fn || !isNativeFunction(fn)) throw new Error('expected probe');
        return { value: fn.call(args), calls };
    } finally { runtime.dispose(); }
}

describe('shared scalar extrema', () => {
    it.each(['min', 'max'])('compiles exact and real scalar %s with first-operand tie semantics', name => {
        const pairs: [RankValue, RankValue][] = [
            [2n ** 100n + 1n, 2n ** 100n], [-7n, -3n], [4n, 4n],
            [1.5, 2.5], [-0, 0], [0, -0], [NaN, 1], [1, NaN], [Infinity, -Infinity],
        ];
        for (const args of pairs) {
            const source = name === 'max' ? 'return X max Y' : 'return X min Y';
            const reference = call(source, args, false), compiled = call(source, args, true);
            expect(Object.is(compiled.value, reference.value)).toBe(true);
            expect(compiled.calls).toBe(1);
        }
        for (const value of [2n ** 100n, -0, NaN]) {
            const source = `return X ${name}`;
            expect(call(source, [value, value], true)).toEqual({ ...call(source, [value, value], false), calls: 1 });
        }
    });

    it('compiles ungrouped cell operands and preserves argument-selection errors', () => {
        const array: RankValue = { kind: 'array', shape: [2], items: [3n, 7n] };
        expect(call('return X 0 max Y', [array, 5n], true)).toEqual({ value: 5n, calls: 1 });
        const errors = [false, true].map(compilation => {
            try { call('return X 2 max Y', [array, 5n], compilation); return undefined; }
            catch (error) { return (error as Error).message; }
        });
        expect(errors[0]).toContain('array index out of bounds');
        expect(errors[1]).toBe(errors[0]);
    });

    it('preserves chains and keeps mixed or collection inputs on the reference path', () => {
        const source = 'return (X max Y) min 10';
        expect(call(source, [4n, 20n], true)).toEqual({ value: 10n, calls: 1 });
        for (const args of [[2n ** 60n + 1n, 2 ** 60], [2n, 0.5], ['a', 'b']] as RankValue[][]) {
            expect(call('return X max Y', args, true)).toEqual(call('return X max Y', args, false));
        }
        const array: RankValue = { kind: 'array', shape: [2], items: [3n, 7n] };
        expect(call('return X min', [array, 0n], true)).toEqual(call('return X min', [array, 0n], false));
    });

    it('evaluates both operands once, in source order, including errors', () => {
        const source = `use algo
fun X probe Y
  return ((X pop) * 10) max (Y pop)
end
Items = new stack
Items push 2
Items push 7
Result = 0
for I in 1 to 1
  Result = Items probe Items
end
array Result (Items len)`;
        for (const compilation of [false, true]) {
            let calls = 0;
            const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
            try {
                const result = runtime.execute(source);
                expect(result).toMatchObject({ shape: [2], items: [70n, 0n] });
                if (compilation) expect(calls).toBe(1);
            } finally { runtime.dispose(); }
        }
        for (const compilation of [false, true]) {
            expect(() => call('return (X // 0) max (Y // 0)', [1n, 2n], compilation)).toThrow('division by zero');
        }
    });

    it('rechecks builtin identity after a function has compiled', () => {
        for (const compilation of [false, true]) {
            let calls = 0;
            const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
            try {
                runtime.execute(`fun X probe Y
  return X max Y
end`);
                expect(runtime.execute('2 probe 3')).toBe(3n);
                if (compilation) expect(calls).toBe(1);
                runtime.variables.set('max', native('replacement', 2, ([a, b]) => (a as bigint) + (b as bigint)));
                expect(runtime.execute('2 probe 3')).toBe(5n);
            } finally { runtime.dispose(); }
        }
    });

    it('compiles the unchanged Euler 320 factor walk and preserves the official sample', () => {
        const source = readFileSync(new URL('../../../demos/euler/320_factorials.ra', import.meta.url), 'utf8')
            .replace('option Upper integer = 1000000', 'option Upper integer = 1000');
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            const diagnostics = new RuntimeDiagnostics();
            try {
                diagnostics.run(() => runtime.execute(source));
                expect(runtime.variables.get('Answer')).toBe(614538266565663n);
                if (compilation) {
                    // One sieve region and one factor walk, rather than thousands
                    // of separately entered short loops and interpreted calls.
                    expect(diagnostics.compiledLoops).toBe(2);
                    expect(diagnostics.fallbacks['scalar-function:unsupported-op:max']).toBeUndefined();
                    expect(diagnostics.typedUnpacks).toBe(0);
                }
            } finally { runtime.dispose(); }
        }
    });
});
