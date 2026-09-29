# 0205. Slices and Sequence Bounds

* **Status:** Accepted
* **Date:** 2026-09-29
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing

## Context

Mainstream languages slice with brackets and colons (`array[start:end]`, `&array[start..end]`, `A[1:4, 2:5]`) and bound streams with library calls (`takeWhile`, `dropWhile`, `itertools.islice`). Rank has no square brackets or colons ([ADR-0202](0202-whitespace-juxtaposition-for-addressing.md)), so it needs words, and the words should be few: one for each kind of boundary, with the same meaning for numbers, sequences and positions.

## Decision

Four words bound values, and each continues a pipeline from left to right:

| Boundary | Inclusive | Exclusive |
|---|---|---|
| Upper | `to X` (≤ X) | `till X` (< X) |
| Lower | `from X` (≥ X) | `after X` (> X) |

1. **After a number, `to` and `till` build a range.**
   ```rank
   Closed = 1 to 10          rem 1 … 10
   Open = 1 till 10          rem 1 … 9
   ```
   [ADR-0103](0103-first-class-numeric-ranges.md) describes ranges and `by`.

2. **After values, they bound them.** A plain value is a bound rather than a value to find, because a sequence need never equal it:
   ```rank
   Fib = fibonacci to 4000000     rem items at most 4000000
   Small = primes till 100        rem items below 100
   Large = primes from 100        rem from the first item at least 100
   Next = primes after 101        rem from the first item above 101
   Window = primes after 100 till 200
   ```

3. **A slice is a range selector.** Addressing with a range selects a contiguous run by position:
   ```rank
   Closed = Text (L to R)
   Open = Text (L till R)
   Columns = Matrix # (2 till 5)
   ```
   `#` keeps a whole axis, so the range selects along the next one. Text is sliced by Unicode code point. Over a SQLite view the range becomes `LIMIT` and `OFFSET`, and over a SQLite text expression it becomes `substr`.

4. **`till` and `from` also take a condition.** `till` stops before the first item that meets it; `from` starts at the first item that meets it. The condition's subject is the item, as in `filter`: a comparison with its right operand, a predicate, a function of one argument, `not` and the logical words over those, or a mask.
   ```rank
   Leading = fibonacci till greater 50
   Word = "hello world" till equal " "
   Run = Values till not even
   Big = primes from greater 100 take 5
   ```
   `to` and `after` take only a value.

5. **`take` and `drop` count items.** The count follows the word:
   ```rank
   FirstFive = primes take 5
   NextFive = primes drop 5 take 5
   ```

6. **Conditions are one predicate.** A condition ends where its predicate does, so the pipeline continues after it, and bounds chain in either order:
   ```rank
   fibonacci till 1000 filter even
   fibonacci filter even till 1000
   Answer = fibonacci to Limit filter even sum
   ```

7. **Bounds are semantic, seeking is an optimization.** A bound reads items in order on any rank-1 value. An ordered source such as `primes` or `fibonacci`, or a filter over one, seeks to a plain bound or to a `greater`/`at least` condition instead of reading up to it. Both paths give the same items.

## Consequences

### Positive
* **One rule for every boundary.** `to` includes and `till` excludes, whether the left side is a number, a sequence or a position.
* **Pipelines read left to right.** A bound can follow a filter, a filter can follow a bound, and a named intermediate is needed only for clarity.
* **Every sequence accepts a bound.** Generators, filtered sequences and ranges all accept the four words, not only sources with a special plan.
* **Touchscreen ergonomics:** primary-layer words instead of brackets and colons.

### Negative & Trade-offs
* **Reserved words.** `take`, `drop`, `from`, `after` and `till` cannot name a function.
* **A mask is not a bound.** `Fib (Fib less 1000)` never ends on an endless `Fib`, because `less` tests items; `Fib till 1000` ends it.

## References
* Section "Slices and ranges" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* Section "Bounds" in [docs/language/sequences-arrays.md](../../language/sequences-arrays.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* ADR-0103: [First-Class Numeric Ranges (to, till, by)](0103-first-class-numeric-ranges.md)
* ADR-0203: [First-Class Boolean Masks](0203-first-class-boolean-masks.md)
