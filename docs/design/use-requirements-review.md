# Use requirements: implementation review

Issue: [#69](https://github.com/kmmbvnr/rank/issues/69).
Base revision: `bdc82a2d56447a89ced8697d66fe5db4227f42ba`.

## Scope and related work

This change implements static requirements and contradiction diagnostics. It
uses #33 and #116 as design context; checked input syntax and collection
infinity settlement remain separate work, as agreed for this worktree.

| Related issue | Consequence for this implementation |
| --- | --- |
| [#65](https://github.com/kmmbvnr/rank/issues/65) | Reuse builtin shape signatures for applicable exact relations. |
| [#66](https://github.com/kmmbvnr/rank/issues/66) | Reuse symbolic dimension identities without rewriting forward facts. |
| [#64](https://github.com/kmmbvnr/rank/issues/64) | Empty frames must retain runtime behavior; a skipped cell supplies no unconditional body requirement. |
| [#67](https://github.com/kmmbvnr/rank/issues/67) | Preserve existing ragged-lift diagnostics and forward contracts. |
| [#56](https://github.com/kmmbvnr/rank/issues/56) | Extend the demo coverage benchmark with separate requirement metrics. |
| [#33](https://github.com/kmmbvnr/rank/issues/33), [#116](https://github.com/kmmbvnr/rank/issues/116) | External data expectations cannot become proofs until runtime validation establishes them. |

## Prerequisites found in the code

1. The old diagnostic treated ordinary `rank R` as an axis index. Runtime
   semantics clamp oversized positive ranks and accept negative ranks. Fix that
   diagnostic while retaining the separate rules for reductions and axes.
2. `min` and `max` select ordered values, including text and records. Their
   numeric signature did not justify a numeric result or rank zero for unknown
   operands. Keep precise known domains; otherwise retain the possible ordered
   result types (and SQLite expressions for unknown `max`) without a fixed rank.
3. Both passes need the same completed-unary-call boundary: `2969 text sort`
   must not become a binary `sort` call. Extract the existing rule into
   `unaryApplicationHead`, preserving builtin shadowing behavior.

No runtime redesign is required for this scope. The new solver, graph, AST
collector and diagnostic formatting have separate modules. Their ownership and
exclusion from runtime/optimization proofs are checked by the semantic boundary
script. The detailed contract and conservative limits are in
[ADR 0002](../adr/implementation/0002-abstract-interpretation-and-symbolic-shape-inference.md).

## Semantics checked during implementation

- Fresh function-call variables prevent independent polymorphic calls from
  constraining each other. Uncalled functions still have requirement summaries.
- Stable bindings retain rank; rebinding can change axis lengths and cell
  domains. Missing placeholders do not establish a binding contract.
- Exact dimensions propagate through aliases and function templates. Ordinary
  broadcasting does not impose equality between operand dimensions.
- Guards, zero-trip loops, captured writes, unknown callbacks and unresolved
  source imports retain conservative boundaries. Work budgets bound template
  expansion and solving, and expose `limited` to callers.
- Two-site diagnostics fit the 40-column notebook, appear before execution and
  retract after an edit. Requirements do not produce editor type hints.
- Some proposed issue examples need current operation names: `lower` is the
  text operation here; `append` writes files; builtin `parse` takes two operands.
  Tests use valid current syntax instead of adding special cases for examples.

## Reproduction

```sh
npm test
node benchmarks/analysis-coverage.mjs --conflicts
node benchmarks/refactor-analysis-latency.mjs
```

The coverage benchmark reports requirements separately from forward inference.
A known result type can be a union; the ordered-extrema correction broadens some
old numeric answers rather than treating them as precise numeric proofs.
Measurements and verification counts are recorded in
[`2026-10-02-use-requirements.json`](../../benchmarks/baselines/2026-10-02-use-requirements.json).
