# 0300. Intentional Intermediate Variables Over Vertical Pipelines

* **Status:** Accepted
* **Date:** 2026-09-09
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Product Decisions Section 2

## Context

Many modern functional and query languages favor deeply chained vertical pipelines or pipeline operators (`|>` in Elixir/F#, fluent dot-chaining in JS/Kotlin/Pandas, or linear piped queries in PRQL):
```text
data |> filter(...) |> transform(...) |> reduce(...)
```
While expressive on widescreen desktop IDEs with wide horizontal margins, this paradigm introduces severe ergonomic friction on handheld devices:
1. **Narrow screen awkwardness:** Long fluent chains or nested pipeline blocks easily exceed the ~40-column limit, forcing awkward multi-line wrapping and indentation churn.
2. **Hidden tensor shapes:** In array and tensor processing, each transformation alters tensor rank or dimension (e.g. 1D -> 2D via windowing). Monolithic pipelines obscure intermediate shapes, making shape mismatches hard to trace.
3. **REPL inspectability on mobile:** On a mobile terminal or pocket calculator REPL, debugging a chained expression requires manually breaking up and editing the chain.

## Decision

Rank establishes **explicit, named intermediate variables as the canonical idiom** over long vertical pipelines or dedicated pipe operators (`|>`):

```rank
use sequences
Digits = array 1 2 3 4 5
Width = 3
Windows' = Digits window Width
Products' = Windows reduce * rank 1
Answer = Products max
```

1. **Short, meaningful intermediate names:** Developers are encouraged to name values by their role or state (`Range`, `States`, `Windows`, `Products`), avoiding generic placeholders (`Temp`, `Result2`).
2. **40-column line budget:** Each assignment line forms a distinct, self-contained algorithmic transformation fitting comfortably within 40 columns.
3. **Short postfix pipelines remain supported:** Compact, unambiguous postfix expressions (`Fib Mask sum`, `Text reverse print`) are permitted where they stay readable and intuitive on a single line.
4. **Explicit evaluation boundaries:** `Name' = Expr` names a deferred stage; `Name = Expr` computes and stores its result. A finite sequence becomes an array, and lazy array cells are completed recursively. Fusion can cross deferred stages. An ordinary binding retains its completion, validation and effect timing even when the compiler can reuse a buffer.

## Consequences

### Positive
* **Self-documenting code:** The algorithmic steps document themselves through variable names without requiring extra inline comments.
* **Effortless REPL debugging:** Any intermediate stage (`Windows`, `Products`) can be directly inspected or printed in the REPL without modifying the source code.
* **Preserves BASIC simplicity:** Aligns with the approachable, transparent mental model of BASIC.

### Negative & Trade-offs
* **Need for naming discipline:** Authors must invent concise names for intermediate stages rather than relying on anonymous pipeline stages.
* **Explicit retention choices:** Authors choose which stages to defer and which results to retain. Repeated demands of a plan repeat its computation and effects; an ordinary binding retains the result. Naming a stage does not promise that its operations can be fused.

## References
* Section 2 ("Intentional intermediate variables over vertical pipelines") in [docs/design/product-decisions.md](../design/product-decisions.md)
* Core Principle 14 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Commit `bd1f560` (2026-09-09)
