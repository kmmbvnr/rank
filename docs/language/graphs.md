# Graphs

`use graph` provides a mutable graph value for traversal algorithms. Its public
behavior does not expose adjacency-list, CSR or other physical storage.

## Construction

A closed graph receives its complete finite vertex domain. This includes
isolated vertices and makes an unknown endpoint an error:

```rank
use graph
use ranges

Nodes = 1 to NodeCount
Graph = new graph Nodes .undirected
```

An open graph starts empty and registers endpoints as edges arrive:

```rank
Graph = new graph .directed
Graph add From To
```

Direction is always explicit. `.directed` stores only `From` to `To`;
`.undirected` also makes `From` a neighbor of `To`. A self-loop appears once in
an undirected neighbor sequence. Parallel edges are preserved.

Vertices are integer, real, boolean, text or symbol scalars. A finite rank-1
array or sequence supplies several vertices to either the closed constructor or
`add`. The latter is useful for isolated vertices in an open graph:

```rank
Graph add Node
Graph add Nodes
```

A rank-2 array with shape `M 2` supplies `M` edges:

```rank
Edges = array shape 3 2
  1 2
  2 4
  4 1
end
Graph add Edges
```

An edge has weight `1` unless `add` supplies a numeric weight. Weighted bulk
input has shape `M 3`, with source, target and weight columns:

```rank
Graph add From To Cost

Flights = array shape 2 3
  1 2 6
  2 3 -4
end
Graph add Flights
```

Integer and real weights are accepted. Negative weights are preserved for
algorithms such as Bellman-Ford; the graph does not choose an algorithm or
interpret their sign.

`Graph add A B` and `Graph add Edges` dispatch only after `Graph` evaluates to
a graph. The word `add` remains available to user functions and other
collections.

## Neighbors and size

Address a graph with one vertex to obtain a finite lazy sequence of its
neighbors:

```rank
for Next in Graph Current
  queue push Next
end
```

The sequence is a snapshot of that vertex's neighbors when `Graph Current` is
evaluated. Later graph mutations do not change an existing sequence. Neighbor
order follows edge insertion order.

The contextual `edges` method returns the same outgoing entries as lazy
rank-1 pairs `array Next Cost`. `unpack` gives readable access without changing
the compact neighbor form:

```rank
for Edge in Graph edges Current
  unpack Next Cost = Edge
end
```

For an undirected graph, the reverse entry has the same weight. Unweighted
entries appear with cost `1`. Like `add`, `edges` dispatches only when its
receiver evaluates to a graph and does not reserve the word for other values.

For an open graph, an unknown vertex has an empty neighbor sequence and does not
register the vertex. A closed graph raises `.Missing` for an unknown vertex.
`Graph len` returns the vertex count, and `Graph type` returns `.graph`.

Graphs are reference values: assignment and argument passing share mutations.
Removing vertices or edges is not part of the current API.

## Disjoint sets

`use graph` also provides a mutable disjoint-set union structure. A closed DSU
starts with a finite rank-1 collection and rejects unknown values:

```rank
Union = new dsu Nodes
Union merge A B
Root = Union find A
Same = Union connected A B
Count = Union components
```

`merge` uses union by size and returns true only when it combines two previous
components. `find` returns the representative value selected by the structure;
`connected` compares representatives. `components` returns the current number
of components, while `len` returns the number of registered values.

`new dsu` without a collection creates an open DSU. `find`, `merge`, and
`connected` register unknown scalar values before answering. DSU values may be
integer, real, boolean, text, or symbols, like graph vertices. The method words
dispatch only when their receiver is a DSU and remain available to ordinary
user functions.

## Basic algorithms

Graph algorithms are ordinary data-first functions exported by `use graph`.
They operate on the abstract graph value and may choose a different internal
representation in future implementations.

`Graph Start bfs` traverses outgoing unweighted edges in breadth-first order;
`Graph Start dfs` uses depth-first order without consuming the host call stack.
`Graph Start dijkstra` computes shortest distances for nonnegative numeric
weights and rejects a negative edge. All three return a record with three fields:

- `.distance`: an index from every reached vertex to its distance;
- `.parent`: an index containing the search-tree parent of each reached vertex
  except the start;
- `.order`: vertices in discovery order for BFS and settlement order for
Dijkstra.

```rank
Result = Graph Start dijkstra
Distance = Result .distance
Answer = Distance Target pad infinity
```

`Graph components` accepts an undirected graph and returns `.count`, a
`.component` index numbered from one in vertex insertion order, and a `.roots`
array. `Graph bipartite` also accepts an undirected graph and returns
`.possible` plus a `.color` index whose values are one or two. An odd cycle
makes `.possible` false.

`Graph topological` accepts a directed graph. It returns `.possible` and an
`.order` array. A directed cycle makes `.possible` false and `.order` empty.
`Graph scc` finds strongly connected components of a directed graph and returns
the same `.count`, `.component`, and `.roots` fields as `components`.

All indices use the graph's scalar vertices as keys. Missing distances and
parents remain missing values, so existing `pad` handling applies.

`Graph Start bellmanford` accepts negative weights. Its `.distance` and
`.parent` indices cover vertices reachable from `Start`; `.negative` is a set
of every reachable vertex whose shortest distance is unbounded below because
of a reachable negative cycle. Distances stored for those vertices are
intermediate values and must not be used as shortest paths.

`Graph floyd` computes all-pairs shortest paths and returns `.distance` as a
two-key index addressed by `Distance From To`. Missing pairs are unreachable.
Its `.negative` set contains vertices that lie on a negative cycle.

`Graph mst` accepts an undirected weighted graph and applies Kruskal's
algorithm. It returns `.connected`, `.components`, total `.weight`, and
`.edges` as an `M` by `3` array. For a disconnected graph these fields describe
the minimum spanning forest and `.connected` is false. Parallel edges are
eligible independently; self-loops are never selected.
