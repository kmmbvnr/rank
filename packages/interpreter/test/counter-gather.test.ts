import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { addToCollection, newStructure } from '../src/collections.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { applySelectors } from '../src/value-selection.js';
import { type RankArray, type RankCounter, type RankValue } from '../src/value.js';

describe.each([false, true])('counter gather (compilation=%s)', compilation => {
    function run(source: string): RankValue | undefined {
        const runtime = new Interpreter(undefined, { compilation });
        try { return runtime.execute(`use algo\nuse sequences\n${source}`); }
        finally { runtime.dispose(); }
    }

    it('gathers text keys, preserving order, repeats and absent-key zero', () => {
        expect(formatValue(run('Keys = array "ab" "ab" "cd"\nCounts = new counter Keys\nCounts Keys')!))
            .toBe('2 2 1');
        expect(formatValue(run('Counts = new counter (array "ab" "ab" "cd")\nCounts (array "cd" "none" "ab" "cd")')!))
            .toBe('1 0 2 1');
        expect(run('Counts = new counter (array "ab" "ab" "cd")\nCounts "ab"')).toBe(2n);
        expect(run('Counts = new counter\nCounts "absent"')).toBe(0n);
    });

    it.each([
        ['array shape 2 2 fill 3', [2, 2], [2n, 2n, 2n, 2n]],
        ['array shape 0 3 fill 3', [0, 3], []],
        ['array shape 2 0 fill 3', [2, 0], []],
        ['array shape (array shape 0 fill 0) fill 3', [], [2n]],
    ])('preserves query shape: %s', (query, shape, items) => {
        expect(run(`Counts = new counter (array 3 3)\nCounts (${query})`))
            .toMatchObject({ kind: 'array', shape, items });
    });

    it('gathers from empty counters and finite sequences', () => {
        expect(formatValue(run('Counts = new counter\nCounts (array 2 3 2)')!)).toBe('0 0 0');
        expect(formatValue(run('Counts = new counter (array 3 3 2)\nCounts (3 to 0 by -1)')!)).toBe('2 1 0 0');
        expect(run('Counts = new counter\nCounts (1 till 1)')).toMatchObject({ kind: 'array', shape: [0], items: [] });
        expect(() => run('Counts = new counter\nCounts (0 to #)')).toThrow(/infinite sequence/);
    });

    it('uses tuple and record composite keys after array-query migration', () => {
        expect(run('Counts = new counter\nCounts add tuple 2 3\nCounts add tuple 2 3\nCounts (tuple 2 3)')).toBe(2n);
        expect(run('Key = record\n .x = 2\n .y = 3\nend\nCounts = new counter\nCounts add Key\nCounts Key')).toBe(1n);
        // Insertion still accepts whole arrays; an array query always gathers.
        expect(formatValue(run('Counts = new counter\nCounts add array 2 3\nCounts add array 2 3\nCounts (array 2 3)')!))
            .toBe('0 0');
        expect(formatValue(run('Counts = new counter\nCounts add 2\nCounts add 3\nCounts (array 2 3)')!))
            .toBe('1 1');
    });

    it('keeps row insertion distinct from query gathering by cells', () => {
        expect(() => run('Keys = array 1 2 1 2 shape 2 2\nCounts = new counter Keys'))
            .toThrow(/rank-1 collection/);
        expect(run('Keys = array 1 2 1 2 shape 2 2\nCounts = new counter\nfor Key in Keys\n Counts add Key\nend\nCounts Keys'))
            .toMatchObject({ kind: 'array', shape: [2, 2], items: [0n, 0n, 0n, 0n] });
    });

    it('preserves saved results across counter and query mutations', () => {
        expect(formatValue(run('Keys = array 2 3\nCounts = new counter Keys\nBefore = Counts Keys\nCounts add 2\nCounts remove 3\nKeys 0 = 9\nconcat Before (Counts Keys)')!))
            .toBe('1 1 0 0');
    });

    it('checks gathered bindings as integer arrays', () => {
        expect(() => run('Counts = new counter\nResult = Counts (array 1 2)\nResult 0 = "bad"')).toThrow(/cannot receive/);
        expect(() => run('Counts = new counter\nResult = Counts 1\nResult = Counts (array 1 2)')).toThrow(/cannot receive/);
    });

    it('shares an explicit accumulator across recursive branches and isolates fresh counters', () => {
        expect(formatValue(run(`fun Depth visit Counts
 if Depth equal 0
  Counts add 7
  return Counts
 end
 Left = (Depth - 1) visit Counts
 Right = (Depth - 1) visit Counts
 return Counts
end
A = new counter
Alias = 4 visit A
B = new counter
Other = 2 visit B
array (A 7) (Alias 7) (B 7) (Other 7)`)!)).toBe('16 16 4 4');
    });

    it('returns gathered arrays from repeated function calls', () => {
        expect(formatValue(run('fun Keys frequencies\n Counts = new counter Keys\n return Counts Keys\nend\nA = (array "ab" "ab" "cd") frequencies\nB = (array "x" "x") frequencies\nconcat A B')!))
            .toBe('2 2 1 2 2');
    });
});

it('reads lazy array keys once in order, observing counter changes at each read', () => {
    const counts = newStructure('counter') as RankCounter;
    const reads: number[] = [];
    const keys: RankArray = { kind: 'array', shape: [3], items: [], itemAt(index) {
        reads.push(index);
        addToCollection(counts, 1n);
        return 1n;
    } };
    expect(applySelectors([counts, keys])).toMatchObject({ shape: [3], items: [1n, 2n, 3n] });
    expect(reads).toEqual([0, 1, 2]);
});

it('consumes unknown-finiteness sequences once, interleaving queries with generation', () => {
    const counts = newStructure('counter') as RankCounter;
    let iterations = 0;
    const keys: RankValue = { kind: 'sequence', plan: {
        name: 'host keys', size: { kind: 'unknown' },
        *iterate() {
            iterations++;
            for (let i = 0; i < 3; i++) { addToCollection(counts, 1n); yield 1n; }
        },
    } };
    expect(applySelectors([counts, keys])).toMatchObject({ items: [1n, 2n, 3n] });
    expect(iterations).toBe(1);
});

it('rejects known-infinite queries without reading any keys', () => {
    let reads = 0;
    const keys: RankValue = { kind: 'sequence', plan: {
        name: 'unbounded', size: { kind: 'infinite' },
        *iterate() { reads++; yield 1n; },
    } };
    expect(() => applySelectors([newStructure('counter'), keys])).toThrow(/infinite sequence/);
    expect(reads).toBe(0);
});

it('retains key equality, exact counts and invalid-key errors', () => {
    const counts = newStructure('counter') as RankCounter;
    addToCollection(counts, 2n);
    // Number integers and BigInts share equality, but language element types
    // remain distinct on insertion. Probe lookup normalization directly.
    expect(applySelectors([counts, ownedArray([2])])).toMatchObject({ items: [1n] });
    const entry = [...counts.entries.values()][0];
    entry.count = 18446744073709551617n;
    expect(applySelectors([counts, ownedArray([2n, 9007199254740993n])]))
        .toMatchObject({ items: [18446744073709551617n, 0n] });
    const cyclic: RankArray = { kind: 'array', shape: [1], items: [] };
    cyclic.items.push(cyclic);
    expect(() => applySelectors([counts, { kind: 'array', shape: [1], items: [cyclic] }]))
        .toThrow(/cyclic/);
    expect(() => applySelectors([counts, { kind: 'array', shape: [1], items: [counts] }]))
        .toThrow(/set values/);
});

it.each(['array', 'sequence'])('keeps long %s gathers cancellable', kind => {
    let reads = 0;
    const keys: RankValue = kind === 'array'
        ? { kind: 'array', shape: [10000], items: [], itemAt: () => { reads++; return 1n; } }
        : { kind: 'sequence', plan: { name: 'keys', size: { kind: 'unknown' },
            *iterate() { for (let i = 0; i < 10000; i++) { reads++; yield 1n; } } } };
    const signal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 1 };
    expect(() => withInterrupt(signal, () => applySelectors([newStructure('counter'), keys])))
        .toThrow(InterruptedError);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(10000);
});
