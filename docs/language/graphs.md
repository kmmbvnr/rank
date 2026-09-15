# Graphs

`use graph` provides a mutable graph value for traversal algorithms. Its public
behavior does not expose adjacency-list, CSR or other physical storage.

## Construction

A closed graph receives its complete finite vertex domain. This includes
isolated vertices and makes an unknown endpoint an error:

```rank
use graph

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

## Functional graphs

A rank-1 successor array can prepare a functional graph whose vertices are the
integers from `1` through `N`. Item `I - 1` is the sole outgoing successor of
vertex `I`, and every successor must also lie in `1..N`:

```rank
Planets = Next functional
End = Planets jump Start Steps
Steps = Planets distance From To
Lengths = Planets lengths
Count = Planets Start Limit upto
Weighted = Next Cost weighted
State = Weighted Start Limit upto
```

`jump` follows exactly the requested nonnegative number of transitions and
accepts arbitrarily large integers. Its cached binary-lifting table grows only
to the largest requested bit. `distance` returns the minimum number of forward
transitions from `From` to `To`; an unreachable target is missing and composes
with `default`:

```rank
Steps = Planets distance From To default -1
```

`lengths` returns a rank-1 integer array aligned with the successor array. Each
item is the number of distinct vertices visited from that vertex before the
first repeated vertex. Construction decomposes the graph into cycles and their
incoming trees once; queries do not mutate the value.

`upto` counts vertices on the path from `Start` whose numbers do not exceed
`Limit`, including the start when it is in range. It requires every successor
to be either its own vertex or a larger vertex. This makes the path monotone,
so the cached jump table answers each query in `O(log N)` time. It returns zero
when `Start` exceeds `Limit`. Next-greater links are a typical use.

`Next Cost weighted` prepares the same increasing successor path with one
numeric outgoing-edge cost per vertex. Its `upto` result is a record:

- `.count` is the number of visited vertices;
- `.sum` is the sum of traversed edge costs;
- `.last` is the last visited vertex.

The edge leaving `.last` is not traversed and is not included in `.sum`.
Integer costs keep an integer sum; any real cost produces a real sum. The
successor and cost arrays must have equal lengths. Weighted jump sums grow
alongside the same lazy binary-lifting table.

This API is experimental. It stays in the graph library while examples beyond
the adjacent CSES functional-graph tasks test whether the prepared object is a
useful general abstraction. If later programs do not reuse the combined
`jump`, `distance`, `lengths`, `upto`, and `weighted` interface, simplify it to independent
operations or remove it before treating the API as stable.

## Rooted trees

`Tree Root root` prepares an immutable rooted view of a connected undirected
tree. The source graph may use any supported scalar vertices. Preparation
validates that the graph is a tree, takes `O(N log N)` time and snapshots its
current edges:

```rank
Rooted = Tree 1 root
Boss = Rooted Employee K ancestor
Common = Rooted A B lca
Length = Rooted A B distance
```

The query words use the same data-first postfix form as
`Tree Left Right query`. `ancestor` returns the vertex `K` parent edges above
the requested vertex. An ancestor above the root is missing and composes with
`default`. `lca` returns the lowest common ancestor, and `distance` returns the
number of edges between two vertices. Each query takes `O(log N)` time.

The prepared value is a record with these fields:

- `.root`: the selected root vertex;
- `.parent`: an index of parent vertices, with no entry for the root;
- `.depth`: an index of distances from the root;
- `.order`: vertices in heavy-first depth-first preorder;
- `.entry`: an index of zero-based positions in `.order`;
- `.size`: an index of subtree sizes;
- `.head`: an index of heavy-path head vertices.

A vertex's subtree occupies the contiguous half-open interval beginning at its
`.entry` position and containing `.size` items. This supports flattening
subtree operations into ordinary range operations. The record and its indices
are read-only snapshots; later graph mutations do not change them.
The largest child subtree is visited first. Consequently, vertices from any
one heavy path also occupy consecutive `.entry` positions; `.head` identifies
the first vertex of that path for heavy-light decomposition.

## Pair distances

`Tree pathlengths` snapshots a connected undirected tree and returns a finite
lazy sequence containing the edge distance between every unordered pair of
distinct vertices. Each pair occurs once, and an `N`-vertex tree therefore has
`N * (N - 1) // 2` logical path lengths:

```rank
Lengths = Tree pathlengths
Exact = (Lengths equal K) count
Mask = Lengths at least Low
Mask and= Lengths at most High
Within = Mask count
```

Iteration or materialization enumerates the logical sequence and takes
quadratic time. Integer comparisons followed by `count` are planned without
materializing it. Exact and bounded-range counts use centroid decomposition in
`O(N log^2 N)` time and `O(N)` auxiliary space. Comparisons may be written on
either side of the sequence, and bounds combined with `and` remain visible to
the planner. Arbitrary predicates and `or`, `xor`, or `not` compositions fall
back to ordinary lazy enumeration.

The values count edges, like rooted-tree `distance`; stored graph weights do
not alter them. The sequence deliberately discards pair endpoints. Use
`Rooted A B distance` when a particular pair or its vertices matter.

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
Answer = Distance Target default infinity
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
parents remain missing values, so existing `default` handling applies.

`Graph cycle` returns one cycle from either a directed or undirected graph as a
rank-1 array. The first vertex is repeated at the end, so each adjacent pair is
an edge in traversal order. An acyclic graph returns an empty array. Search is
iterative; self-loops and cycles formed by parallel undirected edges are
preserved.

`Graph Start euler` returns an Euler trail that begins at `Start` and uses every
edge exactly once. It works for directed and undirected graphs, infers the end
vertex from the degree balances, and returns an empty rank-1 array when no such
trail exists. A graph without edges returns `array Start`. Parallel edges and
self-loops remain distinct, edge weights do not affect the trail, and equal
inputs produce insertion-order-stable results. The iterative search takes
`O(V + E)` time and does not mutate the graph.

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

`Graph Source Sink maxflow` accepts a directed graph whose weights are finite,
nonnegative capacities. Source and sink must differ. It uses a level-graph
blocking-flow algorithm and returns:

- `.value`, the maximum flow value;
- `.flow`, a two-key index addressed by `Flow From To`, with parallel-edge
  flows aggregated and absent pairs readable through `default 0`;
- `.cut`, the set of vertices reachable from `Source` in the final residual
  graph, which is the source side of a minimum cut.
