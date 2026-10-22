import { describe, expect, it } from 'vitest';
import { analyzeBindings, analyzeValues } from '@arrrank/language';
import { Interpreter, isRankArray, isRankRecord, isRankTuple, parse, typeName } from '../src/index.js';

// Exercise both analysis APIs against actual values, rather than agreeing on
// an expected static label that could itself be wrong.
describe.each([false, true])('selection and contraction facts (compilation=%s)', compilation => {
    it('completes unpacked values, record fields and inserted collection values', () => {
        const source = `use algo
Recipe' = 1 to 3
Pair' = tuple Recipe 7
unpack Picked # = Pair
Object' = record
 .items = Recipe
end
Stored = record
 .items = array 0
end
Stored .items = Recipe
Queue = new queue
Queue push Recipe
Lookup = new index
Lookup "x" = Recipe`;
        const analysis = analyzeValues(parse(source));
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(source);
            expect(analysis.diagnostics.map(diagnostic => diagnostic.message)).toEqual([]);
            expect(analysis.bindings.get('Picked')?.types).toEqual([typeName(runtime.variables.get('Picked')!)]);
            expect(analysis.bindings.get('Picked')?.types).toEqual(['array']);
            expect(analysis.bindings.get('Object')?.fields?.items.types).toEqual(['array']);
            expect(typeName(runtime.execute('Object .items')!)).toBe('array');
            expect(analysis.bindings.get('Stored')?.fields?.items.types).toEqual(['array']);
            expect(typeName(runtime.execute('Stored .items')!)).toBe('array');
            expect(analysis.bindings.get('Queue')?.elements).toEqual(['array']);
            expect(typeName(runtime.execute('Queue 0')!)).toBe('array');
            expect(analysis.bindings.get('Lookup')?.types).toEqual(['index']);
            expect(typeName(runtime.execute('Lookup "x"')!)).toBe('array');
        } finally { runtime.dispose(); }
    });

    it('completes a sequence yielded to an ordinary for binding', () => {
        const source = `fun rows
 yield 1 to 3
end
fun first_row
 for Row in rows
  return Row
 end
 return array 0
end
Ready' = first_row`;
        const analysis = analyzeValues(parse(source));
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(source);
            expect(analysis.diagnostics.map(diagnostic => diagnostic.message)).toEqual([]);
            expect(analysis.bindings.get('Ready')?.types).toEqual([typeName(runtime.variables.get('Ready')!)]);
            expect(analysis.bindings.get('Ready')?.types).toEqual(['array']);
        } finally { runtime.dispose(); }
    });

    it('uses parameter modes before inferring the result of an identity call', () => {
        const source = `fun X identity = X
fun X' deferred = X
fun X' nested = X identity
Recipe' = 1 to 3
Ready' = Recipe identity
NestedReady' = Recipe nested
StillDeferred' = Recipe deferred`;
        const analysis = analyzeValues(parse(source));
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(source);
            expect(analysis.diagnostics).toEqual([]);
            for (const name of ['Ready', 'NestedReady', 'StillDeferred']) {
                expect(analysis.bindings.get(name)?.types).toEqual([typeName(runtime.variables.get(name)!)]);
            }
            expect(analysis.bindings.get('Ready')?.types).toEqual(['array']);
            expect(analysis.bindings.get('StillDeferred')?.types).toEqual(['sequence']);
        } finally { runtime.dispose(); }
    });

    it('completes plans nested in tuple positions and record fields', () => {
        const source = `Recipe' = 1 to 3
Nested' = tuple Recipe 7
Ready = Nested
Object = record
 .items = Recipe
end`;
        const analysis = analyzeValues(parse(source));
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(source);
            expect(analysis.diagnostics).toEqual([]);
            const tuple = runtime.variables.get('Ready')!;
            const record = runtime.variables.get('Object')!;
            if (!isRankTuple(tuple) || !isRankRecord(record)) throw new Error('expected completed structures');
            expect(analysis.bindings.get('Ready')?.tupleItems?.[0].types).toEqual([typeName(tuple.items[0])]);
            expect(analysis.bindings.get('Object')?.fields?.items.types).toEqual([typeName(record.entries.get('items')!)]);
            expect(typeName(tuple.items[0])).toBe('array');
            expect(typeName(record.entries.get('items')!)).toBe('array');
        } finally { runtime.dispose(); }
    });

    it('does not invent a tensor rank when a completed stream has unknown cell shapes', () => {
        const source = `fun items
 yield array 1 2
end
Saved = items`;
        const analysis = analyzeValues(parse(source));
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(source);
            expect(analysis.bindings.get('Saved')?.types).toEqual(['array']);
            expect(analysis.bindings.get('Saved')?.rank).toBeUndefined();
            expect(runtime.variables.get('Saved')).toMatchObject({ kind: 'array', shape: [1, 2] });
        } finally { runtime.dispose(); }
    });

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
