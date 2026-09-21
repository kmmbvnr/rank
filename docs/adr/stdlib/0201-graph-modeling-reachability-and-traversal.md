# 0201. Graph Modeling, Reachability, and Traversal (use graph)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Graphs Specification, CSES Graph Algorithm Solutions

## Context

Graph representation and traversal (BFS, DFS, Dijkstra, Bellman-Ford, Kruskal's MST, tree binary lifting) are among the most common algorithmic challenges.

In traditional competitive and numerical programming:
1. **Ad-hoc adjacency representation boilerplate:** Programmers manually construct adjacency lists using nested vectors (`vector<vector<pair<int, int>>>` in C++ or `defaultdict(list)` in Python). Allocating and managing these nested structures takes 10–15 lines of repetitive setup code before any algorithmic logic begins.
2. **Disconnected DSU implementations:** Implementing Disjoint Set Union (DSU / Union-Find) requires writing custom path compression and union-by-rank functions for every single graph problem.
3. **Complex binary lifting for functional graphs:** Problems involving successor transitions (e.g. tree jumping, cycle finding) require manually writing 2D binary lifting tables (`up[node][bit]`), which is notoriously error-prone on small screens.

Rank needs high-level, first-class graph abstractions that provide clean construction, neighbor iteration via standard whitespace addressing, built-in Disjoint Set Union, and native binary lifting for functional graphs.

## Decision

Rank establishes **Graph Modeling, Reachability, and Traversal via `use graph`**:

```rank
use graph

Graph = new graph .directed
Graph add 1 2 10
for Next in Graph 1
  Next print
end
```

### 1. Directional Graph Construction (`new graph`)
- **Explicit Direction:** Directionality is mandatory at creation:
  ```rank
  G = new graph .directed
  G = new graph .undirected
  ```
- **Open vs Closed Domains:**
  - Open graphs (`new graph .directed`) start empty and dynamically register endpoints as edges are added.
  - Closed graphs (`new graph Nodes .directed`) declare a fixed vertex set; attempting to add an unknown endpoint is a runtime error.
- **Bulk Edge Ingestion:** Adding multi-row arrays (`M 2` for unweighted, `M 3` for weighted) registers thousands of edges in a single call:
  ```rank
  Graph add Flights
  ```

### 2. Addressing for Neighbor Traversal
Graphs integrate directly with Rank's whitespace addressing equation ($\text{value} + \text{selector} \rightarrow \text{value}$):
- **Unweighted Neighbors:** Addressing the graph with a vertex returns an immutable snapshot sequence of its neighbors:
  ```rank
  for Next in Graph Current
    queue push Next
  end
  ```
- **Weighted Edges:** The `edges` method returns outgoing `array Next Cost` pairs, destructurable via `unpack`:
  ```rank
  for Edge in Graph edges Current
    unpack Next Cost = Edge
    ...
  end
  ```

### 3. First-Class Disjoint Set Union (`new dsu`)
Rank provides an optimized, near-constant time $O(\alpha(N))$ DSU implementation:
```rank
Union = new dsu Nodes
Combined = Union merge A B
Leader = Union find A
Same = Union connected A B
TotalComponents = Union components
```
- Supports union by size and path compression.
- Values can be integers, real numbers, strings, or symbols.

### 4. Functional Graphs and Binary Lifting (`functional`)
For graphs where every vertex has exactly one outgoing edge (successor arrays $1..N$):
```rank
Planets = Next functional
EndNode = Planets jump Start Steps
Dist = Planets distance From To
```
- `Planets jump Start Steps`: Jumps an arbitrary integer number of steps (even $10^{18}$) using cached binary lifting tables built lazily in $O(N \log \text{Steps})$ time.
- `Planets distance From To`: Computes forward transition distance, raising `.Missing` (composable with `default`) if `To` is unreachable.

## Consequences

### Positive
* **Rapid contest iteration:** Cuts graph setup code from 15+ lines to 2 lines (`Graph = new graph .directed; Graph add Edges`).
* **Zero syntax overhead:** Iterating neighbors uses ordinary addressing (`Graph Current`) and `for` loops.
* **Large-scale performance:** Bulk ingestion and lazy neighbor sequences optimize memory allocation for tens of thousands of vertices.
* **Built-in DSU & Binary Lifting:** Eliminates the two most common error-prone template implementations in competitive programming.

### Negative / Trade-offs
* **Mutable reference semantics:** Graphs and DSUs use reference identity; passing them across functions shares mutations.
