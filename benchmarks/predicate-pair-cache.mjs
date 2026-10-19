import assert from 'node:assert/strict';
import { setValueKey } from '../packages/interpreter/out/set.js';
import { checkpoint } from '../packages/interpreter/out/interrupt.js';

// Experimental adapter only: use a deterministic relation whose captured values
// stay stable for the lifetime of this graph. This is not a public Rank cache API.
export function cachePredicatePairs(graph, vertices, storage = 'map') {
    const positions = new Map();
    for (const value of vertices) {
        const key = setValueKey(value);
        if (!positions.has(key)) positions.set(key, positions.size);
    }
    const size = positions.size;
    assert.equal(size, graph.size);
    assert.ok(Number.isSafeInteger(size * size), 'pair keys must be exact integers');
    assert.ok(storage === 'map' || storage === 'packed');
    const pairCount = graph.directed ? size * size : size * (size + 1) / 2;
    const byteLength = Math.ceil(pairCount / 4);
    const pairs = new Map();
    let packed = storage === 'packed' ? new Uint8Array(byteLength) : undefined;
    let entries = 0;
    const get = key => storage === 'map' ? pairs.get(key)
        : packed ? (packed[Math.floor(key / 4)] >> ((key % 4) * 2)) & 3 : 0;
    const put = (key, value) => {
        if (storage === 'map') pairs.set(key, value);
        else {
            packed ??= new Uint8Array(byteLength);
            packed[Math.floor(key / 4)] |= value << ((key % 4) * 2);
        }
        entries++;
    };
    const adjacent = graph.adjacent.bind(graph);
    let hits = 0, misses = 0;
    graph.adjacent = (left, right) => {
        checkpoint('checking cached graph adjacency');
        let a = positions.get(setValueKey(left)), b = positions.get(setValueKey(right));
        // Preserve original validation and error behavior for absent endpoints.
        if (a === undefined || b === undefined) return adjacent(left, right);
        if (!graph.directed && a > b) [a, b] = [b, a];
        const key = graph.directed ? a * size + b : b * (b + 1) / 2 + a;
        const result = get(key);
        if (result) { hits++; return result === 2; }
        misses++;
        const computed = adjacent(left, right);
        // Exceptions and invalid callback results are never cached.
        put(key, computed ? 2 : 1);
        return computed;
    };
    return { stats: () => ({ entries, hits, misses, packedBytes: packed?.byteLength ?? 0 }),
        clear: () => { pairs.clear(); packed = undefined; entries = 0; } };
}
