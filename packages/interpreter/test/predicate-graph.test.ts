import { describe, expect, it } from 'vitest';
import { analyzeValues } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { PredicateGraph } from '../src/graph.js';
import { native } from '../src/modules/shared.js';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import type { RankFile } from '../src/value.js';
import { MemoryIo } from './support.js';

const prelude = `use graph
use sequences
fun A B near
  return A + 1 equal B
end
`;

for (const compilation of [false, true]) describe(`predicate graphs (compiled=${compilation})`, () => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute(source)!); } finally { runtime.dispose(); }
    };

    it('constructs without testing pairs and tests only requested candidates', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`use graph
use sequences
use io
fun A B link
  "pair" print
  return A less B
end
G = new graph (1 to 100) with link .directed
N' = G 50`);
            expect(output).toEqual([]);
            expect(formatValue(runtime.execute('(array 49 51 60) filter in N array')!)).toBe('51 60');
            expect(output).toHaveLength(3);
            expect(runtime.execute('G 99 100 adjacent')).toBe(true);
            expect(output).toHaveLength(4);
        } finally { runtime.dispose(); }
    });

    it('rejects a nullary predicate without executing it', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            expect(() => runtime.execute(`use graph
use io
fun invalid
  "unexpected" print
  return true
end
new graph (array 1 2) with (invalid) .directed`)).toThrow('graph predicate expects two arguments');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('supports named predicates, self edges, and repeatable order', () => {
        expect(run(prelude + `G = new graph (array 3 1 2 2) with near .directed
N = G 1
fun A B same = A equal B
H = new graph (1 to 3) with same .undirected
tuple (G len) (N array) (N array) ((H 2) array) (G 1 2 adjacent) (G 2 1 adjacent)
`)).toBe('3 2 2 2 true false');
    });

    it('snapshots the domain but keeps captured predicate bindings live', () => {
        expect(run(prelude + `Values = array 1 2 3
Offset = 1
fun A B shifted
  return A + Offset equal B
end
G = new graph Values with shifted .directed
Values 1 = 9
N' = G 1
First = N array
Offset = 2
Second = N array
tuple First Second (9 in N) (G len)
`)).toBe('2 3 false 3');
    });

    it('runs BFS, DFS and unit-weight Dijkstra and yields weighted edges', () => {
        expect(run(prelude + `G = new graph (1 to 5) with near .directed
B = G 1 bfs
D = G 1 dfs
W = G 1 dijkstra
Distance = W .distance
Parent = B .parent
tuple (B .order) (D .order) (Distance 5) (Parent 5) ((G edges 2) array)
`)).toBe('1 2 3 4 5 1 2 3 4 5 4 4 3 1');
    });

    it('handles empty and text domains and numeric equality', () => {
        expect(run(`use graph
use sequences
fun A B yes = true
fun A B different = A not equal B
E = new graph (1 till 1) with yes .directed
G = new graph (array "b" "a" "a") with different .undirected
N = new graph (array 1 1 2) with yes .directed
tuple (E len) (G len) ((G "a") array) (N len) ((N 1.0) array)
`)).toBe('0 2 b 2 1 2');
    });

    it('requires valid endpoints and Boolean results', () => {
        for (const query of ['G 9', 'G 1 9 adjacent']) {
            expect(() => run(prelude + `G = new graph (1 to 3) with near .directed\n${query}`))
                .toThrow('graph does not contain the vertex');
        }
        expect(() => run(prelude + 'G = new graph (1 to 3) with near .directed\nG 9 bfs'))
            .toThrow('graph does not contain the start vertex');
        expect(() => run('use graph\nfun A B bad = 1\nG = new graph (array 1 2) with bad .directed\nG 1 2 adjacent'))
            .toThrow('graph predicate must return a boolean');
    });

    it('rejects invalid constructors, mutation, and algorithms requiring explicit storage', () => {
        expect(() => run(prelude + 'new graph (1 to 3) with 5 .directed')).toThrow('graph predicate expects a function');
        expect(() => run(prelude + 'fun A identity = A\nnew graph (1 to 3) with identity .directed')).toThrow('graph predicate expects two arguments');
        expect(() => run(prelude + 'new graph (1 to 3) with near .cached')).toThrow('new graph expects .directed or .undirected');
        expect(() => run(prelude + 'new graph with near .directed')).toThrow('graph successor expects one argument');
        expect(() => run(prelude + 'new graph primes with near .directed')).toThrow('graph vertices require a finite sequence');
        expect(() => run(prelude + 'G = new graph (1 to 3) with near .directed\nG add 1 2')).toThrow('predicate graph is read-only');
        for (const query of ['G components', 'G floyd', 'G 1 euler', 'G 1 2 3 trips', 'G 1 2 edgeweight']) {
            expect(() => run(prelude + `G = new graph (1 to 3) with near .directed\n${query}`))
                .toThrow('graph algorithm requires an explicit graph');
        }
    });


    it('matches explicit graph searches on the same finite relation', () => {
        for (const direction of ['directed', 'undirected']) {
            const program = prelude + `fun A B linked = (A + B) mod 3 equal 0
G = new graph (1 to 9) with linked .${direction}
E = new graph (1 to 9) .${direction}
for A in 1 to 9
  for B in 1 to 9
    if ${direction === 'directed' ? 'true' : 'A at most B'}
      if A B linked
        E add A B
      end
    end
  end
end
`;
            for (const algorithm of ['bfs', 'dfs', 'dijkstra']) {
                const result = (graph: string) => `R = ${graph} 1 ${algorithm}
D = R .distance
P = R .parent
tuple (R .order) (D 5) (P 5) (D 3 default -1)`;
                expect(run(program + result('G'))).toBe(run(program + result('E')));
            }
        }
    });

    it('preserves predicate error frames and call-depth limits', () => {
        let failure: unknown;
        try {
            run(prelude + `fun A B broken
  .BadEdge "bad edge" raise
end
G = new graph (1 to 3) with broken .directed
G 1 2 adjacent`);
        } catch (error) { failure = error; }
        expect(failure).toMatchObject({
            message: expect.stringContaining('bad edge'),
            calls: expect.arrayContaining([expect.stringContaining('broken')]),
        });
        const runtime = new Interpreter(undefined, { compilation, maxCallDepth: 4 });
        try {
            expect(() => runtime.execute(prelude + `fun A B recursive
  return G A B adjacent
end
G = new graph (1 to 3) with recursive .directed
G 1 2 adjacent`)).toThrow(/depth/i);
        } finally { runtime.dispose(); }
    });

    it('keeps explicit adjacency and DSU connected separate', () => {
        expect(run(`use graph
G = new graph (array 1 2 3) .undirected
G add 1 2
G add 2 3
D = new dsu (array 1 2 3)
D merge 1 2
D merge 2 3
tuple (G 1 2 adjacent) (G 1 3 adjacent) (D 1 3 connected)
`)).toBe('true false true');
    });

    it('retains defining-module ownership after returning a graph', () => {
        const runtime = new Interpreter(undefined, { compilation, loadModule: () => ({ id: 'relation.ra', source: `use graph
use sequences
fun A B match = A + B in primes
fun build
  return new graph (1 to 5) with match .directed
end` }) });
        try {
            expect(formatValue(runtime.execute('use "relation.ra"\nuse graph\nG = build\nG 1 2 adjacent')!)).toBe('true');
        } finally { runtime.dispose(); }
    });

    it('supports local nested predicates but rejects their escape', () => {
        const prefix = prelude + `fun Offset build
  fun A B match = A + Offset equal B
  G = new graph (1 to 5) with match .directed
`;
        expect(run(prefix + '  return (G 1) array\nend\n2 build')).toBe('3');
        for (const operation of ['bfs', 'dfs', 'dijkstra']) {
            expect(run(prefix + `  return G 1 ${operation}\nend\nResult = 2 build\nResult .order`)).toBe('1 3 5');
        }
        for (const result of ['G', 'G 1']) {
            expect(() => run(prefix + `  return ${result}\nend\n2 build`))
                .toThrow('lazy result retains nested function match');
        }
    });

    it('keeps a captured file open during local lazy access and closes it afterward', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, { compilation, io });
        expect(runtime.execute(`use io
use graph
use sequences
fun build
  File = "/input" open
  fun A B link = File size equal B
  G = new graph (1 to 4) with link .directed
  return G 1 4 adjacent
end
build`)).toBe(true);
        expect(io.handles[0].closed).toBe(true);
        runtime.dispose();
    });

});

it('never infers callback-free neighbors from a predicate constructor', () => {
    const facts = analyzeValues(parse(prelude + `G = new graph (1 to 5) with near .directed
N' = G 1
B = N array`));
    expect(facts.diagnostics).toEqual([]);
    expect(facts.bindings.get('G')?.types).toEqual(['graph']);
    expect(facts.bindings.get('N')?.callbackFreeScalarCells).not.toBe(true);
});

it('checks cancellation while evaluating a large domain', () => {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    let calls = 0;
    const fn = native('edge', 2, () => { calls++; Atomics.store(signal, 0, 1); return false; });
    const graph = new PredicateGraph({ kind: 'array', shape: [100000], items: Array.from({ length: 100000 }, (_, i) => BigInt(i)) },
        { kind: 'label', name: 'directed' }, fn, (a, b) => fn.call([a, b]));
    expect(() => withInterrupt(signal, () => [...graph.neighbors(0n).plan.iterate()])).toThrow(InterruptedError);
    expect(calls).toBeLessThan(100000);
});

it('transfers host callback resources through graphs and their sequences', () => {
    for (const project of [(graph: PredicateGraph) => graph, (graph: PredicateGraph) => graph.neighbors(1n),
        (graph: PredicateGraph) => graph.edges(1n)]) {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        const fn = { ...native('edge', 2, () => true), captures: [new Map([['File', file]])] };
        ownership.withResourceScope(() => {
            ownership.ownFile(file);
            return project(new PredicateGraph(1n, { kind: 'label', name: 'directed' }, fn, (a, b) => fn.call([a, b])));
        });
        expect(file.closed).toBe(false);
        ownership.dispose();
        expect(file.closed).toBe(true);
    }
});
