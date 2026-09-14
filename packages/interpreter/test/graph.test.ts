import { describe, expect, it } from 'vitest';
import { MissingValueError, RankError } from '../src/errors.js';
import { run } from './support.js';

const prelude = 'use graph\nuse sequences\n';

describe('graphs', () => {
    it('prepares rooted tree traversal data', () => {
        expect(run(`${prelude}Tree = new graph (1 to 5) .undirected
Tree add (array shape 4 2
  1 2
  1 3
  3 4
  3 5
end)
Rooted = Tree 1 root
Parent = Rooted .parent
Depth = Rooted .depth
Entry = Rooted .entry
Size = Rooted .size
Head = Rooted .head
array (Rooted .root) (Rooted .order) (Parent 4) (Depth 4) (Entry 4) (Size 3) (Head 4) (Head 5)
`)).toBe('1 1 3 4 5 2 3 2 2 3 1 5');
    });

    it('answers rooted ancestor, LCA and distance queries', () => {
        expect(run(`${prelude}Tree = new graph (1 to 7) .undirected
Tree add (array shape 6 2
  1 2
  1 3
  2 4
  2 5
  3 6
  6 7
end)
Rooted = Tree 1 root
A = Rooted 7 2 ancestor
B = Rooted 4 5 lca
C = Rooted 4 7 lca
D = Rooted 5 7 distance
array A B C D
`)).toBe('3 2 1 5');
    });

    it('pads a missing rooted ancestor', () => {
        expect(run(`${prelude}Tree = new graph (1 to 3) .undirected
Tree add 1 2
Tree add 2 3
Rooted = Tree 1 root
array (Rooted 3 2 ancestor) (Rooted 3 3 ancestor pad -1)
`)).toBe('1 -1');
    });

    it('requires an undirected connected tree', () => {
        expect(() => run(`${prelude}Tree = new graph (1 to 2) .directed
Tree add 1 2
Tree 1 root
`)).toThrow('root expects an undirected graph');
        expect(() => run(`${prelude}Tree = new graph (1 to 4) .undirected
Tree add 1 2
Tree add 1 2
Tree add 3 4
Tree 1 root
        `)).toThrow('root expects a connected tree');
    });

    it('exposes lazy unordered tree path lengths', () => {
        expect(run(`${prelude}Tree = new graph (1 to 5) .undirected
Tree add (array shape 4 2
  1 2
  1 3
  3 4
  3 5
end)
Lengths = Tree pathlengths
Exact = Lengths equal 2
Near = Lengths at least 1
Near and= Lengths at most 2
array (Exact count) (Near count) (Lengths array)
`)).toBe('4 8 1 1 2 2 2 3 3 1 1 2');
    });

    it('plans reversed path-length comparisons', () => {
        expect(run(`${prelude}Tree = new graph (1 to 4) .undirected
Tree add 1 2
Tree add 2 3
Tree add 3 4
Lengths = Tree pathlengths
array ((2 equal Lengths) count) ((2 at least Lengths) count)
        `)).toBe('2 5');
    });

    it('matches enumerated path-length ranges', () => {
        for (const [low, high] of [[1, 1], [2, 4], [3, 7], [8, 20]]) {
            expect(run(`${prelude}Tree = new graph (1 to 9) .undirected
Tree add (array shape 8 2
  1 2
  1 3
  2 4
  2 5
  3 6
  6 7
  6 8
  8 9
end)
Lengths = Tree pathlengths
Values = Lengths array
Expected = Values at least ${low}
Expected and= Values at most ${high}
Actual = Lengths at least ${low}
Actual and= Lengths at most ${high}
(Expected count) equal (Actual count)
`)).toBe('true');
        }
    });

    it('handles a tree without vertex pairs', () => {
        expect(run(`${prelude}
Tree = new graph (array 1) .undirected
Lengths = Tree pathlengths
array (Lengths len) ((Lengths equal 1) count)
`)).toBe('0 0');
    });

    it('validates path-length tree inputs', () => {
        expect(() => run(`${prelude}
Tree = new graph .directed
Tree add 1 2
Tree pathlengths
`)).toThrow('pathlengths expects an undirected graph');
        expect(() => run(`${prelude}Tree = new graph (1 to 3) .undirected
Tree add 1 2
Tree add 2 3
Tree add 3 1
Tree pathlengths
`)).toThrow('pathlengths expects a tree');
    });

    it('prepares and jumps through a functional graph', () => {
        expect(run(`${prelude}
Next = array 2 3 1 5 5
Planets = Next functional
array (Planets jump 1 1000000000) (Planets jump 4 100)
`)).toBe('2 5');
    });

    it('finds directed functional-graph distances', () => {
        expect(run(`${prelude}
Next = array 2 3 1 5 5 7 6 7
Planets = Next functional
array (Planets distance 1 3) (Planets distance 3 2) (Planets distance 8 6)
`)).toBe('2 2 2');
    });

    it('pads unreachable functional-graph distances', () => {
        expect(run(`${prelude}
Next = array 2 3 1 5 5
Planets = Next functional
array (Planets distance 5 4 pad -1) (Planets distance 1 5 pad -1)
`)).toBe('-1 -1');
    });

    it('reports functional-graph orbit lengths', () => {
        expect(run(`${prelude}
Next = array 2 3 1 5 5 7 6 7
Planets = Next functional
Planets lengths
`)).toBe('3 3 3 2 1 2 2 3');
    });

    it('counts increasing vertices through a limit', () => {
        expect(run(`${prelude}
Next = array 2 3 5 5 5
Path = Next functional
Result = array shape 4
  (Path 1 3 upto) (Path 1 4 upto)
  (Path 1 5 upto) (Path 4 5 upto)
end
Result
`)).toBe('3 3 4 2');
        expect(() => run(`${prelude}
Path = (array 2 1) functional
Path 1 2 upto
`)).toThrow('upto requires increasing successors');
    });

    it('aggregates increasing weighted paths', () => {
        expect(run(`${prelude}
Next = array 2 3 5 5 5
Cost = array 10 20 30 40 0
Path = Next Cost weighted
A = Path 1 3 upto
B = Path 1 4 upto
C = Path 4 5 upto
Result = array shape 9
  (A .count) (A .sum) (A .last)
  (B .count) (B .sum) (B .last)
  (C .count) (C .sum) (C .last)
end
Result
`)).toBe('3 30 3 3 30 3 2 40 5');
    });

    it('validates weighted paths', () => {
        expect(() => run(`${prelude}
Next = array 2 2
Next (array 1) weighted
`)).toThrow(
            'weighted successors and weights must have equal length',
        );
        expect(() => run(`${prelude}
Next = array 2 2
Next (array 1 "x") weighted
`)).toThrow('weighted requires numeric weights');
    });

    it('allows a user function named weighted', () => {
        expect(run(`${prelude}
fun weighted A B
  return A + B
end
3 4 weighted
`)).toBe('7');
    });

    it('validates functional successor arrays', () => {
        expect(() => run(`${prelude}(array 2 4 1) functional`))
            .toThrow('functional successors must be integers from 1 to N');
        expect(() => run(`${prelude}(array shape 1 2 pad 1) functional`))
            .toThrow('functional expects a rank-1 successor array');
    });

    it('keeps functional method words contextual', () => {
        expect(run(`
fun jump A B C
  return A + B + C
end
1 jump 2 3
`)).toBe('6');
    });

    it('merges and queries a closed DSU', () => {
        expect(run(`${prelude}Union = new dsu (1 to 5)
A = Union merge 1 2
B = Union merge 2 3
C = Union merge 1 3
Root = Union find 3
array A B C (Union connected 1 3) (Union connected 1 4) Root (Union components) (Union len)
`)).toBe('true true false true false 1 3 5');
    });

    it('grows an open DSU on demand', () => {
        expect(run(`${prelude}
Union = new dsu
Union merge "a" "b"
Union find "alone"
array (Union components) (Union len) (Union connected "a" "b")
`)).toBe('2 3 true');
    });

    it('rejects unknown closed DSU values', () => {
        expect(() => run(`${prelude}
Union = new dsu (array 1 2)
Union find 3
`)).toThrow('dsu does not contain the value');
    });

    it('keeps DSU method words contextual', () => {
        expect(run(`
fun find A B
  return A + B
end
3 find 4
`)).toBe('7');
    });

    it('creates a closed undirected graph', () => {
        expect(run(prelude + `
Nodes = 1 to 4
Graph = new graph Nodes .undirected
Graph add 1 2
Graph add 2 3
array (Graph len) ((Graph 2) array)
`)).toBe('4 1 3');
    });

    it('runs breadth-first search', () => {
        expect(run(`${prelude}Graph = new graph (1 to 5) .directed
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
        expect(run(`${prelude}Graph = new graph (1 to 5) .directed
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
        expect(run(`${prelude}Graph = new graph (1 to 5) .undirected
Graph add 1 2
Graph add 3 4
Result = Graph components
Component = Result .component
array (Result .count) (Component 2) (Component 4) (Component 5) (Result .roots)
`)).toBe('3 1 2 3 1 3 5');
    });

    it('colors bipartite graphs and rejects odd cycles', () => {
        expect(run(`${prelude}Graph = new graph (1 to 4) .undirected
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
        expect(run(`${prelude}use numbers
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

    it('runs Bellman-Ford with negative edges', () => {
        expect(run(`${prelude}use numbers
Graph = new graph (1 to 4) .directed
Graph add 1 2 4
Graph add 1 3 5
Graph add 2 3 (-2)
Result = Graph 1 bellmanford
Distance = Result .distance
array (Distance 3) ((Result .negative) len) (Distance 4 pad infinity)
`)).toBe('2 0 infinity');
    });

    it('marks vertices after reachable negative cycles', () => {
        expect(run(`${prelude}Graph = new graph (1 to 5) .directed
Graph add 1 2 1
Graph add 2 3 (-2)
Graph add 3 2 1
Graph add 3 4 1
Graph add 5 5 (-1)
Result = Graph 1 bellmanford
Negative = Result .negative
array (2 in Negative) (3 in Negative) (4 in Negative) (5 in Negative)
`)).toBe('true true true false');
    });

    it('topologically sorts a DAG and reports a cycle', () => {
        expect(run(`${prelude}Graph = new graph (1 to 4) .directed
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

    it('restores directed and undirected cycles', () => {
        expect(run(`${prelude}Directed = new graph (1 to 4) .directed
Directed add 1 2
Directed add 2 3
Directed add 3 1
Undirected = new graph (1 to 3) .undirected
Undirected add 1 2
Undirected add 1 2
array (Directed cycle) (Undirected cycle)
`)).toBe('1 2 3 1 1 2 1');
    });

    it('returns an empty array for an acyclic graph', () => {
        expect(run(`${prelude}Graph = new graph (1 to 4) .directed
Graph add 1 2
Graph add 2 3
(Graph cycle) shape
`)).toBe('0');
    });

    it('finds directed and undirected Euler trails', () => {
        expect(run(`${prelude}Directed = new graph (1 to 3) .directed
Directed add 1 2
Directed add 1 3
Directed add 2 1
Undirected = new graph (1 to 2) .undirected
Undirected add 1 2
Undirected add 1 2
array (Directed 1 euler) (Undirected 1 euler)
`)).toBe('1 2 1 3 1 2 1');
    });

    it('handles Euler self-loops and empty graphs', () => {
        expect(run(`${prelude}Loop = new graph (1 to 1) .undirected
Loop add 1 1
Empty = new graph (1 to 2) .directed
array (Loop 1 euler) (Empty 2 euler)
`)).toBe('1 1 2');
    });

    it('rejects incomplete Euler walks', () => {
        expect(run(`${prelude}Branch = new graph (1 to 3) .directed
Branch add 1 2
Branch add 1 3
Split = new graph (1 to 4) .undirected
Split add 1 2
Split add 3 4
array ((Branch 1 euler) shape) ((Split 1 euler) shape)
`)).toBe('0 0');
    });

    it('keeps euler available to user functions', () => {
        expect(run(`
fun euler A B
  return A + B
end
3 4 euler
`)).toBe('7');
    });

    it('finds strongly connected components', () => {
        expect(run(`${prelude}Graph = new graph (1 to 6) .directed
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

    it('computes all-pairs shortest paths', () => {
        expect(run(`${prelude}use numbers
Graph = new graph (1 to 3) .directed
Graph add 1 2 5
Graph add 2 3 (-2)
Graph add 1 3 9
Result = Graph floyd
Distance = Result .distance
array (Distance 1 3) (Distance 3 1 pad infinity) ((Result .negative) len)
`)).toBe('3 infinity 0');
    });

    it('builds a minimum spanning tree', () => {
        expect(run(`${prelude}Graph = new graph (1 to 4) .undirected
Graph add 1 2 5
Graph add 1 3 1
Graph add 3 2 2
Graph add 2 4 3
Result = Graph mst
array (Result .connected) (Result .components) (Result .weight) ((Result .edges) shape)
`)).toBe('true 1 6 3 3');
    });

    it('returns a minimum spanning forest', () => {
        expect(run(`${prelude}Graph = new graph (1 to 4) .undirected
Graph add 1 2 4
Graph add 3 4 7
Result = Graph mst
array (Result .connected) (Result .components) (Result .weight)
`)).toBe('false 2 11');
    });

    it('computes maximum flow and a minimum cut', () => {
        expect(run(`${prelude}Graph = new graph (1 to 4) .directed
Graph add 1 2 3
Graph add 1 3 2
Graph add 2 3 1
Graph add 2 4 2
Graph add 3 4 4
Result = Graph 1 4 maxflow
Flow = Result .flow
Cut = Result .cut
array (Result .value) (Flow 1 2) (Flow 1 3) (1 in Cut) (2 in Cut)
`)).toBe('5 3 2 true false');
    });

    it('aggregates parallel flow edges', () => {
        expect(run(`${prelude}Graph = new graph (1 to 2) .directed
Graph add 1 2 2
Graph add 1 2 3
Result = Graph 1 2 maxflow
Flow = Result .flow
array (Result .value) (Flow 1 2)
`)).toBe('5 5');
    });

    it('validates maximum-flow networks', () => {
        expect(() => run(`${prelude}
Graph = new graph .undirected
Graph add 1 2 3
Graph 1 2 maxflow
`)).toThrow('maxflow expects a directed graph');
        expect(() => run(`${prelude}
Graph = new graph .directed
Graph add 1 2 (-1)
Graph 1 2 maxflow
`)).toThrow('maxflow requires finite nonnegative capacities');
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
