# 0103. First-Class Numeric Ranges (to, until, by)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing

## Context

Most programming languages provide special syntax or functions for integer intervals:
- Syntax tokens: `1..10` (Rust/Ruby), `1...10` (Swift).
- Builtin functions: `range(1, 11)` (Python).

On mobile touchscreens:
1. **Punctuation friction:** Consecutive dots (`..`, `...`) are awkward to type and easy to miscount.
2. **Inclusive vs. Exclusive ambiguity:** Developers frequently confuse whether dots include or exclude the upper bound.
3. **Magic direction hazards:** Some environments guess step direction automatically, which can mask algorithmic bugs where start unexpectedly exceeds stop.

## Decision

Rank introduces **word-based, first-class numeric range sequences**:

### 1. Distinct Words for Boundary Inclusivity
- **`to` (inclusive upper bound):**
  ```text
  1 to 3  =>  1 2 3
  ```
- **`until` (exclusive upper bound):**
  ```text
  1 until 3  =>  1 2
  ```

Ranges are first-class, lazy sequence values. They can be bound to names (`R = 1 until 1000`), iterated in `for` loops (`for i in 1 to 10`), or evaluated as arrays.

### 2. Explicit Stepping with `by`
A step is specified using the `by` keyword followed by a non-zero integer:
```text
1 to 9 by 2         => 1 3 5 7 9
10 until 0 by -2    => 10 8 6 4 2
```
- **Strict step direction:** The bounds never guess the direction. If the step points away from the target (e.g. `1 to 5 by -1` or `5 to 1`), the range is immediately empty.
- A zero step (`by 0`) is a runtime error.

## Consequences

### Positive
* **Self-evident semantics:** `to` and `until` eliminate off-by-one errors regarding boundary inclusion.
* **Touchscreen friendly:** Typed entirely using primary-layer letters and digits.
* **First-class sequences:** Ranges are regular values that compose naturally with the rest of the language without special loop-only restrictions.
* **Deterministic iteration:** Strict direction checking prevents runaway loops on inverted bounds.

### Negative & Trade-offs
* **Word length:** Words take slightly more horizontal characters than `..`, but eliminate enclosing parentheses and brackets.

## References
* Section "Slices and ranges" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* Core Principles 2 & 3 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
