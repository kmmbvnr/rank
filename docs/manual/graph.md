# graph manual

## ancestor

The vertex K steps above another in a
rooted tree.

In the path 1 – 2 – 3 rooted at 1, one
step up from 3 is 2.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G 1 root
R 3 1 ancestor
```

```result
2
```

### Usage

```text
Rooted Vertex K ancestor
```

Rooted comes from root. K = 0 gives the
vertex itself.

### See also

root, lca, distance

## bellmanford

Shortest distances from a start vertex,
even when some edges have negative
weights.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2 4
G add 2 3 -1
R = G 1 bellmanford
R .distance 3
```

```result
3
```

### Usage

```text
Graph Start bellmanford
```

Gives a record: .distance and .parent
are looked up by vertex, and .negative
is the set of vertices affected by a
negative cycle, where no shortest
distance exists.

### Notes

If no weight is negative, dijkstra is
faster.

### See also

dijkstra, floyd, bfs

## bfs

Visit a graph level by level from a
start vertex, nearest first.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
R = G 1 bfs
R .distance 3
```

```result
2
```

### Usage

```text
Graph Start bfs
```

Gives a record: .distance counts edges
to each vertex, .parent is the vertex it
was reached from, and .order lists
vertices as they were visited. Edge
weights are ignored.

### See also

dfs, dijkstra, components

## bipartite

Check whether the vertices can be split
into two groups with every edge going
between the groups.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G bipartite
R .possible
```

```result
true
```

### Usage

```text
Graph bipartite
```

Gives a record: .possible is true or
false, and .color gives each vertex 0 or
1. Any cycle of odd length makes it
impossible.

### See also

components, cycle

## components

Find the groups of vertices that are
linked to each other.

Vertex 3 has no edges, so there are two
groups.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
R = G components
R .count
```

```result
2
```

### Usage

```text
Graph components
```

Gives a record: .count of groups,
.component with each vertex's group
number, and .roots with one vertex from
each group.

### See also

scc, merge, bfs

## connected

Check whether two values are in the same
group of a dsu.

```rank
use graph
D = new dsu
D 1 2 merge
D 1 2 connected
```

```result
true
```

### Usage

```text
Dsu A B connected
```

### See also

DSU merge, findroot, new

## cycle

Find a cycle: a path that returns to
where it started.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G add 3 1
G cycle
```

```result
1 2 3 1
```

### Usage

```text
Graph cycle
```

The first vertex is repeated at the end.
A graph without cycles gives an empty
array.

### See also

topological, bipartite

## dfs

Explore a graph by going as deep as
possible before backing up.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
R = G 1 dfs
R .order
```

```result
1 2 3
```

### Usage

```text
Graph Start dfs
```

Gives a record with .distance, .parent
and .order, the vertices in the order
they were reached.

### See also

bfs, cycle, topological

## dijkstra

Shortest distances from a start vertex
along weighted edges.

The direct edge 1 → 3 costs 20, but
going through 2 costs only 5 + 4 = 9.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2 5
G add 2 3 4
G add 1 3 20
R = G 1 dijkstra
R .distance 3
```

```result
9
```

### Usage

```text
Graph Start dijkstra
```

Gives a record: .distance to each
vertex, .parent to rebuild the path, and
.order. Weights cannot be negative.
Unreachable vertices have no distance.

### See also

bellmanford, bfs, floyd

## distance

How many edges apart two vertices are in
a rooted tree.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G 1 root
R 1 3 distance
```

```result
2
```

### Usage

```text
Rooted A B distance
```

Rooted comes from root. Also works on a
functional graph.

### See also

root, lca, ancestor

## euler

A route that uses every edge exactly
once.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G 1 euler
```

```result
1 2 3
```

### Usage

```text
Graph Start euler
```

Gives the vertices in order, or an empty
array if no such route exists from
Start.

### See also

cycle

## findroot

The vertex that represents a value's
group in a dsu.

```rank
use graph
D = new dsu
D 1 2 merge
D 2 findroot
```

```result
1
```

### Usage

```text
Dsu Value findroot
```

Two values are in the same group when
they have the same root. To compare,
connected is simpler.

### See also

connected, DSU merge

## floyd

Shortest distances between every pair of
vertices.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
R = G floyd
R .distance 1 3
```

```result
2
```

### Usage

```text
Graph floyd
```

Gives a record: read a distance with `R
.distance From To`. .negative holds
vertices caught in a negative cycle.
Practical for graphs of up to a few
hundred vertices.

### See also

dijkstra, bellmanford

## functional

A graph where every vertex has exactly
one next vertex.

Vertex 1 leads to 2, 2 to 3 and 3 back
to 1.

```rank
use graph
F = (array 2 3 1) functional
F 1 2 jump
```

```result
3
```

### Usage

```text
Next functional
```

Item i of Next is the vertex after
vertex i. Vertices are numbered from 1,
not from 0. Use it with jump, lengths,
distance and upto.

### See also

jump, lengths, upto, weighted

## jump

Where you end up after following N steps
in a functional graph.

```rank
use graph
F = (array 2 3 1) functional
F 1 2 jump
```

```result
3
```

### Usage

```text
F Start Steps jump
```

Fast even for billions of steps.

### See also

functional, lengths

## lca

The lowest vertex that is above both of
two vertices in a rooted tree.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G 1 root
R 2 3 lca
```

```result
2
```

### Usage

```text
Rooted A B lca
```

Rooted comes from root. If one vertex is
above the other, that vertex is the
answer.

### See also

root, ancestor, distance

## lengths

For each vertex of a functional graph,
how many different vertices you visit
before repeating.

```rank
use graph
F = (array 2 3 1) functional
F lengths
```

```result
3 3 3
```

### Usage

```text
F lengths
```

Gives one number per vertex, counting
the starting vertex.

### See also

functional, jump

## maxflow

The most that can flow from a source to
a sink when edges have capacities.

The 4 on the second edge limits the
flow.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2 5
G add 2 3 4
R = G 1 3 maxflow
R .value
```

```result
4
```

### Usage

```text
Graph Source Sink maxflow
```

Edge weights are the capacities. Gives a
record: .value is the total flow, .flow
the flow on each edge, and .cut the
vertices still reachable from Source,
which mark the bottleneck.

### See also

dijkstra

## DSU merge

Join the groups of two values in a dsu.

```rank
use graph
D = new dsu
D 1 2 merge
D 2 3 merge
D 1 3 connected
```

```result
true
```

### Usage

```text
Dsu A B merge
```

Gives true if they were in different
groups, false if they were already
together. A dsu (disjoint set union)
tracks groups without storing edges, and
stays fast for millions of merges.

### See also

connected, findroot, new

## mst

The cheapest set of edges that still
links every vertex.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2 1
G add 2 3 2
G add 1 3 5
R = G mst
R .weight
```

```result
3
```

### Usage

```text
Graph mst
```

Gives a record: .weight is the total
cost, .edges lists the chosen edges, and
.connected tells whether one tree covers
everything. The graph must be
undirected.

### See also

components, dijkstra

## pathlengths

The distance between every pair of
vertices in a tree.

In the path 1 – 2 – 3, the pairs are 1
apart, 2 apart and 1 apart.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
G pathlengths
```

```result
1 2 1
```

### Usage

```text
Tree pathlengths
```

The tree must be undirected and
connected. Each pair appears once.
Distances are produced as you read them.

### See also

distance, root

## root

Hang a tree from one vertex, ready for
ancestor, lca and distance questions.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G 1 root
R .order
```

```result
1 2 3
```

### Usage

```text
Tree Root root
```

The graph must be an undirected,
connected tree. Gives a record including
.parent and .depth for each vertex.

### See also

ancestor, lca, distance

## scc

Group the vertices of a directed graph
that can all reach each other.

1 and 2 reach each other; 3 can be
reached but cannot get back.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 1
G add 2 3
R = G scc
R .count
```

```result
2
```

### Usage

```text
Graph scc
```

Gives a record: .count of groups,
.component with each vertex's group, and
.roots.

### See also

components, cycle

## topological

Order the vertices so every edge points
forward, as in a task list where each
task comes after the tasks it depends
on.

```rank
use graph
G = new graph (1 to 3) .directed
G add 3 1
G add 1 2
R = G topological
R .order
```

```result
3 1 2
```

### Usage

```text
Graph topological
```

Gives a record: .possible is false when
the graph has a cycle, and .order is the
ordering.

### See also

cycle, dfs

## upto

Follow an increasing functional graph
from a start and count the vertices up
to a limit.

```rank
use graph
F = (array 2 3 3) functional
F 1 3 upto
```

```result
3
```

### Usage

```text
F Start Limit upto
```

Each next vertex must be larger than the
current one; the last may point to
itself. On a weighted graph, gives a
record with .count, .sum of costs and
.last vertex.

### See also

functional, weighted, jump

## weighted

A functional graph where each step has a
cost.

```rank
use graph
Next = array 2 3 3
Cost = array 10 20 0
W = Next Cost weighted
R = W 1 3 upto
R .sum
```

```result
30
```

### Usage

```text
Next Cost weighted
```

Cost has one number per vertex: the cost
of leaving it.

### See also

functional, upto
