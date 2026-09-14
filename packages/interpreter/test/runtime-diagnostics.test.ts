import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { currentDiagnostics } from '../src/diagnostics.js';
import { derivedArray, ownedArray } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';

describe('runtime diagnostics and stable tensor reads', () => {
    it('counts lazy work without forcing cells and restores nested scopes', () => {
        const stats = new RuntimeDiagnostics();
        const source = ownedArray([2n]);
        const result = stats.run(() => derivedArray([1], [source], i => source.items[i]));
        expect(stats.cellsComputed).toBe(0);
        expect(result.itemAt!(0)).toBe(2n);
        expect(result.itemAt!(0)).toBe(2n);
        expect(stats.cacheHits).toBe(1);
        expect(stats.cellsComputed).toBe(1);
        expect(stats.dependencyValidations).toBe(1);
        source.items[0] = 3n;
        expect(stats.invalidations).toBe(0);
        expect(result.itemAt!(0)).toBe(3n);
        expect(stats.invalidations).toBe(1);
        expect(stats.cellsComputed).toBe(2);
        stats.run(() => {
            expect(() => new RuntimeDiagnostics().run(() => { throw Error('stop'); })).toThrow('stop');
            expect(currentDiagnostics()).toBe(stats);
        });
        expect(currentDiagnostics()).toBeUndefined();
    });

    it.each([true, false])('reads a cached tensor with hoisting %s', tensorReadHoisting => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { tensorReadHoisting });
        try {
            stats.run(() => runtime.execute(`A = array 1 2 3
B = A * 2`));
            (runtime.variables.get('B') as RankArray).items;
            const before = stats.validationRequests;
            expect(stats.run(() => runtime.execute(`Total = 0
for I in 0 until 100
  Total += B 0
end
Total`))).toBe(200n);
            expect(stats.compiledLoops).toBe(1);
            expect(stats.hoistedReaders).toBe(tensorReadHoisting ? 1 : 0);
            if (tensorReadHoisting) expect(stats.validationRequests - before).toBeLessThan(10);
            else expect(stats.validationRequests - before).toBeGreaterThanOrEqual(100);
            runtime.execute('A 0 = 7');
            // An invalidated cache is not materialized speculatively at loop entry.
            expect(stats.run(() => runtime.execute(`Total = 0
for I in 0 until 2
  Total += B 0
end
Total`))).toBe(28n);
            expect(stats.fallbacks['loop:storage-or-cell-type']).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('retains checks when writes through an alias affect the cached tensor', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            stats.run(() => runtime.execute(`A = array 1
Alias = A
B = A * 2`));
            (runtime.variables.get('B') as RankArray).items;
            expect(stats.run(() => runtime.execute(`Total = 0
for I in 1 to 3
  Alias 0 = I
  Total += B 0
end
Total`))).toBe(12n);
            expect(stats.compiledLoops).toBe(1);
            expect(stats.hoistedReaders).toBe(0);
            expect(stats.invalidations).toBe(3);
        } finally { runtime.dispose(); }
    });

    it('does not hoist across calls even when a callee currently looks harmless', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            stats.run(() => runtime.execute(`fun twice N
  return N * 2
end
A = array 2
B = A * 3`));
            (runtime.variables.get('B') as RankArray).items;
            expect(stats.run(() => runtime.execute(`Total = 0
for I in 1 to 3
  Total += B 0 + (I twice)
end
Total`))).toBe(30n);
            expect(stats.compiledLoops).toBe(1);
            expect(stats.hoistedReaders).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('never caches untracked host reads and records unsupported loops separately', () => {
        const stats = new RuntimeDiagnostics();
        const source: RankArray = { kind: 'array', shape: [1], items: [1n] };
        const result = stats.run(() => derivedArray([1], [source], i => source.items[i]));
        expect(result.itemAt!(0)).toBe(1n);
        source.items[0] = 9n;
        expect(result.itemAt!(0)).toBe(9n);
        expect(stats.cacheHits).toBe(0);
        const runtime = new Interpreter(() => {});
        try {
            stats.run(() => runtime.execute(`use io
for I in 1 to 2
  I print
end`));
            expect(stats.fallbacks['loop:unsupported']).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });
});
