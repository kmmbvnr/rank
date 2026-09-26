# 0309. Scalar `and` and `or` as Short-Circuit Guards

* **Status:** Accepted
* **Date:** 2026-09-26
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Lexical Syntax Specification

## Context

`and`, `or` and `xor` were ordinary binary operations: both sides ran before the result was combined. A bounds check therefore could not protect the read that followed it:

```rank
if Position less 8 and Password Position equal ""
```

When `Position` was out of range, the right side still read `Password Position` and failed. The workaround was a nested `if` with a second `end`, which costs lines and indentation on a 40-column screen (ADR-0000).

The same words also combine boolean masks elementwise (ADR-0203), where both sides must always run.

Three options were considered:

1. Short-circuit when the left side is a single boolean (Python, JavaScript).
2. Separate guard words (`and then`, `or else`) and keep `and`/`or` eager.
3. Several comma-separated conditions in `if`.

Option 2 doubles the logical vocabulary for the common case. Option 3 helps only `if`, not `Valid = Position less 8 and Password Position equal ""`.

## Decision

After a single boolean, `and` and `or` are guards:

* `false and X` is `false` and `true or X` is `true`; `X` is not evaluated, so its errors and effects do not happen.
* Otherwise the right side runs and must also be a single boolean. A mask after a flag (`Flag and Mask`) is an error with a hint to write `Mask and Flag`. Without this rule, `Flag and Mask` would be a scalar when `Flag` decides and an array when it does not, which breaks type stability (ADR-0100).
* With an array, sequence or mask on the left, both sides run and combine elementwise, as before.
* `xor` cannot be decided by one side and stays eager.
* The compound assignments `and=`, `or=` and `xor=` keep evaluating their right side; they accumulate masks and flags in loops (`Inside and= NX less W`).

Every execution path follows the same rule: the prepared evaluator, direct scalar evaluation, compiled integer loops and compiled scalar functions emit the right side inside the branch that needs it.

## Consequences

### Positive
* Bounds and presence checks fit in one condition line.
* The meaning matches what readers expect from Python and BASIC dialects with `AndAlso`.
* Mask algebra is unchanged when the mask comes first.

### Negative & Trade-offs
* Whether the right side runs depends on the left value, so an error on the right can hide until the left changes.
* `Flag and Mask` is no longer accepted; existing code must put the mask first.

## References
* Section "Data-first application" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* ADR-0000: [Narrow Screen Target and Mobile-First Ergonomics](0000-narrow-screen-and-mobile-first-ergonomics.md)
* ADR-0100: [Inferred Type Stability and Invariant Variable Binding](0100-inferred-type-stability-and-invariance.md)
* ADR-0203: [First-Class Boolean Masks](0203-first-class-boolean-masks.md)
* ADR-0307: [Statement-Based Conditionals and Branch Scoping](0307-statement-based-conditionals-and-branch-scoping.md)
* Issue #11: short-circuit evaluation for `and` and `or` (2026-09-26)
