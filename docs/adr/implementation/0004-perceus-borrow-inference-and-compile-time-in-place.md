# 0004. Parameter Borrow Inference and Automatic Compile-Time In-Place (ACI)

* **Status:** Accepted
* **Date:** 2026-09-20
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Value Semantics (ADR-0101), Transparent CoW (ADR-0001), Perceus: Garbage Free Reference Counting with Reuse (PLDI 2021), Roc Language Compiler Architecture, Koka FBIP Model

## Context

In ADR-0001, Rank established the Transparent Copy-on-Write (CoW) memory model, enabling flat contiguous buffers with in-place mutations when `owners === 1`. 

However, relying solely on dynamic runtime reference tracking introduces three performance challenges:
1. **False CoW de-optimization across function calls:** Passing an array into a pure inspection function (such as `A length`, `A max`, or `A mean`) traditionally records an ownership binding, turning an exclusively owned tensor (`owners = 1`) into a shared tensor (`owners = 2`). If the caller modifies the array immediately after the call, a redundant $O(N)$ CoW clone is triggered even though the function only inspected the data.
2. **Runtime guard tax in tight loops:** Checking `isSharedArray(A)` on every index assignment inside an iterative loop incurs memory indirection, prevents vectorization, and adds unnecessary branching overhead.
3. **Allocation churn in standard library transformations:** Operations such as `A sort`, `A reverse`, and `A partition` are conceptually pure functions. If they allocate a fresh buffer on every call, chained pipelines (`Data filter ... sort`) discard temporary buffers to the garbage collector, saturating memory bandwidth.

Compile-time borrow checkers (like Rust) solve these issues through explicit syntax (`&`, `&mut`, lifetimes), while linear type systems (like Austral) require destructive consumption. Both violate Rank's 40-column mobile ergonomics and REPL inspectability. 

Rank requires an architecture that eliminates false CoW copies and runtime checks automatically through compiler analysis, inspired by the **Perceus / Roc (Morphic)** model.

## Decision

Rank establishes **Parameter Borrow Inference, Automatic Compile-Time In-Place (ACI) Lowering, and the Functional But In-Place (FBIP) Standard Library Contract**:

```mermaid
flowchart TD
    AST["AST Function / Loop Analysis"] --> BorrowPass["Parameter Borrow Inference"]
    AST --> Liveness["Liveness & Alias Analysis (bindings.ts)"]
    BorrowPass -->|Pure Reader| BorrowSignature["No owners++ on Call (Caller Stays UNBOUND)"]
    Liveness -->|Unique Local (No Aliases)| ACI["ACI Lowering: Unchecked In-Place Memory Write"]
    Liveness -->|Shared or Escaping| RuntimeCoW["Guarded CoW Fallback (ADR-0001)"]
    ACI --> FBIP["FBIP Standard Library (sort, reverse, partition run in-place)"]
```

---

### 1. Parameter Borrow Inference
The compiler performs static effect analysis on function declarations to determine whether parameters are consumed or merely borrowed:

- **Borrowed Parameter (`borrow`):** A parameter is borrowed if the function only reads from it and never escapes it (does not assign it to a global variable or record, does not yield it, and does not return it or an alias of it).
- **Zero-Cost Calling Convention:** When an array is passed to a borrowed parameter, the runtime **does not call `noteArrayBinding`** and does not increment `owners`.
- **Preserved Exclusivity:** The caller retains exclusive ownership (`UNBOUND` / `owners = 1`):
  ```rank
  A = array shape 1000000 fill 0
  M = A max       rem 'max' borrows A; A's owners remains 1!
  A 0 = 99        rem In-place write with ZERO copies!
  ```

---

### 2. Automatic Compile-Time In-Place (ACI) Lowering
The compiler leverages [bindings.ts](file:///Users/kmmbvnr/Workspace/Playground/09-Rank/packages/language/src/analysis/bindings.ts) and [tensor-use.ts](file:///Users/kmmbvnr/Workspace/Playground/09-Rank/packages/interpreter/src/tensor-use.ts) to statically prove uniqueness:

- **Static Uniqueness Invariant:** If an array variable satisfies:
  1. It was allocated in the current lexical scope (or received as an owned argument);
  2. It has no live aliases at the point of mutation;
  3. It is not captured across asynchronous tasks or event handlers;
- **Lowering:** The JIT and AOT compilers (JS, WebAssembly, Rust) **completely elide the `isSharedArray` check**.
- **Generated Code:** The mutation lowers directly to an unchecked typed pointer write:
  ```ts
  // Lowered loop execution: direct memory store without CoW check
  items[index] = value;
  ```
  This removes all WeakMap lookups, ownership branches, and proxy overhead from inner loops.

---

### 3. Functional But In-Place (FBIP) Contract for Standard Library
All standard library data transformations (`sequences`, `tables`, `graphs`) adhere to the **Functional But In-Place (FBIP)** design pattern:

```rank
TopUsers = Users filter .Active 1 sort by .Score descending
```

1. **Equational Surface API:** To the user, functions behave purely equationally: `Sorted = A sort` produces a new value without modifying the syntax or semantics of `A`.
2. **Under-the-Hood In-Place Execution:**
   - When called on an intermediate temporary (such as the result of `Users filter ...`), `owners === 1`.
   - The implementation executes an in-place Quicksort/Timsort directly in the existing backing memory buffer without allocating a secondary buffer.
   - If called on a shared array (`owners >= 2`), the function performs exactly one clone at entry, and executes in-place thereafter.
3. **Covered Operations:**
   - `sort`, `reverse`, `shuffle`, `partition`;
   - Multidimensional axis transposition and `reshape` (metadata update with reused memory);
   - Graph disjoint-set union (`dsu`) and path compression;
   - Segment tree and Fenwick tree point/range updates.

---

### 4. Comparison with Alternative Models

| Feature | Rust | Swift | Roc / Perceus | Rank (ADR-0001 + ADR-0004) |
|---|---|---|---|---|
| **Syntax Annotations** | `&`, `&mut`, `'a` | `inout`, `~Copyable` | None | **None (Zero annotations)** |
| **Ergonomic Screen Budget** | Desktop IDE | Desktop IDE | Desktop IDE | **40-column phone touchscreens** |
| **In-Place Mutation** | Compile-time guaranteed | Runtime CoW | Hybrid (ACI + CoW fallback) | **Hybrid (ACI + CoW fallback)** |
| **False Call CoW** | N/A (compile error) | Common cliff | Eliminated via Borrowing | **Eliminated via Borrow Inference** |
| **REPL Exploration** | Split-borrow friction | Supported | Supported | **Full value inspectability** |

## Consequences

### Positive
* **Elimination of false CoW copies:** Pure helper functions can inspect tensors without stripping the caller's in-place mutation rights.
* **Native C speed in compiled loops:** Unchecked direct pointer writes in JIT/AOT code for statically unique arrays.
* **Pure functional APIs with zero allocation overhead:** Standard library algorithms (`sort`, `reverse`, etc.) reuse intermediate buffers seamlessly.
* **Zero mobile ergonomic tax:** No borrow checker errors or lifetime syntax to fight on narrow screens.

### Negative / Trade-offs
* **Interprocedural analysis complexity:** Determining whether a function borrows or consumes its parameters requires call-graph and effect analysis.
* **Dynamic fallback:** When functions are passed as dynamic first-class values or invoked across external JS host boundaries, the compiler falls back to runtime CoW checking.

## References
* [docs/adr/implementation/0001-transparent-cow-memory-model-and-buffer-recycling.md](0001-transparent-cow-memory-model-and-buffer-recycling.md)
* [docs/adr/implementation/0003-tensor-kernel-fusion-and-execution-planner.md](0003-tensor-kernel-fusion-and-execution-planner.md)
* Reinking, Xie, de Moura, Leijen. *"Perceus: Garbage Free Reference Counting with Reuse"*, PLDI 2021.
* Lorenzen, Leijen. *"Fully In-Place (FIP) Functional Programming"*, ICFP 2023.
* Richard Feldman. *"Roc: A fast, friendly, functional language"*.
