# 0102. Numeric Tower and Division Semantics

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Lexical Syntax Specification

## Context

Mainstream languages exhibit subtle and frequent numerical bugs:
1. **Integer overflow:** Fixed 32-bit or 64-bit integers silently overflow into negative numbers, corrupting combinatorial algorithms and competitive programming puzzles (e.g. Project Euler problems computing $2^{1000}$ or factorials).
2. **Ambiguous division:** In C/Java, `/` performs integer truncation if operands are integers (`5 / 2 == 2`), but float division if one is a float (`5.0 / 2 == 2.5`). This introduces off-by-one errors when refactoring types.
3. **JavaScript's single `Number` type:** Historically using IEEE-754 double floats for everything loses integer precision past $2^{53} - 1$.
4. **Implicit lossy coercion:** Implicitly converting floating-point values to integers on assignment hides precision loss.

Rank requires an arithmetic model suitable both for exact algorithmic puzzles (Euler, combinatorics) and fast numeric/ML computing (tensors, linear algebra).

## Decision

Rank establishes a **strict two-level numeric tower** with explicit division semantics and arbitrary-precision integers:

### 1. Arbitrary-Precision `integer`
- Integers have **unlimited precision** (backed by BigInt semantics). They never overflow or wrap around.
- Operations on integers (addition, subtraction, multiplication, non-negative powers `N ^ P`) produce exact, arbitrary-precision `integer` results.
- Critical for mathematical puzzles and combinatorics without requiring special `BigInteger` wrapper classes.

### 2. Double-Precision `real`
- Reals represent standard IEEE-754 binary64 floating-point numbers.
- Used for machine learning, statistics, physics simulations, and transcendental functions (`sin`, `sqrt`).

### 3. Explicit Division Semantics (`/` vs `//`)
To eliminate ambiguity, Rank strictly separates real and floor division:
- **`/` always performs real division:** Even when dividing two integers, `/` always yields a `real`:
  ```rank
  4 / 2    rem => 2.0 (real)
  5 / 2    rem => 2.5 (real)
  ```
- **`//` performs floor division:** Two integers produce an exact `integer`:
  ```rank
  5 // 2   rem => 2 (integer)
  ```
  An operation involving a `real` produces a floored `real`.

### 4. Numeric Promotion Rules
- **Mixed arithmetic promotes to `real`:** Operating on an `integer` and a `real` (e.g. `2 + 3.5`) promotes the result to `real`.
- **Pure integer operations stay `integer`:** If all operands are `integer`, arithmetic remains exact.

### 5. No Implicit Coercion on Assignment
Rank forbids silent conversions between integers and reals during assignment. Type changes must be explicit:
```rank
Whole = Fraction integer      rem Explicitly truncates finite real toward zero
Floating = Count real         rem Explicitly converts integer to real
```

### 6. Rank-Polymorphic Conversion
Conversion words are ordinary rank functions:
```rank
"1203" integer            rem Parses complete text as 1203
"1203" integer rank 0     rem Converts individual digit characters => 1 2 0 3
```

## Consequences

### Positive
* **Mathematical correctness:** Large-number puzzles (Euler 16, 20, 25, 48) work out-of-the-box without integer overflow or external math libraries.
* **Unambiguous division:** `/` never secretly truncates; programmers never need to write `5.0 / 2` to force float division.
* **Type safety:** Strict assignment prevents accidental loss of precision.

### Negative & Trade-offs
* **BigInt overhead:** Arbitrary-precision arithmetic is slower than fixed-width 64-bit CPU machine registers for large loop counters unless optimized by the compiler via scalar range inference.

## References
* Section "Scalars and arithmetic" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* Commit `0bf8020` ("Implement real arithmetic and LeetCode median")
* Initial commit `f8ef89b` (2026-09-08)
