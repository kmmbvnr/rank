# 0203. First-Class Boolean Masks for Selection and Assignment

* **Status:** Accepted
* **Date:** 2026-09-29
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

1. **Masks are ordinary first-class values:** Any elementwise comparison or predicate applied to a collection produces booleans, one per item:
   ```rank
   EvenMask = Numbers even
   Positive = Values greater 0
   ```
   Masks can be bound to names, passed to functions, and stored like any other value.

2. **Explicit selection via juxtaposition (`Source Mask`):**
   Applying a mask to a collection selects the items at the positions where the mask is `true`:
   ```rank
   Fib = fibonacci to Limit
   Mask = Fib even
   Answer = Fib Mask sum
   ```
   For tables, the exact same syntax applies:
   ```rank
   Adults = Users (Users .Age at least 18)
   ```

3. **A mask is positional.** Its first flag selects the first item of whatever it is applied to, whichever value it was made from. A mask made from one value can select from another:
   ```rank
   Mask = Labels equal Wanted
   Cluster = Points Mask
   ```
   Source and mask are read in lockstep. A mask shorter than the source ends the selection where it ends, so a finite mask bounds an endless source; a source that ends while the mask still has flags is an error:
   ```rank
   Mask = fibonacci till 1000 even
   Even = fibonacci Mask
   rem 2 8 34 144 610
   ```
   Nothing checks lengths in advance, which an endless sequence could not allow.

4. **Boolean mask composition:**
   Masks compose with the word operators `and`, `or`, `xor` and `not`, position by position, without modifying the source:
   ```rank
   M3 = N multiple by 3
   M5 = N multiple by 5
   Selected = N (M3 or M5)
   ```

5. **One meaning for a named mask.**
   A mask holds booleans. Materializing or iterating over it yields `true` and `false`, never source values, and `count`, `any` and `all` read those booleans. As a calculator convenience, a numeric operation in the same pipeline as the predicate reads the values it selects: `Fib even sum` adds the even Fibonacci numbers. A mask read by its name has left that pipeline, so a numeric operation on it is an error that names both explicit spellings:
   ```rank
   Mask = Fib even
   Fib Mask sum
   rem Mask sum is an error: write `Values Mask sum` or `Mask count`
   ```
   The runtime may still remember where a mask came from, but only to push its test into the source when the mask selects from that same source. That memory never changes a result.

6. **Masked assignment (conditional mutation):**
   A boolean mask can appear on the left-hand side of an assignment to conditionally update elements in-place:
   ```rank
   Negative = Pred less 0
   Pred Negative = 0
   ```

7. **A mask does not stop a sequence.** `less 1000` is a predicate: over `fibonacci` it is `false` forever after 987, so `Fib (Fib less 1000)` never ends. Ending a sequence is the job of `till` ([ADR-0205](0205-slices-and-sequence-bounds.md)): `fibonacci till 1000`. An optimizer may recognize a monotonic source and stop early, but the meaning does not depend on it. A preview of a selection that finds nothing more gives up after a budget of passed-over items and shows `...`.

8. **Short-circuiting selectors (`first where`, `first index where`):**
   `first where` takes a condition whose subject is the source, as `filter` does, or a mask:
   ```rank
   Match = Values first where greater 10
   Position = Values first index where Mask
   ```
   - On an infinite stream such as `primes`, `first where` stops at the first match without reading the rest.
   - If no element matches, it raises `.Missing`, composing cleanly with `default`:
     ```rank
     Answer = (Candidates first where Prime) default 0
     ```

## Consequences

### Positive
* **No lambda boilerplate:** Eliminates the need for closure syntax, callback arguments, and anonymous functions for everyday filtering.
* **Readable dataflow on small screens:** Breaking filtering into a named mask and explicit selection (`Mask = ...; Result = Data Mask`) fits comfortably within 40 columns.
* **Masks travel:** because a mask is positional, it can be built from one column and applied to another, or combined with a mask of a different value.
* **Declarative conditional updates:** Masked assignment (`A Mask = 0`) replaces verbose imperative `for/if` loops.
* **Zero-copy optimization opportunities:** Because masks are first-class and declarative, the execution planner can push selections directly into data sources (e.g. SQLite pushdown or SIMD vector masks).

### Negative & Trade-offs
* **Need for compiler fusion:** Naive evaluation of `Mask = A greater 0; B = A Mask` would allocate an extra boolean array. The runtime engine must implement lazy mask evaluation and kernel fusion.
* **Two readings of `sum` after a predicate:** `Fib even sum` adds values while `Mask sum` is an error. The rule is syntactic, one pipeline, and the error message names the explicit form.

## References
* Core Principles 10, 11 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Section 6 ("Boolean sequence masks and explicit selection") in [docs/design/product-decisions.md](../design/product-decisions.md)
* Section "Boolean addressing" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* [ADR-0205](0205-slices-and-sequence-bounds.md): `to`, `till`, `from`, `after`, `take` and `drop`
