# 0205. Slices and Sequence Bounds

* **Status:** Accepted
* **Date:** 2026-09-08 (revised 2026-09-29: `take`, `drop`, `from` and `till` clauses)
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing

## Context

Mainstream languages slice with brackets and colons (`array[start:end]`, `&array[start..end]`, `A[1:4, 2:5]`) and bound streams with library calls (`takeWhile`, `itertools.islice`). Rank has no square brackets or colons ([ADR-0202](0202-whitespace-juxtaposition-for-addressing.md)), so it needs words.

Rank used to overload three words for this. `to` and `until` built ranges, bounded ordered sources by value (`primes until 20`) and ended positional slices (`A from 2 until 6`); `from` was both a lower value bound and the start of a slice. `take` and `drop` put the count before the word (`primes 5 take`). The same word meant a position in one place and a value in another, only some sources accepted a bound, and a bound could not follow a filter: `fibonacci filter even until 1000` did not parse.

## Decision

Each word has one job, and every one of them continues a pipeline from left to right.

1. **A slice is a range selector.** `to` and `until` only build ranges, and addressing with a range selects a contiguous run by position:
   ```rank
   Closed = Text (L to R)       rem includes position R
   Open = Text (L until R)      rem excludes position R
   Columns = Matrix # (2 until 5)
   ```
   `#` keeps a whole axis, so the range selects along the next one. Text is sliced by Unicode code point. Over a SQLite view the range becomes `LIMIT` and `OFFSET`, and over a SQLite text expression it becomes `substr`.

2. **`take` and `drop` count items.** The count follows the word:
   ```rank
   FirstFive = primes take 5
   NextFive = primes drop 5 take 5
   ```

3. **`from` and `till` bound by a condition.** `from` starts at the first item that meets its condition and keeps it; `till` stops before the first item that meets its condition. The condition's subject is the item, as in `filter`: a predicate, a comparison, a function of one argument, or a mask.
   ```rank
   Big = primes from greater 100 take 5
   Small = fibonacci till big
   Prefix = Values till (not Below)
   ```

4. **A plain value is a bound, not a match.** A sequence may never equal a given value, so `till Limit` keeps items at most `Limit` and `from Limit` starts at the first item at least `Limit`:
   ```rank
   Fib = fibonacci till Limit
   Candidates = primes from 100
   Below = primes till at least Limit
   ```
   `till Limit` is `till greater Limit`; the strict form, which keeps items below `Limit`, is written `till at least Limit`.

5. **Conditions are one predicate.** A clause's condition ends where its predicate does, so the pipeline goes on after it, and clauses chain in either order:
   ```rank
   fibonacci till 1000 filter even
   fibonacci filter even till 1000
   Answer = fibonacci till Limit filter even sum
   ```

6. **Bounds are semantic, seeking is an optimization.** `till` and `from` read items in order on any rank-1 value. An ordered source such as `primes` or `fibonacci`, or a filter over one, seeks to a plain bound or to `greater`/`at least` instead of reading up to it. Both paths give the same items.

7. **Former spellings are diagnosed.** `primes until 10` says a range is not a sequence bound and suggests `till`; `A from 2 until 6` suggests a range selector; `primes 5 take` and `take while` name their replacements.

## Consequences

### Positive
* **One meaning per word.** Positions use ranges, counts use `take`/`drop`, value bounds use `from`/`till`.
* **Pipelines read left to right.** A bound can follow a filter, a filter can follow a bound, and a named intermediate is needed only for clarity.
* **Every sequence accepts a bound.** Generators, filtered sequences and ranges all accept `from` and `till`, not only sources with a special plan.
* **Touchscreen ergonomics:** primary-layer words instead of brackets and colons.

### Negative & Trade-offs
* **The strict bound is longer.** "Primes below Limit" is `primes till at least Limit`, where it used to be `primes until Limit`. When the limit cannot itself occur, `till Limit` gives the same items.
* **`take`, `drop`, `from` and `till` are keywords.** They can no longer name a function.

## References
* Section "Slices and ranges" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* Section "Sequences" in [docs/language/sequences-arrays.md](../../language/sequences-arrays.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* ADR-0103: [First-Class Numeric Ranges (to, until, by)](0103-first-class-numeric-ranges.md)
* ADR-0203: [First-Class Boolean Masks](0203-first-class-boolean-masks.md)
