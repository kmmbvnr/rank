import { describe, expect, it } from 'vitest';
import { GraphValue, type TraversalGraph } from '../src/graph.js';
import { breadthFirst, depthFirst, dijkstra, searchRecord } from '../src/modules/graph.js';
import { indexKey } from '../src/index-key.js';
import { setValueKey } from '../src/set.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { isRankIndex, type RankValue } from '../src/value.js';
import { run } from './support.js';

const searches = [breadthFirst, depthFirst, dijkstra].map(search => ({ name: search.name, search }));

describe('graph traversal providers', () => {
    it.each(searches)('$name discovers states and builds result indices without a vertex table', ({ search }) => {
        const expanded: RankValue[] = [];
        const provider: TraversalGraph = {
            requireStart: setValueKey,
            *outgoingEdges(vertex) {
                expanded.push(vertex);
                const n = Number(vertex);
                if (n < 4) yield { target: BigInt(n + 1), weight: 2n };
                // Parallel edges and cycles must not expand a state twice.
                if (n < 4) yield { target: n + 1, weight: 3n };
                yield { target: 0n, weight: 1n };
            },
        };
        // Keep the selected numeric representation uniform in the returned order array.
        // The duplicate edges still exercise integer/real key equality.
        const state = search(provider, search === depthFirst ? 0 : 0n);
        expect(expanded).toEqual(search === depthFirst ? [0, 1, 2, 3, 4] : [0n, 1n, 2n, 3n, 4n]);
        expect(state.vertices.size).toBe(5);
        const result = searchRecord(state);
        const distance = result.entries.get('distance')!;
        const parent = result.entries.get('parent')!;
        expect(isRankIndex(distance) && distance.entries.get(indexKey([4n])))
            .toBe(search === dijkstra ? 8n : 4n);
        expect(isRankIndex(parent) && parent.entries.get(indexKey([4n]))).toEqual(search === depthFirst ? 3 : 3n);
        expect(isRankIndex(parent) && parent.entries.has(indexKey([0n]))).toBe(false);
    });

    it.each(searches)('$name preserves explicit graph results for generated outgoing iterables', ({ search }) => {
        for (const directed of [false, true]) {
            const graph = new GraphValue(directed, true);
            for (let i = 0; i < 12; i++) graph.addVertex(BigInt(i));
            for (let i = 0; i < 11; i++) {
                for (let j = 0; j < 11; j++) {
                    if ((i * 7 + j * 3) % 5 !== 0) continue;
                    graph.addEdge(BigInt(i), BigInt(j), BigInt((i + j) % 4));
                    graph.addEdge(BigInt(i), BigInt(j), 2.5);
                }
            }
            const provider: TraversalGraph = {
                requireStart: value => graph.requireStart(value),
                *outgoingEdges(value) { yield* graph.outgoingEdges(value); },
            };
            for (const start of [0n, 3n, 11n]) {
                expect(searchRecord(search(provider, start)))
                    .toEqual(searchRecord(search(graph, start)));
            }
        }
    });

    it('preserves DFS reverse-push order and discovery parents', () => {
        const edges = [[1, 2], [2, 3], [3], []];
        const provider: TraversalGraph = {
            requireStart: setValueKey,
            *outgoingEdges(vertex) {
                for (const target of edges[Number(vertex)]) yield { target, weight: 1n };
            },
        };
        const state = depthFirst(provider, 0);
        expect(state.order).toEqual([0, 1, 3, 2]);
        expect(state.parent.get(setValueKey(2))).toBe(0);
        expect(state.parent.get(setValueKey(3))).toBe(1);
    });

    it.each(searches)('$name propagates provider errors and closes iterators on cancellation', ({ search }) => {
        const failure = new Error('successor failed');
        expect(() => search({
            requireStart: setValueKey,
            *outgoingEdges() { throw failure; },
        }, 0n)).toThrow(failure);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        let closed = false;
        const provider: TraversalGraph = {
            requireStart: setValueKey,
            *outgoingEdges() {
                try {
                    Atomics.store(signal, 0, 1);
                    for (let i = 0; i < 100000; i++) yield { target: 0n, weight: 0n };
                } finally {
                    closed = true;
                }
            },
        };
        expect(() => withInterrupt(signal, () => search(provider, 0n))).toThrow(InterruptedError);
        expect(closed).toBe(true);
    });

    it('keeps Dijkstra validation global and checks the start before weights', () => {
        const source = `use graph
G = new graph (array 1 2 3) .directed
G add 2 3 -1
`;
        expect(() => run(source + 'G 1 dijkstra')).toThrow('dijkstra requires nonnegative edge weights');
        expect(() => run(source + 'G 9 dijkstra')).toThrow('graph does not contain the start vertex');
    });

    it.each(['bfs', 'dfs', 'dijkstra'])('%s retains text keys and missing disconnected distances', search => {
        expect(run(`use graph
G = new graph (array "start" "next" "alone") .directed
G add "start" "next"
R = G "start" ${search}
D = R .distance
P = R .parent
tuple (D "next") (P "next") (D "alone" default -1)
`)).toBe('1 start -1');
    });
});
