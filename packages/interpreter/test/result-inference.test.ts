import { describe, expect, it } from 'vitest';
import { analyzeBindings, analyzeValues } from '@arrrank/language';
import { Interpreter, isRankArray, parse, typeName } from '../src/index.js';

// Exercise both analysis APIs against actual values, rather than agreeing on
// an expected static label that could itself be wrong.
describe.each([false, true])('selection and contraction facts (compilation=%s)', compilation => {
    it.each([
        'N = array 1 2 3\nPicked = N (array true false)',
        'N = array 1 2 3\nPicked = N (array 0 true)',
        'N = array shape 0 3 fill 1\nPicked = N (N greater 0)',
    ])('preserves invalid selector errors: %s', program => {
        const runtime = new Interpreter(undefined, { compilation });
        try { expect(() => runtime.execute(program)).toThrow(); }
        finally { runtime.dispose(); }
    });
    it.each([
        'N = 1 to 20 array\nMask = N mod 3 equal 0\nPicked = N Mask',
        'N = array 1 2 3 4 shape 2 2\nMask = N greater 2\nPicked = N Mask',
        'N = array 1 2 3\nMask = N greater 9\nPicked = N Mask',
        'N = array shape 0 fill 1\nMask = N greater 0\nPicked = N Mask',
        'N = array 1 2 3 4 shape 2 2\nPicked = N (array 1 0)',
        'N = 1 to 3\nMask = (array 1 2 3) greater 1\nPicked = N Mask',
        'N = 1 till 1\nMask = (array shape 0 fill 1) greater 1\nPicked = N Mask',
        'N = array 1 2 3\nMask = N in (array 2 3)\nPicked = N Mask',
        'Top = array 3 2 1\nWeight = array 100 10 1\nAnswer = Top Weight matmul',
        'L = array 1.0 2.0\nR = array 3.0 4.0\nAnswer = L R matmul',
        'L = array shape 0 fill 1.0\nR = array shape 0 fill 1.0\nAnswer = L R matmul',
        'M = array 1 2 3 4 shape 2 2\nV = array 2 3\nAnswer = M V matmul',
        'M = array 1 2 3 4 shape 2 2\nV = array 2 3\nAnswer = V M matmul',
        'M = array 1 2 3 4 shape 2 2\nAnswer = M M matmul',
        'M = array 1 2 3 4 shape 2 2\nAnswer = M M matmul rank 1 1',
        'M = array 1 2 3 4 shape 2 2\nAnswer = M M matmul axis 0 1',
    ])('agrees with runtime: %s', program => {
        const source = `use sequences\nuse linalg\n${program}`;
        const ast = parse(source);
        const facts = analyzeValues(ast);
        const bindings = analyzeBindings(ast);
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(source);
            expect(facts.diagnostics).toEqual([]);
            for (const [name, fact] of facts.bindings) {
                const value = runtime.variables.get(name);
                if (value === undefined) continue;
                if (fact.types.length) expect(fact.types, name).toContain(typeName(value));
                if (isRankArray(value)) {
                    if (fact.rank !== undefined) expect(fact.rank, name).toBe(value.shape.length);
                    fact.shape?.forEach((size, axis) => {
                        if (size !== null) expect(size, name).toBe(value.shape[axis]);
                    });
                } else if (typeName(value) === 'sequence' && fact.rank !== undefined) {
                    expect(fact.rank, name).toBe(1);
                }
            }
            for (const binding of bindings.scopes.find(scope => scope.kind === 'program')!.bindings) {
                const value = runtime.variables.get(binding.name);
                if (value !== undefined && binding.types.length) {
                    expect(binding.types, binding.name).toContain(typeName(value));
                }
            }
        } finally { runtime.dispose(); }
    });
});
