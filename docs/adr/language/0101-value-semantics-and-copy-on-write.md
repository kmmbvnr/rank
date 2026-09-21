# 0101. Value Semantics with Copy-on-Write for Arrays and Tensors

* **Status:** Accepted
* **Date:** 2026-09-08 (Updated with full CoW semantics in commit 563af9d)
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Value Semantics Specification

## Context

Mainstream dynamic languages (Python, JavaScript, Ruby) treat arrays, lists, and matrices as mutable reference objects. When an array is assigned to a new variable or passed to a function:
1. **Silent mutation bugs:** Mutating the array in the callee or through an alias secretly corrupts the caller's data:
   ```python
   # In Python / JS:
   b = a
   b[0] = 99  # Silently mutates 'a' as well!
   ```
2. **Defensive copying tax:** To protect integrity, programmers must sprinkle defensive copies (`a.clone()`, `list(a)`) throughout their codebase.
3. **Loss of equational reasoning:** It becomes difficult to reason about whether a data transformation is pure or carries hidden side effects.

Pure functional languages (Haskell, Clojure) solve this with persistent data structures, but tree-based structures carry significant memory indirection and CPU cache overhead compared to flat contiguous arrays.

## Decision

Rank establishes **strict value semantics with transparent Copy-on-Write (CoW)** for arrays and tensors:

### 1. Variables Hold Values, Not Shared References
Assignment, argument passing, `yield`, and storage inside collections give the receiver an independent value. A write through one name is **never visible** through another:

```rank
use sequences
A = array 1 2 3
B = A
B 0 = 99
```
`A` remains `1 2 3` and `B` becomes `99 2 3`.

Functions cannot mutate caller arguments. To hand a modified array back, functions must return it:
```rank
fun bump V
  V 0 = 99
  return V
end
A = array 1 2 3
C = A bump
rem A is still 1 2 3; C is 99 2 3
```

### 2. Copy-on-Write Under the Hood
Value semantics describes what the language *means*, not what the memory allocator *does*:
- Memory buffers are shared read-only until an actual mutation occurs.
- A physical memory copy is allocated **only if** the buffer is referenced by more than one owner.
- A uniquely owned array (such as an array created inside a loop or function) is mutated directly in-place without copying:
  ```rank
  A = array shape 1000 fill 0
  for I in 0 until 1000
    A I = I * I  rem Single allocation; zero defensive copies!
  end
  ```

### 3. Closed List of Reference Types
Only structures that inherently represent identity or system state are exempt from value semantics:
- Records and JSON/table `object` handles;
- Graph structures and disjoint-set unions (DSU);
- Specialized algorithmic structures (`index`, `queue`, `deque`, `stack`, `heap`, `set`, `counter`, `fenwick`, segment trees);
- System resources (file handles, SQLite databases).

Everything else — numbers, text, symbols, dates, arrays, and tensors — is an immutable value.

## Consequences

### Positive
* **Freedom from mutation bugs:** Functions can safely accept and process arrays without risk of corrupting caller state.
* **No defensive copy boilerplate:** Programmers never write `.copy()` or `.clone()` defensively.
* **Predictable equational reasoning:** Arrays behave like primitive numbers.
* **Cache-friendly performance:** Backed by flat contiguous memory blocks with zero copying when buffers have a single owner.

### Negative & Trade-offs
* **Runtime reference tracking:** The interpreter and runtime must track buffer reference counts or revision versions to decide when to perform a CoW clone.
* **Non-in-place multi-consumer writes:** If an array is shared across multiple variables, a subsequent write incurs an $O(N)$ allocation cost.

## References
* Section "Values and sharing" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* [docs/design/value-semantics.md](../design/value-semantics.md)
* Commit `563af9d` ("Make arrays values with copy-on-write")
