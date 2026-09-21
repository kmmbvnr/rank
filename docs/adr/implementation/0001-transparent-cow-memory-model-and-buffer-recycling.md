# 0001. Transparent Copy-on-Write Memory Model, Buffer Recycling, and Cliff Prevention

* **Status:** Accepted
* **Date:** 2026-09-08 (Updated 2026-09-20 with Performance Cliff analysis & Perceus/Roc reuse model)
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Value Semantics Specification, Memory Allocator Benchmarks, Perceus: Garbage Free Reference Counting with Reuse (PLDI 2021), Roc Architecture

## Context

Rank guarantees strict equational value semantics for arrays and tensors (ADR-0101): assigning a tensor to a new variable or passing it to a function must never allow the receiver to silently mutate the caller's data.

In software execution, there are two traditional ways to implement value semantics:
1. **Eager defensive copying:** Deep-copying memory buffers on every variable assignment and function boundary. This guarantees safety but inflicts catastrophic CPU and memory allocation penalties ($O(N)$ copies), making matrix loops and numerical pipelines unacceptably slow.
2. **Persistent functional trees:** Using persistent data structures (like Hash Array Mapped Tries or balanced search trees). While they allow $O(\log N)$ structural sharing, tree node pointer indirection destroys CPU cache locality and SIMD vectorization compared to flat contiguous arrays.

### The Naive CoW Dilemma: The Swift "Performance Cliff"
Mainstream imperative languages with Copy-on-Write (notably Swift) rely on runtime reference counting (`isKnownUniquelyReferenced`) to perform in-place mutations when `refCount === 1`. However, naive runtime CoW introduces a notorious **performance cliff (accidental copying)**:
- If a programmer accidentally captures a collection into an escaping closure, passes it to an outer struct, or leaves a dead alias in an outer scope, a tight imperative loop `for i in 0..<N { arr[i] = ... }` silently loses uniqueness.
- Instead of mutating in-place in $O(N)$ time, every iteration clones the entire buffer, causing an unexpected explosion to $O(N^2)$ time and gigabytes of memory allocation. The programmer receives no compile-time error or warning—only a drastic performance cliff in production.

Rank requires an execution architecture that guarantees flat contiguous memory buffers for fast SIMD and GPU execution, achieves native C speeds during sequential mutations, and provides concrete architectural defenses against the CoW performance cliff.

## Decision

Rank establishes the **Transparent Copy-on-Write (CoW) Memory Model with Buffer Recycling and Static Cliff Prevention**:

```rank
A = array shape 1000000 fill 0
B = A         rem Shared buffer; zero bytes allocated!
B 0 = 99      rem Physical copy triggered here for B; A remains 0!
```

```mermaid
flowchart TD
    Assign["Assignment / Binding (B = A)"] --> StateShared["Buffer Marked SHARED (owners = 2)"]
    Write{"Addressed Write (A i = x)"} --> CheckOwner{"isSharedArray(A)?"}
    CheckOwner -->|owners == 1 (Unbound)| InPlace["O(1) In-Place Mutation (Direct Memory Write)"]
    CheckOwner -->|owners >= 2 (Shared)| PrivateCopy["Allocate Private Copy"]
    PrivateCopy --> ResetState["Reset Target to UNBOUND (owners = 1)"]
    ResetState --> InPlaceLoop["Subsequent Loop Iterations Write In-Place!"]
```

---

### 1. Transparent Buffer Sharing & Binding Tracking
- An array value consists of a lightweight descriptor (holding `shape`, `strides`, and element metadata) pointing to an underlying contiguous data storage buffer.
- Variable assignments (`B = A`) and non-terminal slices share the existing buffer without copying.
- Backing storage buffers maintain an internal ownership record (`owners`).
- The runtime tracks two fundamental states:
  - **`UNBOUND` (`owners = 1`):** The buffer is owned exclusively by one variable binding.
  - **`SHARED` (`owners >= 2`):** The buffer is shared across multiple variable bindings or active readers.

---

### 2. $O(1)$ In-Place Mutation with Reset-to-Unbound
When an addressed assignment (`A i = Value` or `A += Delta`) is executed:
- **If `owners === 1`:** The write proceeds **directly in-place** into the existing memory buffer in $O(1)$ time with zero allocation.
- **If `owners >= 2`:** The runtime allocates a private copy, decrements the source buffer's reference count, and points the target variable to the newly allocated buffer.
- **The "Reset-to-Unbound" Invariant:** The freshly copied buffer starts in the `UNBOUND` (`owners = 1`) state. Consequently, even if an array was aliased prior to a loop:
  ```rank
  A = array shape N fill 0
  B = A          rem A and B share buffer (owners = 2)
  for i in 0 until N
    A i = i * i  rem i = 0 triggers CoW copy; new buffer is UNBOUND!
  end
  ```
  On iteration `i = 0`, a private copy is made. Because the new copy is immediately unbound, iterations `1, 2, ..., N-1` execute **directly in-place**. The entire loop incurs **exactly 1 allocation**, retaining $O(N)$ complexity instead of degenerating into $O(N^2)$.

---

### 3. Why Not Borrow Checkers (Rust) or Linear Types (Austral)?
Compile-time ownership systems (Rust borrow checker, Austral linear types) eliminate runtime reference counting, but are incompatible with Rank's core design charter:

1. **The 40-Column Mobile Ergonomics Budget (ADR-0000, ADR-0001):**
   - Rust requires explicit mutability annotations (`&mut`), explicit lifetimes (`'a`), and container wrapping (`Rc<RefCell<T>>`) when structures fork.
   - Austral requires explicit linear capability consumption (`consume(x)`), forbidding reading a variable after a move.
   - Rank has **zero type annotations** (no `let`, `var`, `mut`, `&`, or types). Requiring a user typing on a 5-inch phone touchscreen to resolve borrow checker lifetime mismatches destroys Rank's "programmable pocket calculator" simplicity.
2. **REPL & Exploratory Computing (ADR-0300):**
   - Linear types destroy variables upon consumption. In an interactive REPL or scientific notebook:
     ```rank
     A = array 1 2 3
     B = A bump
     ```
     Under linear types, `A` is consumed and dead; typing `A` on the next REPL line produces a compile-time error. In Rank, exploratory data analysis demands that all past bindings remain inspectable.

---

### 4. Architectural Lessons from Roc and Perceus (Koka)
Roc and Koka demonstrate that pure functional value semantics can achieve native C performance without a user-facing borrow checker, using the **Perceus reference counting with reuse** model. Rank incorporates key principles from this architecture:

1. **Parameter Borrow Inference (No RC Churn on Calls):**
   - In naive RC, passing a tensor into a function increments and decrements reference counts.
   - In Rank, function arguments that are only read (e.g. `A length`, `A mean`, `A max`) are classified as **borrowed references**. Entering and exiting the function does not trigger `noteArrayBinding`. The caller retains exclusive ownership, preventing accidental CoW de-optimization.
2. **Drop-Reuse & In-Place Morphing (Buffer Recycling):**
   - When a tensor operation drops an owned buffer and immediately allocates a new one of identical or smaller byte capacity (such as an elementwise unary transformation, `reshape`, or transposition), the allocator **recycles the existing backing buffer** instead of returning memory to the system allocator and calling `malloc`.
3. **Compile-Time In-Place Lowering (Automatic In-Place Modification - ACI):**
   - If static lexical analysis (`tensor-use.ts`) proves that an array variable has no active aliases throughout its scope, the compiler elides the `isSharedArray` check entirely, lowering writes directly to unconditional pointer stores.

---

### 5. Mitigating the Performance Cliff via Static Analysis & JIT

Rank deploys four layers of protection to eliminate the Swift performance cliff:

| Defense Layer | Mechanism | Impact on Performance Cliff |
|---|---|---|
| **Layer 1: Reset-to-Unbound** | Fresh CoW copy is marked `owners = 1` | Caps accidental in-loop copy cost to $1 \times O(N)$ rather than $N \times O(N)$. |
| **Layer 2: Vectorized Primacy** | Whole-tensor updates (`A Mask = 0`, `A += Delta`) | Operations are atomic transformations; no per-element allocation cascades. |
| **Layer 3: Kernel Fusion (ADR-0003)** | JIT fuses intermediate pipelines into CPU registers | Intermediates never reach the heap; zero CoW overhead. |
| **Layer 4: Static LSP Linting** | Abstract interpreter (ADR-0002) checks loop aliasing | Warns at edit-time if an alias is repeatedly created inside a loop body. |

---

### 6. Snapshot Semantics on Overlapping Writes
For complex multi-cell updates or permutations:
```rank
Matrix Rows Columns += Delta
```
- All targets, slice selectors, previous cell values, and right-hand expressions are evaluated and captured into temporary registers **before any physical write occurs**.
- This guarantees snapshot semantics: overlapping reads and writes within the same statement can never produce read-after-write corruption.

---

### 7. Compact Typed Storage Backends
To bypass JavaScript object overhead on numeric arrays:
- Byte arrays and binary data use contiguous `Uint8Array` buffers (`RankBytes`).
- Segment trees use flat contiguous typed arrays (`RankRangeSumSegment`).
- Dense real matrices leverage flat `Float64Array` buffers, preparing direct transfer to WebGL/WebGPU shaders.

## Consequences

### Positive
* **Mathematical purity with C speed:** Developers write pure equational code without worrying about defensive copies, while uniquely owned arrays run at native contiguous memory speeds.
* **Immunity to the $O(N^2)$ loop cliff:** The Reset-to-Unbound invariant ensures that aliased arrays pay for sharing once on the first iteration, preventing allocation cascades in loops.
* **Zero annotation overhead on mobile:** No lifetime annotations, borrow checkers, or linear capabilities clutter 40-column phone screens.
* **Exploratory REPL freedom:** Variables remain inspectable across notebook and terminal cells without being consumed.
* **Predictable snapshot updates:** Complex matrix updates behave deterministically without race conditions or read-after-write bugs.

### Negative / Trade-offs
* **Initial $O(N)$ allocation on shared write:** The first write to a genuinely shared buffer incurs an allocation cost.
* **Dynamic alias escape boundaries:** If an array escapes into an opaque host callback or dynamic table structure, static uniqueness inference falls back to runtime `owners` checking.

## References
* [docs/adr/language/0101-value-semantics-and-copy-on-write.md](../language/0101-value-semantics-and-copy-on-write.md)
* [docs/adr/implementation/0002-abstract-interpretation-and-symbolic-shape-inference.md](0002-abstract-interpretation-and-symbolic-shape-inference.md)
* [docs/adr/implementation/0003-tensor-kernel-fusion-and-execution-planner.md](0003-tensor-kernel-fusion-and-execution-planner.md)
* Reinking, Xie, de Moura, Leijen. *"Perceus: Garbage Free Reference Counting with Reuse"*, PLDI 2021.
* Lorenzen, Leijen. *"Fully In-Place (FIP) Functional Programming"*, ICFP 2023.
* Richard Feldman. *"Roc: A fast, friendly, functional language"*.
