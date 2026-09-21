# 0203. First-Class Boolean Masks for Selection and Assignment

* **Status:** Accepted
* **Date:** 2026-09-08 (Clarified with lazy mask semantics in commits ded3a0d and f2eade5)
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Product Decisions Section 6

## Context

In mainstream languages, filtering collections typically relies on higher-order functions with lambda expressions (e.g. `list.filter(x => x > 0)` in JavaScript, `[x for x in list if x > 0]` in Python).

On narrow 40-column screens and touchscreen keyboards:
- Lambda closures (`x => ...`) and anonymous functions add excessive horizontal syntax and bracket noise.
- Array languages (APL, J) use boolean vectors for selection (compression / replicate), but express them via cryptic glyphs (e.g. `/` in APL or `#` in J).
- In some systems, masks can have confusing dual semantics (sometimes acting as indices, sometimes as values).

Rank requires a selection primitive that is concise, declarative, reads naturally without lambdas, and works identically across arrays, tensors, and tables.

## Decision

Rank establishes **first-class boolean masks** as the fundamental selection and conditional update primitive:

1. **Masks are ordinary first-class values:** Any elementwise comparison or predicate applied to a collection produces a boolean sequence:
   ```rank
   EvenMask = Numbers even
   Positive = Values greater 0
   ```
   Masks can be bound to names, passed to functions, and stored like any other value.

2. **Explicit selection via juxtaposition (`Source Mask`):**
   Applying a mask to a collection selects elements where the mask evaluates to `true`:
   ```rank
   Fib = fibonacci to Limit
   Mask = Fib even
   Answer = Fib Mask sum
   ```
   For tables, the exact same syntax applies:
   ```rank
   Adults = Users (Users .Age at least 18)
   ```

3. **Boolean mask composition:**
   Masks compose naturally using standard word-based boolean operators without modifying the source:
   ```rank
   M3 = N % 3 equal 0
   M5 = N % 5 equal 0
   Selected = N (M3 or M5)
   ```

4. **One unambiguous meaning for a mask:**
   A mask is strictly a boolean sequence. Materializing or iterating over a mask always yields boolean values (`true` / `false`), never the source values. Selection is always explicit (`Source Mask`). The runtime/planner is responsible for fusing `Source Mask` so intermediate boolean arrays are not allocated in memory.

5. **Masked assignment (conditional mutation):**
   A boolean mask can appear on the left-hand side of an assignment to conditionally update elements in-place:
   ```rank
   Negative = Pred less 0
   Pred Negative = 0
   ```

6. **Short-circuiting masked selectors (`first where`, `first index where`, `take while`):**
   Ordered rank-1 values and masks support early-stopping operations:
   ```rank
   rem Stop immediately on the first true condition:
   Match = Values first where Mask
   Position = Values first index where Mask

   rem Keep leading items while mask remains true:
   Prefix = Values take while Mask
   ```
   - When traversing infinite streams (e.g. `primes`), `first where` halts as soon as the condition is satisfied without reading the rest of the stream.
   - If no element matches, it raises `.Missing`, composing cleanly with `default`:
     ```rank
     Answer = (Candidates first where Prime) default 0
     ```
   - `take while` lazily consumes leading elements and closes the iterator at the first `false`.

## Consequences

### Positive
* **No lambda boilerplate:** Eliminates the need for closure syntax, callback arguments, and anonymous functions for everyday filtering.
* **Readable dataflow on small screens:** Breaking filtering into a named mask and explicit selection (`Mask = ...; Result = Data Mask`) fits comfortably within 40 columns.
* **Declarative conditional updates:** Masked assignment (`A Mask = 0`) replaces verbose imperative `for/if` loops.
* **Zero-copy optimization opportunities:** Because masks are first-class and declarative, the execution planner can push selections directly into data sources (e.g. SQLite pushdown or SIMD vector masks).

### Negative & Trade-offs
* **Need for compiler fusion:** Naive evaluation of `Mask = A greater 0; B = A Mask` would allocate an extra boolean array. The runtime engine must implement lazy mask evaluation and kernel fusion.

## References
* Core Principles 10, 11 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Section 6 ("Boolean sequence masks and explicit selection") in [docs/design/product-decisions.md](../design/product-decisions.md)
* Section "Boolean addressing" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* Commits `ded3a0d` (mask syntax) and `f2eade5` (boolean sequence mask semantics)
