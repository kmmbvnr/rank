import { describe, expect, it } from 'vitest';
import { GraphValue } from '../src/graph.js';
import { trips } from '../src/graph-trips.js';
import { isRankSequence } from '../src/value.js';
import { run } from './support.js';

const setup = `use graph
use sequences
G = new graph (1 to 5) .undirected
G add (array shape 5 3
  1 2 7
  2 3 4
  2 4 8
  3 4 2
  1 2 9
end)
`;

describe('graph trips and segment totals', () => {
    it('builds adjacency from flight records with text vertices and real weights', () => {
        expect(run(`use graph\nuse sequences
G = new graph (array "A" "B" "C") .undirected
fun flights
  yield record
    .source = "A"
    .target = "B"
    .weight = 2.5
    .airline = "Example"
  end
  yield record
    .source = "B"
    .target = "C"
    .weight = 3.5
    .airline = "Example"
  end
end
G add flights
tuple (G "A" "C" 1 trips first) (G "B" "A" edgeweight)
`)).toBe('A B C 2.5');
        expect(run(`use graph
G = new graph .directed
G add (record
  .source = .a
  .target = .b
end)
G .a .b edgeweight
`)).toBe('1');
    });

    it('rejects incomplete edge records and endpoints outside a closed domain', () => {
        expect(() => run(`use graph
G = new graph .directed
G add (record
  .source = "A"
end)
`)).toThrow('edge records require .source and .target');
        expect(() => run(`use graph
G = new graph (array "A") .directed
G add (record
  .source = "A"
  .target = "B"
end)
`)).toThrow('graph does not contain the vertex');
    });

    it('enumerates direct and bounded indirect routes without duplicates or revisits', () => {
        expect(run(setup + 'G 1 2 0 trips array')).toBe('1 2');
        expect(run(setup + 'G 1 4 0 trips len')).toBe('0');
        expect(run(setup + 'G 1 4 1 trips array')).toBe('1 2 4');
        expect(run(setup + 'G 1 4 2 trips len')).toBe('2');
        expect(run(setup + 'G 1 4 999999999999999999999 trips len')).toBe('2');
        expect(run(setup + 'G 1 1 10 trips len')).toBe('0');
        expect(run(setup + 'G 1 5 10 trips len')).toBe('0');
    });

    it('respects edge direction and ignores self loops', () => {
        expect(run(`use graph\nuse sequences
G = new graph .directed
G add 1 1
G add 1 2
G add 2 3
G add 3 1
tuple (G 1 3 1 trips len) (G 3 2 0 trips len) (G 1 1 5 trips len)
`)).toBe('1 0 0');
    });

    it('looks up minimum parallel weights and handles missing connections', () => {
        expect(run(setup + 'tuple (G 1 2 edgeweight) (G 2 1 edgeweight) (G 1 5 edgeweight default -1)'))
            .toBe('7 7 -1');
        expect(run('use graph\nG = new graph .directed\nG add 1 2 -4\nG add 1 2 0.5\ntuple (G 1 2 edgeweight) (G 2 1 edgeweight default 99)'))
            .toBe('-4 99');
    });

    it('composes reusable adjacent-pair reduction for routes of any length', () => {
        expect(run(setup + `
fun Pair cost rank 1
  return G (Pair 0) (Pair 1) edgeweight
end
fun Route total
  return (Route window 2) cost reduce +
end
tuple ((array 1 2 3 4) total) ((array 1 2 1) total) ((array 1) total) ((array shape 0 fill 0) total)
`)).toBe('13 14 0 0');
    });

    it('validates stop limits and endpoint domains', () => {
        for (const limit of ['-1', '1.5', '"two"']) {
            expect(() => run(setup + `G 1 4 ${limit} trips`)).toThrow('nonnegative integer stop limit');
        }
        expect(run(setup + 'G 1 99 2 trips default -1')).toBe('-1');
        expect(run('use graph\nuse sequences\nG = new graph .directed\nG 1 99 2 trips len')).toBe('0');
    });

    it('is replayable, snapshots mutations and does not enumerate the factorial result eagerly', () => {
        const graph = new GraphValue(true, true);
        for (let from = 0n; from < 12n; from++) {
            for (let to = 0n; to < 12n; to++) graph.addEdge(from, to);
        }
        const routes = trips(graph, 0n, 11n, 10n);
        expect(isRankSequence(routes)).toBe(true);
        if (!isRankSequence(routes)) throw new Error('expected sequence');
        graph.adjacency.clear();
        const first = routes.plan.iterate().next().value;
        expect(first).toEqual({ kind: 'array', items: Array.from({ length: 12 }, (_, i) => BigInt(i)), shape: [12] });
        expect(routes.plan.iterate().next().value).toEqual(first);
    });

    it('matches exhaustive simple routes on small directed graphs', () => {
        for (let mask = 0; mask < 64; mask++) {
            const graph = new GraphValue(true, false);
            for (let i = 0n; i < 3n; i++) graph.addVertex(i);
            let bit = 0;
            const edges: number[][] = [[], [], []];
            for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
                if (a === b) continue;
                if (mask & (1 << bit)) {
                    graph.addEdge(BigInt(a), BigInt(b));
                    edges[a].push(b);
                }
                bit++;
            }
            for (let stops = 0; stops <= 2; stops++) {
                const expected: number[][] = [];
                if (edges[0].includes(2)) expected.push([0, 2]);
                if (stops >= 1 && edges[0].includes(1) && edges[1].includes(2)) expected.push([0, 1, 2]);
                const result = trips(graph, 0n, 2n, BigInt(stops));
                if (!isRankSequence(result)) throw new Error('expected sequence');
                const actual = [...result.plan.iterate()].map(value => {
                    if (typeof value !== 'object' || value.kind !== 'array') throw new Error('expected route');
                    return value.items.map(Number).join(',');
                });
                expect(actual.sort()).toEqual(expected.map(route => route.join(',')).sort());
            }
        }
    });
});
