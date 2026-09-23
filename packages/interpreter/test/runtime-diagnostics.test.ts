import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics } from '../src/index.js';
import { currentDiagnostics } from '../src/diagnostics.js';
import { createArraySnapshot, derivedArray, noteArrayBinding, ownedArray } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';

describe('runtime diagnostics and stable tensor reads', () => {
    it('counts only copy-on-write copies and their cells', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            stats.run(() => runtime.execute('A = array 1 2 3\nA 0 = 9'));
            expect([stats.cowCopies, stats.cowCopiedCells]).toEqual([0, 0]);
            stats.run(() => runtime.execute('B = A\nB 1 = 8'));
            expect([stats.cowCopies, stats.cowCopiedCells]).toEqual([1, 3]);
            stats.run(() => runtime.execute('B 2 = 7'));
            expect([stats.cowCopies, stats.cowCopiedCells]).toEqual([1, 3]);
        } finally { runtime.dispose(); }
    });

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
            // Naming B freezes A against Rank writes, so the invalidation this
            // test is about comes through storage the embedding still owns.
            const source = createArraySnapshot([1n, 2n, 3n]);
            runtime.variables.set('A', source);
            stats.run(() => runtime.execute('B = A * 2'));
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
            source.items[0] = 7n;
            // An invalidated cache is not materialized speculatively at loop entry.
            expect(stats.run(() => runtime.execute(`Total = 0
for I in 0 until 2
  Total += B 0
end
Total`))).toBe(28n);
            expect(stats.fallbacks['loop:storage-or-cell-type']).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('reuses an element-type guard only while owned storage has the same revision', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            runtime.execute('fun read_one A\n for I in 0 until 1\n  return A I\n end\n return 0\nend');
            const read = runtime.variables.get('read_one');
            const array = createArraySnapshot([7n, 8n, 9n]);
            if (!read || typeof read !== 'object' || !('call' in read)) throw new Error('read_one');
            expect(stats.run(() => read.call([array]))).toBe(7n);
            expect(stats.loopElementScans).toBe(1);
            expect(stats.run(() => read.call([array]))).toBe(7n);
            expect(stats.loopElementScans).toBe(1);
            array.items[0] = 11n;
            expect(stats.run(() => read.call([array]))).toBe(11n);
            expect(stats.loopElementScans).toBe(2);
            array.items[0] = 'changed';
            expect(stats.run(() => read.call([array]))).toBe('changed');
            expect(stats.loopElementScans).toBe(3);
            expect(stats.compiledLoops).toBe(3);
        } finally { runtime.dispose(); }
    });

    it('keeps host-owned arrays with no tracked revision on the interpreted path', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            runtime.execute('fun read_one A\n for I in 0 until 1\n  return A I\n end\n return 0\nend');
            const read = runtime.variables.get('read_one');
            const array: RankArray = { kind: 'array', shape: [2], items: [7n, 8n] };
            if (!read || typeof read !== 'object' || !('call' in read)) throw new Error('read_one');
            expect(stats.run(() => read.call([array]))).toBe(7n);
            expect(stats.run(() => read.call([array]))).toBe(7n);
            expect(stats.loopElementScans).toBe(0);
            array.items[0] = 'changed';
            expect(stats.run(() => read.call([array]))).toBe('changed');
            expect(stats.loopElementScans).toBe(0);
            expect(stats.compiledLoops).toBe(0);
            expect(stats.fallbacks['loop:storage-or-cell-type']).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it.each([true, false])('does not inspect an unread host cell with compilation %s', integerLoopCompilation => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation });
        try {
            runtime.execute('fun read_one A\n for I in 0 until 1\n  return A I\n end\n return 0\nend');
            const read = runtime.variables.get('read_one');
            if (!read || typeof read !== 'object' || !('call' in read)) throw new Error('read_one');
            const items = new Proxy([7n, 8n], {
                get(target, key, receiver) {
                    if (key === '1') throw new Error('unread cell');
                    return Reflect.get(target, key, receiver);
                },
            });
            const array: RankArray = { kind: 'array', shape: [2], items };
            expect(read.call([array])).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it.each([true, false])('does not inspect an empty host iteration source with compilation %s', integerLoopCompilation => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation });
        try {
            runtime.execute('fun consume Source\n for Value in Source\n  return Value\n end\n return 0\nend');
            const consume = runtime.variables.get('consume');
            if (!consume || typeof consume !== 'object' || !('call' in consume)) throw new Error('consume');
            const items = new Proxy([] as bigint[], {
                get(target, key, receiver) {
                    if (key === '0') throw new Error('unread cell');
                    return Reflect.get(target, key, receiver);
                },
            });
            const array: RankArray = { kind: 'array', shape: [0], items };
            expect(consume.call([array])).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it.each(['0 until N', '2 to 1', '0 to 1 by -1'])('does not copy a shared destination for empty range %s', range => {
        for (const integerLoopCompilation of [false, true]) {
            const stats = new RuntimeDiagnostics();
            const runtime = new Interpreter(undefined, { integerLoopCompilation });
            try {
                runtime.execute(`fun alter A N\n for I in ${range}\n  A 0 = I\n end\n return A\nend`);
                const alter = runtime.variables.get('alter');
                if (!alter || typeof alter !== 'object' || !('call' in alter)) throw new Error('alter');
                stats.run(() => alter.call([createArraySnapshot([1n, 2n]), 1n]));
                const array = createArraySnapshot([1n, 2n]);
                noteArrayBinding(array);
                const before = stats.cowCopies;
                expect(stats.run(() => alter.call([array, 0n]))).toBe(array);
                expect(stats.cowCopies).toBe(before);
                if (integerLoopCompilation) expect(stats.fallbacks['loop:empty-shared-destination']).toBeGreaterThan(0);
            } finally { runtime.dispose(); }
        }
    });

    it('does not copy a shared destination before a zero range step fails', () => {
        for (const integerLoopCompilation of [false, true]) {
            const stats = new RuntimeDiagnostics();
            const runtime = new Interpreter(undefined, { integerLoopCompilation });
            try {
                runtime.execute('fun alter A\n for I in 0 until 1 by 0\n  A 0 = I\n end\n return A\nend');
                const alter = runtime.variables.get('alter');
                if (!alter || typeof alter !== 'object' || !('call' in alter)) throw new Error('alter');
                const array = createArraySnapshot([1n, 2n]);
                noteArrayBinding(array);
                expect(() => stats.run(() => alter.call([array]))).toThrow('range step must be a nonzero integer');
                expect(stats.cowCopies).toBe(0);
            } finally { runtime.dispose(); }
        }
    });

    it('does not copy a shared destination when array iteration is empty', () => {
        for (const integerLoopCompilation of [false, true]) {
            const stats = new RuntimeDiagnostics();
            const runtime = new Interpreter(undefined, { integerLoopCompilation });
            try {
                runtime.execute('fun alter A Source\n for Value in Source\n  A 0 = Value\n end\n return A\nend');
                const alter = runtime.variables.get('alter');
                if (!alter || typeof alter !== 'object' || !('call' in alter)) throw new Error('alter');
                stats.run(() => alter.call([createArraySnapshot([1n]), createArraySnapshot([2n])]));
                const array = createArraySnapshot([1n]);
                noteArrayBinding(array);
                expect(stats.run(() => alter.call([array, createArraySnapshot([])]))).toBe(array);
                expect(stats.cowCopies).toBe(0);
                if (integerLoopCompilation) expect(stats.fallbacks['loop:empty-shared-destination']).toBeGreaterThan(0);
            } finally { runtime.dispose(); }
        }
    });

    it.each([true, false])('checks a shared destination before copying with compilation %s', integerLoopCompilation => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { integerLoopCompilation });
        try {
            runtime.execute('fun alter A Flag\n for I in 0 until 1\n  if Flag\n   A I = 9\n  end\n end\n return A\nend');
            const alter = runtime.variables.get('alter');
            if (!alter || typeof alter !== 'object' || !('call' in alter)) throw new Error('alter');
            expect(stats.run(() => alter.call([createArraySnapshot([1n, 2n]), true]))).toBeDefined();
            if (integerLoopCompilation) expect(stats.compiledLoops).toBeGreaterThan(0);
            const array = createArraySnapshot([1n, 'not an integer']);
            noteArrayBinding(array);
            expect(stats.run(() => alter.call([array, false]))).toEqual(array);
            if (integerLoopCompilation) expect(stats.fallbacks['loop:storage-or-cell-type']).toBeGreaterThan(0);
            expect(stats.cowCopies).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each([true, false])('checks every destination before copying with compilation %s', integerLoopCompilation => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter(undefined, { integerLoopCompilation });
        try {
            runtime.execute('fun alter A B Flag\n for I in 0 until 1\n  if Flag\n   A I = 9\n   B I = 8\n  end\n end\n return A\nend');
            const alter = runtime.variables.get('alter');
            if (!alter || typeof alter !== 'object' || !('call' in alter)) throw new Error('alter');
            stats.run(() => alter.call([createArraySnapshot([1n, 2n]), createArraySnapshot([3n, 4n]), true]));
            if (integerLoopCompilation) expect(stats.compiledLoops).toBeGreaterThan(0);
            const first = createArraySnapshot([1n, 2n]);
            noteArrayBinding(first);
            const second = createArraySnapshot([3n, 'not an integer']);
            expect(stats.run(() => alter.call([first, second, false]))).toEqual(first);
            if (integerLoopCompilation) expect(stats.fallbacks['loop:storage-or-cell-type']).toBeGreaterThan(0);
            expect(stats.cowCopies).toBe(0);
        } finally { runtime.dispose(); }
    });

    // A second name cannot reach the cached tensor at all: its first write takes
    // a copy, so the cache needs no invalidation.
    it('keeps a cached tensor clear of writes through another name', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            stats.run(() => runtime.execute(`A = array 1
Other = A
B = A * 2`));
            (runtime.variables.get('B') as RankArray).items;
            expect(stats.run(() => runtime.execute(`Total = 0
for I in 1 to 3
  Other 0 = I
  Total += B 0
end
Total`))).toBe(6n);
            expect(stats.compiledLoops).toBe(1);
            expect(stats.invalidations).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('hoists cached reads across a proven scalar callee', () => {
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
            expect(stats.hoistedReaders).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('leaves a cached compiled region before effects after callee redefinition', () => {
        const results = [false, true].map(integerLoopCompilation => {
            const stats = new RuntimeDiagnostics();
            const runtime = new Interpreter(undefined, { integerLoopCompilation });
            try {
                runtime.execute(`fun bump X
 return X + 1
end
fun total B N
 Total = 0
 for I in 0 until N
  Total += B 0 + (I bump)
 end
 return Total
end
A = array 2
B = A * 3`);
                (runtime.variables.get('B') as RankArray).items;
                const first = stats.run(() => runtime.execute('B 3 total'));
                const compiledBefore = stats.compiledLoops;
                runtime.execute('fun bump X\n return X + 2\nend');
                const second = stats.run(() => runtime.execute('B 3 total'));
                return { first, second, compiledBefore, compiledAfter: stats.compiledLoops,
                    hoistedReaders: stats.hoistedReaders, calleeFallbacks: stats.fallbacks['loop:callee'] ?? 0 };
            } finally { runtime.dispose(); }
        });
        expect(results.map(({ first, second }) => [first, second])).toEqual([[24n, 27n], [24n, 27n]]);
        expect(results[1]).toMatchObject({ compiledBefore: 1, compiledAfter: 1, hoistedReaders: 1 });
        expect(results[1].calleeFallbacks).toBeGreaterThan(0);
    });

    it('rejects a changed array element type before entering a cached compiled region', () => {
        const results = [false, true].map(integerLoopCompilation => {
            const stats = new RuntimeDiagnostics();
            const runtime = new Interpreter(undefined, { integerLoopCompilation });
            try {
                runtime.execute(`fun bump X
 return X + 1
end
fun total B N
 Total = 0
 for I in 0 until N
  Total += B 0 + (I bump)
 end
 return Total
end
A = array 2
B = A * 3`);
                (runtime.variables.get('B') as RankArray).items;
                expect(stats.run(() => runtime.execute('B 3 total'))).toBe(24n);
                const compiledBefore = stats.compiledLoops;
                runtime.execute('B = array "bad"');
                let error = '';
                try { stats.run(() => runtime.execute('B 3 total')); }
                catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
                return { error, compiledBefore, compiledAfter: stats.compiledLoops,
                    storageFallbacks: stats.fallbacks['loop:storage-or-cell-type'] ?? 0 };
            } finally { runtime.dispose(); }
        });
        expect(results[0].error).toContain('+ expects two numeric or two text values');
        expect(results[1].error).toBe(results[0].error);
        expect(results[1].compiledBefore).toBe(1);
        expect(results[1].compiledAfter).toBe(1);
        expect(results[1].storageFallbacks).toBeGreaterThan(0);
    });

    it('hoists cached reads across a bound synchronous builtin', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            stats.run(() => runtime.execute('use text\nA = array 2\nB = A * 3'));
            (runtime.variables.get('B') as RankArray).items;
            expect(stats.run(() => runtime.execute('Total = 0\nfor I in 1 to 3\n Total += B 0 + ("A" codepoint)\nend\nTotal')))
                .toBe(213n);
            expect(stats.compiledLoops).toBe(1);
            expect(stats.hoistedReaders).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('leaves a cached builtin region after the builtin is shadowed', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            runtime.execute(`use text
fun total B N
 Total = 0
 for I in 0 until N
  Total += B 0 + ("A" codepoint)
 end
 return Total
end
A = array 2
B = A * 3`);
            (runtime.variables.get('B') as RankArray).items;
            expect(stats.run(() => runtime.execute('B 3 total'))).toBe(213n);
            expect(stats.compiledLoops).toBe(1);
            expect(stats.hoistedReaders).toBe(1);
            runtime.execute('fun codepoint X\n return 7\nend');
            expect(stats.run(() => runtime.execute('B 3 total'))).toBe(39n);
            expect(stats.compiledLoops).toBe(1);
            expect(stats.fallbacks['loop:callee']).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('rejects a shadowed builtin before entering the compiled region', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            stats.run(() => runtime.execute('use text\nA = array 2\nB = A * 3\nfun codepoint X\n return 7\nend'));
            (runtime.variables.get('B') as RankArray).items;
            expect(stats.run(() => runtime.execute('Total = 0\nfor I in 1 to 3\n Total += B 0 + ("A" codepoint)\nend\nTotal')))
                .toBe(39n);
            expect(stats.hoistedReaders).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('does not hoist across a callee that writes a captured array', () => {
        const stats = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            stats.run(() => runtime.execute('fun change N\n C 0 = N\n return N\nend\nA = array 2\nB = A * 3\nC = array 0'));
            (runtime.variables.get('B') as RankArray).items;
            expect(stats.run(() => runtime.execute('Total = 0\nfor I in 1 to 3\n Total += B 0 + (I change)\nend\nTotal'))).toBe(24n);
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
