# 0200. Reference Collections and Keyed Indices (use algo)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Updated:** 2026-09-28 — collection element contracts (issue #31)
* **Updated:** 2026-10-04 — the implicit per-function `index`, `queue`, `set` and `counter` are removed; every structure is created with `new`, optionally filled from a collection (`new queue Items`), and `push unpack Items` appends each item (issue #182 follow-up)
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Collections Specification, Algorithmic Benchmark Suite

## Context

Competitive programming and algorithmic problem solving (LeetCode, CSES, Codeforces) require stateful, mutating data structures with strict asymptotic time complexity guarantees:
- Fast FIFO/LIFO buffers (`queue`, `deque`, `stack`);
- Min/Max priority queues (`heap`);
- Sparse dictionaries and coordinate maps (`index`);
- Frequency counts and multisets (`counter`, `multiset`, `orderedset`);
- Logarithmic range aggregate structures (`fenwick`, `segment`, `wavelet`).

In pure functional languages, purely functional balanced trees add heavy pointer indirection, cache misses, and memory overhead. Conversely, in mainstream languages like Python or C++, container APIs are bloated with verbose method calls, manual iterator management, and cumbersome class wrappers that overflow the ~40-column mobile screen budget (ADR-0000).

Rank requires high-performance algorithmic collections that provide $O(1)$ and $O(\log N)$ asymptotic guarantees, maintain explicit reference identity (ADR-0101), support both implicit zero-boilerplate local use and named instances, and integrate with Rank's whitespace addressing.

## Decision

Rank establishes **Reference Collections and Keyed Indices via `use algo`**:

```rank
use algo

Q = new queue
Q push 42
First = Q pop
```

### 1. Reference Semantics for Mutable State
As codified in ADR-0101, algorithmic collections belong to Rank's closed set of **reference types**:
- Assigning, passing as arguments, or capturing containers inside closures shares the underlying instance.
- Mutations through one alias are immediately visible through all aliases:
  ```rank
  Alias = Q
  Alias push 10
  rem Q now contains 10!
  ```

### 2. Implicit Local Structures vs Explicit Named Instances
- **Implicit Local Structures:** When a function needs only one instance of a common container, the type name itself denotes a lazily allocated local instance:
  ```rank
Queue = new queue
  fun bfs Start
    Queue push Start
    for Queue
      Current = Queue pop
      ...
    end
  end
  ```
  Recursive and concurrent calls receive completely isolated instances.
- **Explicit Named Instances (`new`):** When algorithms require multiple structures or pass them across function boundaries, `new` allocates fresh instances:
  ```rank
  Front = new queue
  Back = new queue
  Seen = new set
  Graph = new index
  ```

### 3. Sparse Multidimensional Keyed Addressing (`index`)
- `index` provides sparse hash maps where keys can be composite tuples:
  ```rank
Index = new index
  Index X Y = Value
  Stored = Index X Y default 0
  ```
- This allows representing sparse 2D/3D grids, adjacency maps, or memoization tables without allocating massive dense rectangular arrays.
- Keys support all scalars (`integer`, `real`, `text`, `boolean`, `symbol`).

### 4. Queue, Deque, Stack, and Priority Heap
- **Queue & Stack:** `push`, `pop`, `peek`.
- **Deque:** Double-ended operations `pushfront`, `pushback`, `popfront`, `popback`, `peekfront`, `peekback`.
- **Heap:** Min-priority queue with $O(\log N)$ insertion and extraction. `Heap push Value` uses the value as priority; `Heap Priority Value enqueue` accepts an explicit payload.
- Empty removals raise `.Missing`, composing cleanly with `default` (`Q pop default -1`).

### 5. Unique Sets and Frequency Counters (`set`, `counter`)
- **Set (`new set` / `set`):** Unordered collection of distinct values with structural equality.
  * `Seen add X`: Adds element if absent.
  * `Seen remove X`: Removes element, raising `.Missing` if absent.
  * `X in Seen`: Boolean membership test.
  * `for X in Seen`: Iteration over elements in insertion order.
  * `Seen len`: Distinct element count.
- **Counter (`new counter` / `counter`):** Stateful frequency map.
  * `Counts add X`: Increments element frequency by 1.
  * `Counts remove X`: Decrements frequency by 1, removing key when count reaches 0. Raises `.Missing` if absent.
  * `Counts X`: Lookup count (returns 0 for absent elements without error).
  * `X in Counts`: Boolean membership test (true if count > 0).
  * `for Key in Counts`: Iteration over distinct keys in insertion order.
  * `Counts len`: Distinct key count.
  * `Counts multiset`: Conversion to ordered multiset.

### 6. Ordered Multiset and Binary Search (`floor`, `ceiling`)
- `Bag = new multiset` maintains elements in sorted order with duplicates in $O(\log N)$ time.
- `Bag floor X`: Finds the greatest element $\le X$.
- `Bag ceiling X` (alias `lowerbound`): Finds the smallest element $\ge X$.
- Out-of-range bounds raise `.Missing` and fallback via `default`.

### 7. Logarithmic Range Structures (`fenwick`, `segment`, `wavelet`)
- **Fenwick Tree (`N fenwick`):** Point update `F I += Delta` and prefix sums `F sum I` in $O(\log N)$.
- **Segment Tree (`Values segment min`, `Values segment +`):** Range queries and point/range updates in $O(\log N)$. Supports associative combinators with optional identity seeds (`segment with Identity`), lazy propagation, and $O(1)$ persistent copy-on-write versioning (`Version = Tree copy`).
- **Wavelet Matrix (`Values wavelet`):** Range value-frequency queries (`within`, `sumwithin`, `missing`) over immutable arrays in $O(\log S)$ time.

### Element contracts

Each `set`, `counter`, `queue`, `stack`, `deque` and `heap` fixes its element
contract on the first successful insertion. The contract governs counter keys
and heap payloads. Integer and real are distinct; aliases share the contract,
which survives removing every element. No constructor annotation is required.

Array elements fix rank and recursive cell types, while axis lengths may vary.
An initial mixed-cell array permits later subsets of those types. Empty arrays
fix rank but defer cell types until a nonempty insertion. Record fields and the
contents of nested mutable collections are outside this collection contract.
Individual records still enforce their own field contracts under ADR-0106.

`index` remains heterogeneous: different entries may hold different types and a
replacement may change an entry's type. It is not a homogeneous collection.

Insertion validates lazy array cells too. A failed check does not store the value
or widen the contract, but effects performed by cell reads remain. Static checks
report proven conflicts; runtime checks enforce the contract through aliases and
unknown calls. Tests: [collection contracts](../../../packages/interpreter/test/collection-contracts.test.ts).

## Consequences

### Positive
* **Asymptotic rigor:** Provides optimal $O(1)$ and $O(\log N)$ primitives essential for contest algorithms and graph search.
* **Ergonomic brevity:** Implicit local structures (`queue push X`, `index Need`) eliminate initialization boilerplate in competitive programming.
* **Tuple key power:** Multidimensional tuple keys (`index X Y Z`) simplify sparse coordinate handling without complex nested dictionary nesting.
* **Safe missing values:** Empty container queries and failed searches raise `.Missing`, integrating with `default`.

### Negative / Trade-offs
* **Mutation aliasing:** Because collections use reference identity rather than value semantics, programmers must be mindful of shared mutations across aliases.
* **Array validation cost:** Inserting an array reads its cells to check the contract. This adds work proportional to the cells inspected; constant-time container insertion does not include that validation work.
