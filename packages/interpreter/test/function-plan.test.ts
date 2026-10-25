import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isFunctionStatement } from '@arrrank/language';
import { Interpreter, RankError, formatValue, isRankPlan, isNativeFunction, parse } from '../src/index.js';
import { scalarFunctionResult } from '../src/scalar-function-proof.js';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';
import { arrayForWrite, ownedArray, writeArrayCell } from '../src/array-storage.js';

const helpers = `fun Input transform
 Scaled' = Input * 2
 Shifted' = Scaled + 1
 return Shifted sum
end
fun Input consume
 Result = Input transform
 return Result
end`;

function evaluate(source: string, compilation: boolean) {
    let calls = 0;
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { compilation,
        onScalarFunctionExecuted: () => calls++ });
    try {
        return { value: formatValue(runtime.execute(source)!), output, calls };
    } catch (error) { return { error: error instanceof RankError ? error.format() : String(error), output, calls }; }
    finally { runtime.dispose(); }
}

describe('function-local plan lowering', () => {
    it('represents stages separately and emits one loop at their sum consumer', () => {
        const fn = parse(helpers).statements[0];
        if (!isFunctionStatement(fn)) throw Error('expected function');
        const proof = scalarFunctionResult(fn, true, [{ kind: 'array', element: 'integer', rank: 1 }], true)!;
        expect(proof.planBindings.size).toBe(2);
        expect(proof.planReturn).toBe(true);
        const kernel = compileScalarFunction(fn, [{ kind: 'array', element: 'integer', rank: 1 }], true)!;
        expect(kernel.source.match(/for \(/g)).toHaveLength(1);
        expect(kernel.source).not.toContain('new Array');
        expect(kernel.source).not.toContain('materializeValue');
    });

    it('bounds expansion when successive stages duplicate their predecessors', () => {
        const stages = Array.from({ length: 30 }, (_, index) => ` S${index + 1}' = S${index} + S${index}`).join('\n');
        const fn = parse(`fun Input huge\n S0' = Input * 2\n${stages}\n return S30 sum\nend`).statements[0];
        if (!isFunctionStatement(fn)) throw Error('expected function');
        expect(scalarFunctionResult(fn, true, [{ kind: 'array', element: 'integer', rank: 1 }], true)).toBeUndefined();
    });

    it.each(['array 1 2 3', 'array shape 0 fill 0', 'array 1.5 2.5'])('compiles the consumer and helper for %s', input => {
        const source = `${helpers}\n(${input}) consume`;
        const reference = evaluate(source, false), compiled = evaluate(source, true);
        expect({ ...compiled, calls: 0 }).toEqual(reference);
        expect(compiled.calls).toBeGreaterThan(0);
    });

    it('preserves compilation through parenthesized consumers', () => {
        const source = helpers.replace('return Shifted sum', 'return (Shifted sum)') + '\n(array 1 2 3) consume';
        expect(evaluate(source, true)).toMatchObject({ value: '15', calls: 2 });
        expect(evaluate(source, false)).toMatchObject({ value: '15' });
    });

    it('preserves ordinary array completion between plan stages', () => {
        const source = `fun Input transform
 Doubled' = Input * 2
 Saved = Doubled
 Shifted' = Saved + 1
 return Shifted sum
end
fun Input consume
 Result = Input transform
 return Result
end
(array 1 2 3) consume`;
        expect(evaluate(source, true)).toMatchObject({ value: '15' });
        expect(evaluate(source, false)).toMatchObject({ value: '15' });
        const fn = parse(source).statements[0];
        if (!isFunctionStatement(fn)) throw Error('expected function');
        const kernel = compileScalarFunction(fn, [{ kind: 'array', element: 'integer', rank: 1 }], true)!;
        expect(kernel.source.match(/for \(/g)).toHaveLength(2);
        expect(kernel.source).toContain('materializeValue');
    });

    it('does not evaluate unused scalar plans', () => {
        const source = 'fun X unused\n Bad\' = X // 0\n return 7\nend\n3 unused';
        expect(evaluate(source, true)).toEqual({ value: '7', calls: 1, output: [] });
        expect(evaluate(source, false)).toMatchObject({ value: '7' });
    });

    it('does not complete a plan for a deferred parameter or metadata-only consumer', () => {
        for (const source of [
            `fun X' ignore
 return 7
end
fun N consume
 Bad' = N // 0
 R = Bad ignore
 return R
end
1 consume`,
            `fun Text length
 Digits' = Text integer rank 0
 Size = Digits len
 return Size
end
"1x" length`,
        ]) expect(evaluate(source, true)).toEqual(evaluate(source, false));
    });

    it('recomputes each separate plan consumer', () => {
        const source = `fun Input total
 Stage' = Input * 2
 First = Stage sum
 Second = Stage sum
 return First + Second
end
(array 1 2 3) total`;
        expect(evaluate(source, true)).toMatchObject({ value: '24', calls: 1 });
        const fn = parse(source).statements[0];
        if (!isFunctionStatement(fn)) throw Error('expected function');
        const kernel = compileScalarFunction(fn, [{ kind: 'array', element: 'integer', rank: 1 }], true)!;
        expect(kernel.source.match(/for \(/g)).toHaveLength(2);
    });

    it('retains captured array storage when an alias writes between consumers', () => {
        for (const scalarFunctionCompilation of [false, true]) {
            let caller = ownedArray([1n, 2n, 3n]), consumers = 0;
            const runtime = new Interpreter(undefined, { scalarFunctionCompilation,
                onTensorKernelExecuted: () => {
                    if (++consumers !== 1) return;
                    caller = arrayForWrite(caller, 0) ?? caller;
                    writeArrayCell(caller, 0, 99n);
                },
            });
            runtime.variables.set('Input', caller);
            try {
                expect(runtime.execute(`fun A total
 Stage' = A * 2
 First = Stage sum
 Second = Stage sum
 return First + Second
end
Input total`)).toBe(24n);
                expect(caller.items[0]).toBe(99n);
                expect(consumers).toBe(2);
            } finally { runtime.dispose(); }
        }
    });

    it.each([false, true])('keeps escaped plans deferred (compilation=%s)', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('fun X delayed\n Bad\' = X // 0\n return Bad\nend\nResult\' = 1 delayed');
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            expect(() => runtime.execute('Result')).toThrowError('division by zero');
            expect(() => runtime.execute('Result')).toThrowError('division by zero');
        } finally { runtime.dispose(); }
    });

    it.each([
        'fun X f\n P = 0\n P\' = X integer rank 0\n return P sum\nend\n"123" f',
        'fun X f\n P\' = X // 0\n Saved = P\n return Saved\nend\n1 f',
    ])('preserves capture, binding and demand errors', source => {
        const reference = evaluate(source, false), compiled = evaluate(source, true);
        expect(reference).toHaveProperty('error');
        expect({ ...compiled, calls: 0 }).toEqual({ ...reference, calls: 0 });
    });

    it('retains captured values when their original scalar binding is reassigned', () => {
        const source = 'fun X f\n P\' = X + 1\n X = 4\n return P\nend\n1 f';
        expect(evaluate(source, true)).toEqual(evaluate(source, false));
        expect(evaluate(source, true)).toMatchObject({ value: '2' });
    });

    it('keeps scalar errors before empty vector traversal', () => {
        const source = 'fun A f\n P\' = A * (1 // 0)\n R = P sum\n return R\nend\n(array shape 0 fill 0) f';
        expect(evaluate(source, true)).toHaveProperty('error');
        expect(evaluate(source, false)).toHaveProperty('error');
    });

    it('matches broadcasting, Unicode conversion errors and exact powers', () => {
        for (const text of ['123', '999', '1x', '😀2', '']) {
            const source = `fun Text powers Power
 Digits' = Text integer rank 0
 Terms' = Digits ** Power
 return Terms sum
end
fun Text consume Power
 Result = Text powers Power
 return Result
end
"${text}" consume 40`;
            const reference = evaluate(source, false), compiled = evaluate(source, true);
            expect({ ...compiled, calls: 0 }).toEqual(reference);
        }
        const source = `fun A total B
 P' = A + B
 R = P sum
 return R
end
(array 1 2 3) total (array 10)`;
        expect(evaluate(source, true)).toMatchObject({ value: '36', calls: 1 });
        expect(evaluate(source, false)).toMatchObject({ value: '36' });
    });

    it('guards variable integer powers before entry and preserves negative exponents', () => {
        for (const power of [0, 5, -1]) {
            const source = `fun X power P\n return X ** P\nend\n9 power ${power}`;
            const reference = evaluate(source, false), compiled = evaluate(source, true);
            expect({ ...compiled, calls: 0 }).toEqual(reference);
            expect(compiled.calls).toBe(power >= 0 ? 1 : 0);
        }
    });

    it('preserves power precedence and the final binding of duplicate parameters', () => {
        for (const expression of ['-X ** P', '(-X) ** P', '+X ** P']) {
            const source = `fun X power P\n return ${expression}\nend\n2 power 4`;
            expect({ ...evaluate(source, true), calls: 0 }).toEqual(evaluate(source, false));
            const planned = `fun X power P\n A' = ${expression}\n R = A\n return R\nend\n2 power 4`;
            expect({ ...evaluate(planned, true), calls: 0 }).toEqual(evaluate(planned, false));
        }
        const source = 'fun P power P\n return 9 ** P\nend\n2 power -1';
        expect(evaluate(source, true)).toEqual(evaluate(source, false));
    });

    it('rechecks converter implementations before entering a prepared caller', () => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(`fun Text helper
 Digits' = Text integer rank 0
 return Digits sum
end
fun Text consume
 R = Text helper
 return R
end`);
            expect(runtime.execute('"123" consume')).toBe(6n);
            expect(calls).toBeGreaterThan(0);
            const before = calls;
            const converter = runtime.execute('integer')!;
            if (!isNativeFunction(converter)) throw Error('expected function');
            Object.defineProperty(converter, 'call', { value: () => 7n });
            expect(runtime.execute('"123" consume')).toBe(21n);
            expect(calls).toBe(before);
        } finally { runtime.dispose(); }
    });

    it('compiles the unchanged full Euler 30 entrypoint', () => {
        const source = readFileSync(new URL('../../../demos/euler/030_digitpowers.ra', import.meta.url), 'utf8');
        expect(evaluate(source, true)).toMatchObject({ output: ['443839'], calls: 354294 });
    });
});
