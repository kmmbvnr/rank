# 0107. Universal Missing-Value Fallback via default Keyword

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing Specification

## Context

Handling missing or out-of-bounds data in mainstream languages suffers from three competing anti-patterns:
1. **Silent `null` / `undefined` poisoning:** Languages like JavaScript, Python, and Lua return `undefined` or `None` on missing dictionary keys or out-of-bounds accesses. This silently infects downstream math operations, deferring errors until a mysterious `TypeError: cannot read property of undefined` crashes the program far from the origin.
2. **Exception boilerplate (`try/catch`):** Languages like Python (`KeyError`, `IndexError`) and Java (`IndexOutOfBoundsException`) throw exceptions, forcing developers to write verbose multi-line `try ... except` blocks that break the 40-column mobile line budget.
3. **Fragmented APIs:** Different structures require different fallback APIs: `dict.get(k, default)` for maps, `getattr(obj, 'col', default)` for records, `COALESCE(col, default)` for SQL, and explicit length checks for arrays.

Rank needs a single, unified mechanism to handle absent data without introducing a generic `null` pointer type or heavy `try/catch` syntax.

## Decision

Rank introduces the **universal `default` keyword** across all addressable data structures:

```rank
X = A i default 0                    rem Out-of-bounds array access
Last = index Key default -1          rem Missing dictionary key
Age = Data .Age default Median       rem Missing table value
```

### 1. No Silent Nulls
Addressing an absent value without a `default` clause is an immediate runtime error (`MissingValueError`). Rank completely rejects a generic `null` / `nil` primitive value that could silently propagate through calculations.

### 2. Universal Semantics Across Domains
The exact same `default` syntax applies identically to:
- Arrays and tensors (out-of-bounds indices);
- Keyed algorithmic collections (`index`, `counter`);
- Table columns, database rows, and record fields.

### 3. Non-Mutating and Lazy Evaluation
- `default` does not mutate the source structure. To update a table or array with imputed values, ordinary assignment is used:
  ```rank
  Data .Age = Data .Age default Median
  ```
- The fallback expression is evaluated **lazily**, only when addressing finds no value.

### 4. Scope Safety
`default` catches only absent data (out-of-bounds or missing keys). It **deliberately does not hide**:
- Invalid negative indices (e.g. `A -1 default 0` remains an error);
- Arithmetic errors (e.g. division by zero);
- Type mismatches.

## Consequences

### Positive
* **Zero null-pointer bugs:** Calculations never crash downstream due to an unhandled `null` or `undefined` value.
* **Unified API:** Programmers use the exact same keyword whether querying a database column, indexing a matrix, or looking up a hash map.
* **No `try/catch` clutter:** Eliminates bulky exception-handling blocks, keeping lines well within the 40-column budget.
* **Short-circuiting efficiency:** Complex default fallback computations are never executed unless data is actually missing.

### Negative & Trade-offs
* **Right-hand precedence:** Developers must be mindful that the default clause applies to the preceding addressing expression (`A i default 0`), requiring parentheses if the fallback itself is a complex compound calculation.

## References
* Section "Missing-value defaults" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* Initial commit `f8ef89b` (2026-09-08)
