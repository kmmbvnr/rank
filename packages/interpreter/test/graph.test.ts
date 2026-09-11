import { describe, expect, it } from 'vitest';
import { MissingValueError, RankError } from '../src/errors.js';
import { run } from './support.js';

const prelude = 'use graph\nuse sequences\n';

describe('graphs', () => {
    it('creates a closed undirected graph', () => {
        expect(run(prelude + `
use ranges
Nodes = 1 to 4
Graph = new graph Nodes .undirected
Graph add 1 2
Graph add 2 3
array (Graph len) ((Graph 2) array)
`)).toBe('4 1 3');
    });

    it('runs breadth-first search', () => {
        expect(run(`${prelude}use ranges
Graph = new graph (1 to 5) .directed
Graph add (array shape 5 2
  1 2
  1 3
  2 4
  3 4
  4 5
end)
Result = Graph 1 bfs
Distance = Result .distance
Parent = Result .parent
array (Distance 5) (Parent 5) (Result .order)
`)).toBe('3 4 1 2 3 4 5');
    });

    it('runs iterative depth-first search', () => {
        expect(run(`${prelude}use ranges
Graph = new graph (1 to 5) .directed
Graph add (array shape 5 2
  1 2
  1 3
  2 4
  3 5
  4 5
end)
Result = Graph 1 dfs
Distance = Result .distance
array (Result .order) (Distance 5)
`)).toBe('1 2 4 5 3 3');
    });

    it('finds undirected components', () => {
        expect(run(`${prelude}use ranges
Graph = new graph (1 to 5) .undirected
Graph add 1 2
Graph add 3 4
Result = Graph components
Component = Result .component
array (Result .count) (Component 2) (Component 4) (Component 5) (Result .roots)
`)).toBe('3 1 2 3 1 3 5');
    });

    it('colors bipartite graphs and rejects odd cycles', () => {
        expect(run(`${prelude}use ranges
Graph = new graph (1 to 4) .undirected
Graph add 1 2
Graph add 2 3
Graph add 3 4
Color = Graph bipartite
Colors = Color .color
Odd = new graph (1 to 3) .undirected
Odd add 1 2
Odd add 2 3
Odd add 3 1
Failure = Odd bipartite
array (Color .possible) (Colors 1) (Colors 2) (Colors 3) (Failure .possible)
`)).toBe('true 1 2 1 false');
    });

    it('runs Dijkstra with integer and real weights', () => {
        expect(run(`${prelude}use ranges
Graph = new graph (1 to 4) .directed
Graph add 1 2 5
Graph add 1 3 1.5
Graph add 3 2 1.5
Graph add 2 4 2
Result = Graph 1 dijkstra
Distance = Result .distance
Parent = Result .parent
array (Distance 2) (Distance 4) (Parent 2)
`)).toBe('3 5 3');
    });

    it('topologically sorts a DAG and reports a cycle', () => {
        expect(run(`${prelude}use ranges
Graph = new graph (1 to 4) .directed
Graph add 1 2
Graph add 1 3
Graph add 2 4
Graph add 3 4
Sorted = Graph topological
Cycle = new graph (1 to 2) .directed
Cycle add 1 2
Cycle add 2 1
Blocked = Cycle topological
array (Sorted .possible) (Sorted .order) (Blocked .possible)
`)).toBe('true 1 2 3 4 false');
    });

    it('finds strongly connected components', () => {
        expect(run(`${prelude}use ranges
Graph = new graph (1 to 6) .directed
Graph add 1 2
Graph add 2 1
Graph add 2 3
Graph add 3 4
Graph add 4 3
Graph add 4 5
Result = Graph scc
Part = Result .component
array (Result .count) (Part 1) (Part 2) (Part 3) (Part 4) (Part 5) (Part 6)
`)).toBe('4 2 2 3 3 4 1');
    });

    it('validates graph algorithm domains', () => {
        expect(() => run(`${prelude}
Graph = new graph .directed
Graph add 1 2 (-1)
Graph 1 dijkstra
`)).toThrow('dijkstra requires nonnegative edge weights');
        expect(() => run(`${prelude}
Graph = new graph .directed
Graph add 1 2
Graph components
`)).toThrow('components expects an undirected graph');
        expect(() => run(`${prelude}
Graph = new graph .directed
Graph add 1 2
Graph bipartite
`)).toThrow('bipartite expects an undirected graph');
    });

    it('requires graph imports for algorithms', () => {
        expect(() => run('1 2 bfs'))
            .toThrow('did you forget `use graph`');
    });

    it('grows an open graph and keeps isolated vertices', () => {
        expect(run(prelude + `
Graph = new graph .undirected
Graph add "A" "B"
Graph add "alone"
array (Graph len) ((Graph "B") array)
`)).toBe('3 A');
    });

    it('adds rank-1 vertices and M by 2 edges', () => {
        expect(run(prelude + `
Graph = new graph .directed
Graph add (array 1 2 3 4)
Edges = array shape 3 2
  1 2
  1 3
  3 4
end
Graph add Edges
array ((Graph 1) array) ((Graph 3) array)
`)).toBe('2 3 4');
    });

    it('preserves parallel edges and one self neighbor', () => {
        expect(run(prelude + `
Graph = new graph .undirected
Graph add 1 2
Graph add 1 2
Graph add 1 1
(Graph 1) array
`)).toBe('2 2 1');
    });

    it('returns a finite lazy snapshot of neighbors', () => {
        expect(run(prelude + `
Graph = new graph .directed
Graph add 1 2
Neighbors = Graph 1
Graph add 1 3
array (Neighbors len) (Neighbors array)
`)).toBe('1 2');
    });

    it('rejects vertices outside a closed domain', () => {
        expect(() => run(prelude + `
Graph = new graph (array 1 2) .directed
Graph add 2 3
`)).toThrow(MissingValueError);
        expect(() => run(prelude + `
Graph = new graph (array 1 2) .directed
Graph 3
`)).toThrow(MissingValueError);
    });

    it('validates direction, shape and vertex types', () => {
        expect(() => run('use graph\nnew graph .sideways'))
            .toThrow('new graph expects .directed or .undirected');
        expect(() => run(prelude + `
Graph = new graph .directed
Graph add (array shape 2 4 pad 0)
`)).toThrow('graph edge array must have shape M by 2 or M by 3');
        expect(() => run(prelude + `
Graph = new graph .directed
Graph add (array shape 1 1 1 pad 0)
`)).toThrow(RankError);
    });

    it('requires use graph and does not reserve add', () => {
        expect(() => run('new graph .directed'))
            .toThrow('new graph requires: use graph');
        expect(run(`
fun add A B
  return A + B
end
3 4 add
`)).toBe('7');
    });

    it('stores weighted edges and exposes lazy pairs', () => {
        expect(run(prelude + `
Graph = new graph .directed
Graph add 1 2 7
Graph add 1 3
Edges = Graph edges 1
First = Edges 0
Second = Edges 1
array (First 0) (First 1) (Second 0) (Second 1)
`)).toBe('2 7 3 1');
    });

    it('adds weighted M by 3 edge arrays', () => {
        expect(run(prelude + `
Graph = new graph .undirected
Edges = array shape 2 3
  1 2 11
  2 3 -4
end
Graph add Edges
Back = Graph edges 2
array ((Back 0) 0) ((Back 0) 1) ((Back 1) 0) ((Back 1) 1)
`)).toBe('1 11 3 -4');
    });

    it('requires numeric weights and keeps edges contextual', () => {
        expect(() => run(prelude + `
Graph = new graph .directed
Graph add 1 2 "heavy"
`)).toThrow('graph edge weight must be numeric');
        expect(run(`
fun edges A B
  return A + B
end
3 edges 4
`)).toBe('7');
    });
});
