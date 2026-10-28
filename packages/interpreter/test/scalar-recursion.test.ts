import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, isNativeFunction, withDemandBudget, DemandBudgetExhausted, type InterpreterOptions } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { semanticArrayType, setSemanticArrayType } from '../src/semantic-array-type.js';
import { scalarFunctionResult } from '../src/scalar-function-proof.js';
import { parse } from '../src/parser.js';
import { protectValue } from '../src/value-protection.js';
import { isFunctionStatement } from '@arrrank/language';

function compare(source: string, expressions: string[], options: InterpreterOptions = {}) {
    const runs = [false, true].map(compilation => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { ...options, compilation, onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(source);
            const values = expressions.map(expression => {
                try { return { value: formatValue(runtime.execute(expression)!) }; }
                catch (error) { return { error: error instanceof RankError ? error.format() : String(error) }; }
            });
            return { values, calls };
        } finally { runtime.dispose(); }
    });
    expect(runs[1].values).toEqual(runs[0].values);
    expect(runs[0].calls).toBe(0);
    return runs[1];
}

const fibonacci = `use algo
fun N helper Cache
  if N at most 1
    return N
  end
  if N in Cache
    return Cache N
  end
  Value = ((N - 1) helper Cache) + ((N - 2) helper Cache)
  Cache N = Value
  return Value
end
Cache = new index`;

describe('compiled numeric self recursion', () => {
    it('publishes exact results through the shared index and reuses entries', () => {
        const run = compare(fibonacci, ['100 helper Cache', 'Cache 100', '100 helper Cache', '0 helper Cache']);
        expect(run.values[0]).toEqual({ value: '354224848179261915075' });
        expect(run.values[1]).toEqual(run.values[0]);
        expect(run.values[2]).toEqual(run.values[0]);
        expect(run.calls).toBeGreaterThan(100);
    });

    it('preserves arbitrary precision without a memo container', () => {
        const run = compare(`fun N helper
  if N at most 1
    return 1
  end
  return N * ((N - 1) helper)
end`, ['30 helper', '2 helper']);
        expect(run.values[0]).toEqual({ value: '265252859812191058636308480000000' });
        expect(run.calls).toBe(32);
    });

    it.each([1, 3, 20])('preserves non-tail recursion limits and recovery at depth %s', maxCallDepth => {
        compare(fibonacci, ['0 helper Cache', '15 helper Cache', '0 helper Cache'], { maxCallDepth });
    });

    it('rechecks index domains after public mutation and recovery', () => {
        const run = compare(`use algo
fun K helper Cache
  return Cache K + 1
end
Cache = new index`, ['Cache 0 = 2', '0 helper Cache', 'Cache 0 = 1.5', '0 helper Cache',
            'Cache 0 = 4', '0 helper Cache']);
        expect(run.values[1]).toEqual({ value: '3' });
        expect(run.values[3]).toHaveProperty('error');
        expect(run.values[5]).toEqual({ value: '5' });
        expect(run.calls).toBe(2);
    });

    it('keeps protected index writes ahead of key and value evaluation', () => {
        const results = [false, true].map(compilation => {
            let calls = 0;
            const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
            try {
                runtime.execute(`use algo
fun N helper Cache
 Cache (10 // N) = 1 // N
 return N
end
Cache = new index`);
                protectValue(runtime.variables.get('Cache')!, 'protected memo');
                let result: string | undefined;
                try { runtime.execute('0 helper Cache'); }
                catch (error) { result = error instanceof RankError ? error.format() : String(error); }
                expect(result).toContain('protected memo');
                expect(calls).toBe(0);
                return result;
            } finally { runtime.dispose(); }
        });
        expect(results[1]).toBe(results[0]);
    });

    it('retains recursive array selection errors and complete call arguments', () => {
        const run = compare(`fun N helper A
  if N equal 0
    return A 2
  end
  return ((N - 1) helper A) + 1
end
A = array 10 20`, ['3 helper A', '0 helper A']);
        expect(run.values[0]).toHaveProperty('error', expect.stringContaining('out of bounds'));
        expect(run.calls).toBe(5);
    });

    it('rejects a changed self-call domain and array-writing recursion', () => {
        for (const source of [`fun N helper
 if N at most 1
  return N
 end
 return (N / 2) helper
end`, `fun N helper A
 if N equal 0
  return A 0
 end
 A 0 = N
 return ((N - 1) helper A) + 1
end`]) {
            const fn = parse(source).statements.find(isFunctionStatement)!;
            const types = fn.parameters.length === 1 ? ['integer' as const]
                : ['integer' as const, { kind: 'array' as const, element: 'integer' as const, rank: 1 }];
            expect(scalarFunctionResult(fn, true, types, true)).toBeUndefined();
        }
    });

    it('guards the recursive callee identity between entry calls', () => {
        const results = [false, true].map(compilation => {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(`fun N helper
 if N equal 0
  return 0
 end
 return ((N - 1) helper) + 1
end
saved = helper
fun N replacement
 return 10
end`);
                expect(runtime.execute('3 saved')).toBe(3n);
                runtime.variables.set('helper', runtime.variables.get('replacement')!);
                return runtime.execute('3 saved');
            } finally { runtime.dispose(); }
        });
        expect(results[1]).toBe(results[0]);
        expect(results[1]).toBe(11n);
    });

    it('polls self tail transfers and restores depth after budget exhaustion', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { maxCallDepth: 1, onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(`fun N helper Total
 if N equal 0
  return Total
 end
 return (N - 1) helper (Total + 1)
end`);
            const helper = runtime.variables.get('helper')!;
            if (!isNativeFunction(helper)) throw new Error('missing helper');
            expect(() => withDemandBudget(200, () => helper.call([10000n, 0n]))).toThrow(DemandBudgetExhausted);
            expect(calls).toBeGreaterThan(0);
            expect(helper.call([10n, 0n])).toBe(10n);
        } finally { runtime.dispose(); }
    });

    it('keeps unresolved array contracts while specializing checked stored domains', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(`fun A helper
 return A 0 equal 1
end`);
            const integer = setSemanticArrayType(ownedArray([1n], [1]), { key: 'unresolved' });
            const real = setSemanticArrayType(ownedArray([1], [1]), { key: 'unresolved' });
            runtime.variables.set('A', integer);
            runtime.variables.set('B', real);
            for (const expression of ['A helper', 'B helper', 'A helper', 'B helper']) {
                expect(runtime.execute(expression)).toBe(true);
            }
            expect(calls).toBe(4);
            expect(semanticArrayType(integer).key).toBe('unresolved');
            expect(semanticArrayType(real).key).toBe('unresolved');
        } finally { runtime.dispose(); }
    });

    it('retains an unresolved array return contract across stored domains', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute('fun A helper\n return A 0\nend');
            runtime.variables.set('A', setSemanticArrayType(ownedArray([1n], [1]), { key: 'unresolved' }));
            runtime.variables.set('B', setSemanticArrayType(ownedArray([1], [1]), { key: 'unresolved' }));
            expect(runtime.execute('A helper')).toBe(1n);
            expect(() => runtime.execute('B helper')).toThrow('returns integer');
        } finally { runtime.dispose(); }
    });

    it('runs the unmodified orchard recurrence against an independent sieve', () => {
        const source = readFileSync(new URL('../../../demos/euler/351_orchards.ra', import.meta.url), 'utf8');
        const phi = Array.from({ length: 10001 }, (_, i) => i);
        for (let p = 2; p < phi.length; p++) if (phi[p] === p) for (let v = p; v < phi.length; v += p) phi[v] -= phi[v] / p;
        for (let i = 1; i < phi.length; i++) phi[i] += phi[i - 1];
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(source.replace('arg Limit integer = 10 ** 8', 'Limit = 1'));
                for (const n of [0, 1, 2, 5, 10, 25, 100, 1000, 10000]) {
                    expect(runtime.execute(`${n} hidden`)).toBe(6n * (BigInt(n) * BigInt(n + 1) / 2n - BigInt(phi[n])));
                }
            } finally { runtime.dispose(); }
        }
    });
});
