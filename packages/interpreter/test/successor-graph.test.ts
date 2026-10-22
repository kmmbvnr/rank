import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { SuccessorGraph } from '../src/graph.js';
import { boundedBreadthFirst } from '../src/modules/graph.js';
import { native } from '../src/modules/shared.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

const prelude = `use graph
use sequences
fun N next = (N + 1) to (N + 2)
G = new graph with next .directed
`;

for (const compilation of [false, true]) describe(`successor graphs (compiled=${compilation})`, () => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute(source)!); } finally { runtime.dispose(); }
    };

    it('finds a shortest path in an open state space with stable discovery order', () => {
        expect(run(prelude + `R = G 0 5 20 bfs
D = R .distance
tuple (R .status) (R .path) (D 5) (R .order) (R .examined)`))
            .toBe('.reached 0 1 3 5 3 0 1 2 3 4 5 8');
    });

    it('does not invoke the callback at construction, inspection, or a zero-step goal', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`use graph
use io
fun N next
  "called" print
  return array (N + 1)
end
G = new graph with next .directed
N' = G 1`);
            expect(formatValue(runtime.variables.get('G')!)).toBe('<graph directed successor>');
            expect(formatValue(runtime.execute('R = G 1 1 0 bfs\ntuple (R .status) (R .path) (R .examined)')!))
                .toBe('.reached 1 0');
            expect(formatValue(runtime.execute('R = G 1 2 0 bfs\ntuple (R .status) (R .order)')!))
                .toBe('.limit 1');
            expect(output).toEqual([]);
            expect(runtime.execute('R = G 1 2 1 bfs\nR .examined')).toBe(1n);
            expect(output).toEqual(['called']);
        } finally { runtime.dispose(); }
    });

    it('distinguishes exhaustion from a conservative limit boundary and counts duplicates', () => {
        const source = `use graph
use sequences
fun N next = array N (3 - N)
G = new graph with next .directed
`;
        expect(run(source + `R = G 1 9 5 bfs
tuple (R .status) (R .path len) (R .order) (R .examined)`)).toBe('.exhausted 0 1 2 4');
        expect(run(source + `R = G 1 9 4 bfs
tuple (R .status) (R .order) (R .examined)`)).toBe('.limit 1 2 4');
        expect(run(source + `R = G 1 2 2 bfs
tuple (R .status) (R .path)`)).toBe('.reached 1 2');
        expect(run(`use graph
use sequences
fun N dead = 1 till 1
G = new graph with dead .directed
R = G 0 1 1 bfs
tuple (R .status) (R .order) (R .examined)`)).toBe('.exhausted 0 0');
    });

    it('stops an unreachable search with bounded retained states', () => {
        expect(run(prelude + `R = G 0 -1 10 bfs
tuple (R .status) (R .examined) (R .order len) (R .path len)`)).toBe('.limit 10 7 0');
    });

    it('provides repeatable lazy successors with live captures and unit edges', () => {
        expect(run(`use graph
use sequences
Offset = 1
fun N next = array (N + Offset)
G = new graph with next .directed
N' = G 4
First = N array
Offset = 2
tuple First (N array) ((G edges 4) array)`)).toBe('5 6 6 1');
    });

    it('matches finite explicit BFS distances and reconstructed paths', () => {
        expect(run(`use graph
use sequences
fun N next = (N + 1) to ((N + 2) 5 min)
G = new graph with next .directed
E = new graph (0 to 5) .directed
for N in 0 to 5
  for M in N next
    E add N M
  end
end
A = G 0 5 100 bfs
B = E 0 5 100 bfs
tuple (((A .path) equal (B .path)) all) (((A .order) equal (B .order)) all)`)).toBe('true true');
    });

    it('supports text states and numeric equality', () => {
        expect(run(`use graph
fun S next = array "end"
G = new graph with next .directed
R = G "start" "end" 1 bfs
R .path`)).toBe('start end');
        expect(run(prelude + 'R = G 1 1.0 0 bfs\nR .status')).toBe('.reached');
    });

    it('rejects unbounded algorithms, mutation, size and direct adjacency', () => {
        for (const query of ['G 0 bfs', 'G 0 dfs', 'G 0 dijkstra']) {
            expect(() => run(prelude + query)).toThrow('successor graph requires bounded BFS');
        }
        for (const query of ['G components', 'G floyd', 'G 0 1 edgeweight', 'G 0 1 2 trips']) {
            expect(() => run(prelude + query)).toThrow('graph algorithm requires an explicit graph');
        }
        expect(() => run(prelude + 'G len')).toThrow('successor graph has no total size');
        expect(() => run(prelude + 'G 0 1 adjacent')).toThrow('does not support direct adjacency');
        expect(() => run(prelude + 'G add 0 1')).toThrow('successor graph is read-only');
    });

    it('validates callback arity, direction, states, budget and successor shape', () => {
        expect(() => run(prelude + 'new graph with next .undirected')).toThrow('successor graph requires .directed');
        expect(() => run('use graph\nfun A B two = true\nnew graph with two .directed')).toThrow('expects one argument');
        expect(() => run('use graph\nnew graph with 3 .directed')).toThrow('expects a function');
        for (const limit of ['-1', '1.0', 'true']) {
            expect(() => run(prelude + `G 0 5 ${limit} bfs`)).toThrow('limit must be a nonnegative integer');
        }
        expect(() => run(prelude + 'G (array 1 2) 5 10 bfs')).toThrow('vertices must be scalar');
        expect(() => run(prelude + 'G 0 (array 1 2) 10 bfs')).toThrow('vertices must be scalar');
        for (const body of ['true', '(1 to 4) reshape 2 2', 'primes']) {
            expect(() => run(`use graph\nuse sequences\nfun N bad = ${body}\nG = new graph with bad .directed\nG 0 1 10 bfs`))
                .toThrow(/rank-1|finite sequence/);
        }
    });

    it('stops before a failing tail and preserves recursive callback depth checks', () => {
        expect(run(`use graph
fun N next
  yield 1
  .Unexpected "tail must not run" raise
end
G = new graph with next .directed
R = G 0 1 1 bfs
R .status`)).toBe('.reached');
        const runtime = new Interpreter(undefined, { compilation, maxCallDepth: 4 });
        try {
            expect(() => runtime.execute(`use graph
fun N recursive
  G N 10 1 bfs
  return array 1
end
G = new graph with recursive .directed
G 0 10 1 bfs`)).toThrow(/depth/i);
        } finally { runtime.dispose(); }
    });

    it('preserves nested callback lifetime and allows eager results to escape', () => {
        const source = `use graph
use sequences
fun Offset build
  fun N next = array (N + Offset)
  G = new graph with next .directed
`;
        expect(run(source + '  return G 0 6 4 bfs\nend\nR = 2 build\nR .path')).toBe('0 2 4 6');
        for (const result of ['G', 'G 0']) {
            expect(() => run(source + `  return ${result}\nend\n2 build`)).toThrow('lazy result retains nested function next');
        }
    });

    it('preserves callback errors and module ownership', () => {
        expect(() => run(`use graph
fun N broken
  .Broken "bad move" raise
end
G = new graph with broken .directed
G 0 1 10 bfs`)).toThrow('bad move');
        const runtime = new Interpreter(undefined, { compilation, loadModule: () => ({ id: 'moves.ra', source: `use graph
use sequences
fun N next = (N + 1) to (N + 2)
fun build = new graph with next .directed` }) });
        try {
            expect(formatValue(runtime.execute('use "moves.ra"\nuse graph\nG = build\nR = G 0 3 10 bfs\nR .path')!)).toBe('0 1 3');
        } finally { runtime.dispose(); }
    });
});

it('bounds even unknown-size duplicate streams and closes the iterator on limit/goal', () => {
    for (const goal of [0n, 1n]) {
        let consumed = 0, closed = 0;
        const fn = native('next', 1, () => ({ kind: 'sequence', plan: {
            name: 'duplicates', size: { kind: 'unknown' },
            *iterate() { try { while (true) { consumed++; yield 1n; } } finally { closed++; } },
        } }));
        const graph = new SuccessorGraph({ kind: 'label', name: 'directed' }, fn, value => fn.call([value]));
        const result = boundedBreadthFirst(graph, 2n, goal, 3n);
        expect(result.entries.get('status')).toEqual({ kind: 'label', name: goal === 1n ? 'reached' : 'limit' });
        expect(consumed).toBe(goal === 1n ? 1 : 3);
        expect(closed).toBe(1);
    }
});

it('preserves cancellation during expansion', () => {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const fn = native('next', 1, () => { Atomics.store(signal, 0, 1); return { kind: 'array', shape: [1], items: [1n] }; });
    const graph = new SuccessorGraph({ kind: 'label', name: 'directed' }, fn, value => fn.call([value]));
    expect(() => withInterrupt(signal, () => boundedBreadthFirst(graph, 0n, 9n, 100000n))).toThrow(InterruptedError);
});
