# graph manual

## ancestor

### NAME

Vertex K parent edges above another in a
rooted tree.

### SYNOPSIS

```text
Rooted Vertex K ancestor -> element
Rooted: record returned by root
Vertex: vertex value; K: nonnegative
integer
```

### DESCRIPTION

The graph must be an undirected
connected tree. root builds the record
needed by ancestor, lca and distance;
pathlengths produces a lazy sequence.

### EXAMPLES

Move one parent step from 3: vertex 2.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G 1 root
R 3 1 ancestor
```

## bellmanford

### NAME

Shortest distances allowing negative
weights, plus reachable negative cycles.

### SYNOPSIS

```text
Graph Start bellmanford -> record
Graph: graph; Start: vertex value
```

### DESCRIPTION

Finds shortest weighted paths even with
negative edges. Reachable negative
cycles are reported by the algorithm.

### EXAMPLES

Start the traversal or distance search
at vertex 1.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G 1 bellmanford
```

## bfs

### NAME

Breadth-first search returning distance,
parent and discovery order.

### SYNOPSIS

```text
Graph Start bfs -> record
Graph: graph; Start: vertex value
```

### DESCRIPTION

Visits vertices by unweighted distance.
The result record includes traversal and
distance information.

### EXAMPLES

Start the traversal or distance search
at vertex 1.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G 1 bfs
```

## bipartite

### NAME

Two-colouring of an undirected graph, or
possible false for an odd cycle.

### SYNOPSIS

```text
Graph bipartite -> record
Graph: graph
```

### DESCRIPTION

Tests whether vertices can be split into
two groups with no edge inside a group.
A self-loop or odd cycle prevents this.

### EXAMPLES

Run the algorithm on a three-vertex
path.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
G bipartite
```

## components

### NAME

Connected components: their count, a
per-vertex index and the roots.

### SYNOPSIS

```text
Graph components -> record
Graph: graph
```

### DESCRIPTION

Groups vertices connected by graph
edges. The result record describes the
component assignment.

### EXAMPLES

Run the algorithm on a three-vertex
path.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
G components
```

## connected

### NAME

True when two values share a
disjoint-set representative.

### SYNOPSIS

```text
Dsu A B connected -> boolean
Dsu: disjoint set; A, B: values
```

### DESCRIPTION

A disjoint-set structure tracks
connectivity without storing graph
edges. Representatives are internal
values; use connected to compare
membership.

### EXAMPLES

1 and 2 are in the same set: true.

```rank
use graph
D = new dsu
D 1 2 merge
D 1 2 connected
```

## cycle

### NAME

One cycle with its first vertex repeated
at the end, or an empty array.

### SYNOPSIS

```text
Graph cycle -> array
Graph: graph
```

### DESCRIPTION

Returns a directed or undirected cycle
when one exists. An acyclic graph
returns an empty array.

### EXAMPLES

Run the algorithm on a three-vertex
path.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G cycle
```

## dfs

### NAME

Depth-first search returning distance,
parent and discovery order.

### SYNOPSIS

```text
Graph Start dfs -> record
Graph: graph; Start: vertex value
```

### DESCRIPTION

Explores one branch before backtracking.
The result is a traversal record; graph
direction controls reachable vertices.

### EXAMPLES

Start the traversal or distance search
at vertex 1.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G 1 dfs
```

## dijkstra

### NAME

Shortest distances for nonnegative
numeric weights.

### SYNOPSIS

```text
Graph Start dijkstra -> record
Graph: graph; Start: vertex value
```

### DESCRIPTION

Finds shortest weighted paths. Edge
weights must be nonnegative; unreachable
vertices have no finite distance.

### EXAMPLES

Start the traversal or distance search
at vertex 1.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G 1 dijkstra
```

## distance

### NAME

Edges between two vertices of a rooted
tree or functional graph.

### SYNOPSIS

```text
Rooted A B distance -> integer
Rooted: record returned by root
A, B: vertex values
```

### DESCRIPTION

The graph must be an undirected
connected tree. root builds the record
needed by ancestor, lca and distance;
pathlengths produces a lazy sequence.

### EXAMPLES

Count the two edges from 1 to 3.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G 1 root
R 1 3 distance
```

## euler

### NAME

Euler trail using every edge once, or an
empty array when none exists.

### SYNOPSIS

```text
Graph Start euler -> array
Graph, Start: graph/vertex operands as
shown
```

### DESCRIPTION

Returns an Euler trail using every edge
once. Start and graph degrees must
permit the trail; disconnected edges
cannot form one trail.

### EXAMPLES

Traverse the two edges starting at 1.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G 1 euler
```

## findroot

### NAME

Representative of the disjoint-set
component holding a value.

### SYNOPSIS

```text
Dsu Value findroot -> element
Dsu: disjoint set; Value: member
```

### DESCRIPTION

A disjoint-set structure tracks
connectivity without storing graph
edges. Representatives are internal
values; use connected to compare
membership.

### EXAMPLES

Find the representative of the set
containing 2.

```rank
use graph
D = new dsu
D 1 2 merge
D 2 findroot
```

## floyd

### NAME

All-pairs shortest distances addressed
Distance From To.

### SYNOPSIS

```text
Graph floyd -> record
Graph: graph
```

### DESCRIPTION

Computes all-pairs shortest-path
information. It considers edge weights
and can detect negative cycles.

### EXAMPLES

Run the algorithm on a three-vertex
path.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G floyd
```

## functional

### NAME

Successor structure prepared for jump,
distance and path queries.

### SYNOPSIS

```text
Next functional -> functional
Next: integer vector with values 1..N
```

### DESCRIPTION

Successors are a one-dimensional integer
array using vertex numbers 1..N, not
ordinary zero-based array positions.
upto requires increasing successors; the
final vertex may point to itself.

### EXAMPLES

Store one successor for every vertex.

```rank
use graph
F = (array 2 3 1) functional
F
```

## jump

### NAME

Vertex reached after exactly that many
successor steps.

### SYNOPSIS

```text
F Start Steps jump -> integer
F: functional graph; Start: vertex 1..N
Steps: nonnegative integer
```

### DESCRIPTION

Successors are a one-dimensional integer
array using vertex numbers 1..N, not
ordinary zero-based array positions.
upto requires increasing successors; the
final vertex may point to itself.

### EXAMPLES

Follow two edges from 1: reach 3.

```rank
use graph
F = (array 2 3 1) functional
F 1 2 jump
```

## lca

### NAME

Lowest common ancestor of two vertices.

### SYNOPSIS

```text
Rooted A B lca -> element
Rooted: record returned by root
A, B: vertex values
```

### DESCRIPTION

The graph must be an undirected
connected tree. root builds the record
needed by ancestor, lca and distance;
pathlengths produces a lazy sequence.

### EXAMPLES

The lowest shared ancestor of 2 and 3 is
2.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
R = G 1 root
R 2 3 lca
```

## lengths

### NAME

Path length from every vertex of a
functional graph.

### SYNOPSIS

```text
F lengths -> array
F: functional graph
```

### DESCRIPTION

Successors are a one-dimensional integer
array using vertex numbers 1..N, not
ordinary zero-based array positions.
upto requires increasing successors; the
final vertex may point to itself.

### EXAMPLES

Count distinct visited vertices before
repetition.

```rank
use graph
F = (array 2 3 1) functional
F lengths
```

## maxflow

### NAME

Maximum flow value, the per-edge flow
and the minimum cut.

### SYNOPSIS

```text
Graph Source Sink maxflow -> record
Graph: graph; Source, Sink: vertices
```

### DESCRIPTION

Edge weights are nonnegative capacities.
Returns a record describing the maximum
flow and the residual cut.

### EXAMPLES

Send flow from 1 to 3 through capacities
5 and 4.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2 5
G add 2 3 4
G 1 3 maxflow
```

## merge

### NAME

Unions two disjoint-set components, true
only when they differed.

### SYNOPSIS

```text
Dsu A B merge -> boolean
Dsu: disjoint set; A, B: values
```

### DESCRIPTION

A disjoint-set structure tracks
connectivity without storing graph
edges. Representatives are internal
values; use connected to compare
membership. This operation changes the
receiver in place.

### EXAMPLES

Join the set containing 3 to that
containing 2.

```rank
use graph
D = new dsu
D 1 2 merge
D 2 3 merge
```

## mst

### NAME

Minimum spanning forest: connectivity,
component count, weight and edges.

### SYNOPSIS

```text
Graph mst -> record
Graph: graph
```

### DESCRIPTION

Finds a minimum spanning tree of an
undirected weighted graph. It selects
edges with minimum total cost.

### EXAMPLES

Run the algorithm on a three-vertex
path.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
G mst
```

## pathlengths

### NAME

Lazy sequence of every unordered pair
distance in a tree.

### SYNOPSIS

```text
Tree pathlengths -> sequence
Tree: undirected tree
```

### DESCRIPTION

The graph must be an undirected
connected tree. root builds the record
needed by ancestor, lca and distance;
pathlengths produces a lazy sequence.
Values are produced on demand; storing
the result does not force every item.

### EXAMPLES

Enumerate distances between vertex
pairs.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
G pathlengths
```

## root

### NAME

Immutable rooted view of a connected
undirected tree.

### SYNOPSIS

```text
Tree Root root -> record
Tree: undirected tree; Root: vertex
value
```

### DESCRIPTION

The graph must be an undirected
connected tree. root builds the record
needed by ancestor, lca and distance;
pathlengths produces a lazy sequence.

### EXAMPLES

Prepare traversal data rooted at vertex
1.

```rank
use graph
G = new graph (1 to 3) .undirected
G add 1 2
G add 2 3
G 1 root
```

## scc

### NAME

Strongly connected components of a
directed graph.

### SYNOPSIS

```text
Graph scc -> record
Graph: graph
```

### DESCRIPTION

Groups vertices that can each reach
every other member of their group.
Direction matters; the result is a
component record.

### EXAMPLES

Run the algorithm on a three-vertex
path.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G scc
```

## topological

### NAME

Topological order of a directed graph,
or possible false.

### SYNOPSIS

```text
Graph topological -> record
Graph: graph
```

### DESCRIPTION

Orders a directed acyclic graph so each
edge points forward. A directed cycle
prevents a complete topological order.

### EXAMPLES

Run the algorithm on a three-vertex
path.

```rank
use graph
G = new graph (1 to 3) .directed
G add 1 2
G add 2 3
G topological
```

## upto

### NAME

Counts path vertices through a limit;
weighted paths return count, sum and
last.

### SYNOPSIS

```text
F Start Limit upto -> value
F: increasing functional graph
Start, Limit: integers
```

### DESCRIPTION

Successors are a one-dimensional integer
array using vertex numbers 1..N, not
ordinary zero-based array positions.
upto requires increasing successors; the
final vertex may point to itself.

### EXAMPLES

Count the increasing path through a
limit.

```rank
use graph
F = (array 2 3 3) functional
F 1 3 upto
```

## weighted

### NAME

Functional graph carrying numeric edge
costs along its paths.

### SYNOPSIS

```text
Next Cost weighted -> functional
Next: integer successors in 1..N
Cost: numeric vector of the same length
```

### DESCRIPTION

Successors are a one-dimensional integer
array using vertex numbers 1..N, not
ordinary zero-based array positions.
upto requires increasing successors; the
final vertex may point to itself.

### EXAMPLES

Store successors and their outgoing
weights.

```rank
use graph
Next = array 2 3 3
Cost = array 10 20 0
Next Cost weighted
```
