import assert from 'node:assert/strict';
import test from 'node:test';
import { PredicateGraph } from '../packages/interpreter/out/graph.js';
import { native } from '../packages/interpreter/out/modules/shared.js';
import { cachePredicatePairs } from './predicate-pair-cache.mjs';

function fixture(directed, predicate, storage) {
    const vertices = [1n, 2n, 3n];
    const callback = native('edge', 2, predicate);
    const graph = new PredicateGraph({ kind: 'array', shape: [3], items: vertices },
        { kind: 'label', name: directed ? 'directed' : 'undirected' }, callback,
        (a, b) => callback.call([a, b]));
    return { graph, cache: cachePredicatePairs(graph, vertices, storage) };
}

for (const storage of ['map', 'packed']) {
test(`${storage}: caches true and false, canonicalizes undirected pairs and numeric identity`, () => {
    let calls = 0;
    const { graph, cache } = fixture(false, ([a, b]) => { calls++; return a + b === 3n; }, storage);
    assert.equal(graph.adjacent(1n, 2n), true);
    assert.equal(graph.adjacent(2n, 1), true);
    assert.equal(graph.adjacent(1n, 3n), false);
    assert.equal(graph.adjacent(3n, 1n), false);
    assert.equal(calls, 2);
    assert.deepEqual(cache.stats(), { entries: 2, hits: 2, misses: 2, packedBytes: storage === 'packed' ? 2 : 0 });
    assert.deepEqual([...graph.neighbors(1n).plan.iterate()], [2n]);
    assert.throws(() => graph.adjacent(1n, 4n), /does not contain/);
});

test('keeps directed pairs and separate graph caches independent', () => {
    const first = fixture(true, ([a, b]) => a < b, storage);
    const second = fixture(true, () => false, storage);
    assert.equal(first.graph.adjacent(1n, 2n), true);
    assert.equal(first.graph.adjacent(2n, 1n), false);
    assert.equal(second.graph.adjacent(1n, 2n), false);
    assert.equal(first.cache.stats().entries, 2);
    assert.equal(second.cache.stats().entries, 1);
});

test('does not retain exceptions or invalid predicate results', () => {
    let calls = 0;
    const { graph, cache } = fixture(false, () => {
        calls++;
        if (calls === 1) throw new Error('retry');
        return calls === 2 ? 1n : false;
    }, storage);
    assert.throws(() => graph.adjacent(1n, 2n), /retry/);
    assert.throws(() => graph.adjacent(1n, 2n), /boolean/);
    assert.equal(cache.stats().entries, 0);
    assert.equal(graph.adjacent(1n, 2n), false);
    assert.equal(graph.adjacent(2n, 1n), false);
    assert.equal(calls, 3);
});

}

test('packed pair positions do not collide across bytes or directions', () => {
    const vertices = Array.from({ length: 17 }, (_, i) => BigInt(i));
    for (const directed of [false, true]) {
        let calls = 0;
        const relation = (a, b) => directed ? a < b : (a + b) % 3n === 0n;
        const fn = native('edge', 2, ([a, b]) => { calls++; return relation(a, b); });
        const graph = new PredicateGraph({ kind: 'array', shape: [17], items: vertices },
            { kind: 'label', name: directed ? 'directed' : 'undirected' }, fn, (a, b) => fn.call([a, b]));
        const cache = cachePredicatePairs(graph, vertices, 'packed');
        for (let pass = 0; pass < 2; pass++) for (const a of vertices) for (const b of vertices) {
            assert.equal(graph.adjacent(a, b), relation(a, b));
        }
        assert.equal(calls, directed ? 17 * 17 : 17 * 18 / 2);
        assert.equal(cache.stats().entries, calls);
        cache.clear();
        assert.equal(cache.stats().entries, 0);
        assert.equal(cache.stats().packedBytes, 0);
        assert.equal(graph.adjacent(1n, 2n), relation(1n, 2n));
        assert.equal(cache.stats().entries, 1);
    }
});
