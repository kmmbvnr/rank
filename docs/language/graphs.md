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

For an open graph, an unknown vertex has an empty neighbor sequence and does not
register the vertex. A closed graph raises `.Missing` for an unknown vertex.
`Graph len` returns the vertex count, and `Graph type` returns `.graph`.

Graphs are reference values: assignment and argument passing share mutations.
Removing vertices or edges is not part of the current API.
