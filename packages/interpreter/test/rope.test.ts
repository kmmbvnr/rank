import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { rope, ropeSlice, ropeConcat, ropeReverse, ropeChunks, ropeRuns } from '../src/rope.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

function values(source: ReturnType<typeof rope>) { return [...source.plan.iterate()]; }

it('matches a flat reference through mixed splits, joins, inserts, deletes and reversals', () => {
    let expected: bigint[] = Array.from({ length: 100 }, (_, i) => BigInt(i));
    let tree = rope(ownedArray(expected));
    let seed = 123456789;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let k = 0; k < 1200; k++) {
        const saved = tree, before = expected.slice();
        if (!expected.length || random(3) === 0) {
            const at = random(expected.length + 1), inserted = [BigInt(k), -BigInt(k)];
            expected.splice(at, 0, ...inserted);
            tree = ropeConcat([ropeSlice(tree, BigInt(at), false), rope(ownedArray(inserted)), ropeSlice(tree, BigInt(at), true)]);
        } else {
            const a = random(expected.length), b = a + random(expected.length - a);
            if (random(3) === 0) {
                expected.splice(a, b - a + 1);
                tree = ropeConcat([ropeSlice(tree, BigInt(a), false), ropeSlice(tree, BigInt(b + 1), true)]);
            } else {
                expected.splice(a, b - a + 1, ...expected.slice(a, b + 1).reverse());
                tree = ropeReverse(tree, BigInt(a), BigInt(b));
            }
        }
        expect(values(saved)).toEqual(before);
        expect(values(tree)).toEqual(expected);
        for (let i = 0; i < expected.length; i++) expect(tree.plan.at!(BigInt(i))).toBe(expected[i]);
    }
});

for (const compilation of [false, true]) describe(`rope language (${compilation})`, () => {
    function run(source: string) {
        const r = new Interpreter(() => {}, { compilation });
        try { return formatValue(r.execute('use sequences\n' + source)!); }
        finally { r.dispose(); }
    }
    it('uses ordinary indexing and sequence operations without expanding huge ranges', () => {
        expect(run(`A = (0 till 1000000000000000000) rope
B = A 2 999999999999999997 reverse
C = B take 4
array (B len) (B 2) (B 999999999999999997) (A 2) (C last)`))
            .toBe('1000000000000000000 999999999999999997 2 2 999999999999999996');
    });
    it('joins independently prepared text ropes', () => {
        expect(run(`A = (array "a" "x" "c") rope
B = concat (A take 1) ("ab" rope) (A drop 2)
B reverse copy`)).toBe('c b a a');
    });
    it('keeps slices, complete reversals and subsequent joins compressed', () => {
        expect(run(`A = (0 till 1000000000000000000) rope
B = A reverse
C = concat (B take 5) (B drop 5)
C runs`)).toBe('999999999999999999 -1 1000000000000000000');
    });
    it('does not change ordinary sequence reverse results', () => {
        expect(run('(1 to 4) reverse type')).toBe('.array');
        expect(run('((1 to 4) rope) reverse type')).toBe('.sequence');
    });
    it('reports bounds and input errors', () => {
        expect(() => run('A = (1 to 3) rope\nA (-1) 1 reverse')).toThrow('rope index out of bounds');
        expect(() => run('A = (1 to 3) rope\nA 0 3 reverse')).toThrow('rope index out of bounds');
        expect(() => run('A = (1 to 3) rope\nA 2 1 reverse')).toThrow('start must not exceed');
        expect(() => run('A = (1 to 3) rope\nA 0 1.5 reverse')).toThrow('integer bounds');
        expect(() => run('fibonacci rope')).toThrow('finite sequence');
        expect(() => run('(array 1 2 shape 1 2) rope')).toThrow('rank-1');
        expect(() => run('(1 to 3) 0 1 reverse')).toThrow('expects a rope');
    });
    it('retains nested array snapshots after the source is changed', () => {
        expect(run(`Row = array 1 2
Rows = array (tuple Row)
A = Rows rope
Row 0 = 9
Rows 0 = tuple (array 8 7)
A 0`)).toBe('1 2');
    });
});

it('exposes chunks, handles empty ropes and preserves cancellation', () => {
    const empty = rope(ownedArray([]));
    expect(values(ropeReverse(empty))).toEqual([]);
    expect(values(ropeSlice(empty, 500n, true))).toEqual([]);
    expect(ropeRuns(empty).shape).toEqual([0, 3]);
    const tree = rope(ownedArray(Array.from({ length: 600 }, (_, i) => String(i))));
    const chunks = [...ropeChunks(ropeReverse(tree)).plan.iterate()];
    expect(chunks).toHaveLength(3);
    expect(readArrayItem(chunks[0] as ReturnType<typeof ownedArray>, 0)).toBe('599');
    expect(() => ropeRuns(tree)).toThrow('integer rope');
    expect(() => withDemandBudget(1, () => [...tree.plan.iterate()])).toThrow(DemandBudgetExhausted);
});

it('retains resource dependencies through slices, reversal, joins and chunks', async () => {
    const { ResourceOwnership } = await import('../src/resource-ownership.js');
    const { MemoryIo } = await import('./support.js');
    const io = new MemoryIo({ '/input': 'Rank' });
    const file = { kind: 'file' as const, handle: io.open('/input', 'read'), closed: false };
    const ownership = new ResourceOwnership();
    try {
        const result = ownership.withResourceScope(() => {
            ownership.ownFile(file);
            const tree = rope(ownedArray([file]));
            return ropeChunks(ropeConcat([ropeSlice(tree, 0n, true), ropeReverse(tree)]));
        });
        expect(file.closed).toBe(false);
        expect([...result.plan.iterate()]).toHaveLength(2);
    } finally { ownership.dispose(); }
    expect(file.closed).toBe(true);
});

it('snapshots host readers once and accepts non-numeric values and arbitrary-precision runs', () => {
    let reads = 0;
    const source = { kind: 'array' as const, shape: [3], items: [], itemAt: (i: number) => { reads++; return `${i}`; } };
    const tree = rope(source);
    expect(reads).toBe(3);
    expect(values(ropeReverse(tree))).toEqual(['2', '1', '0']);
    expect(values(tree)).toEqual(['0', '1', '2']);
    expect(reads).toBe(3);
    const big = 1n << 100n;
    const runs = ropeRuns(rope(ownedArray([big, big + 1n, big + 2n])));
    expect(readArrayItem(runs, 0)).toBe(big);
    expect(readArrayItem(runs, 2)).toBe(3n);
});

it('keeps long append/prepend chains shallow and traversable after reversals', () => {
    let tree = rope(ownedArray([]));
    for (let i = 0; i < 10000; i++) {
        const leaf = rope(String.fromCodePoint(65 + i % 26));
        tree = i % 2 ? ropeConcat([tree, leaf]) : ropeConcat([leaf, tree]);
    }
    const before = values(tree);
    expect(values(ropeReverse(tree))).toEqual(before.slice().reverse());
    for (let i = 0; i < before.length; i += 37) expect(tree.plan.at!(BigInt(i))).toBe(before[i]);
});
