# Data Structures and Value Semantics

Examples developed in this repository for record aggregation, structural sharing and Rank value semantics; see the [language documentation](../../docs/language/values-addressing.md).

- [Missing cells](missing-cells.ra): nullable integer arithmetic, reductions, `present`, and bulk query fallbacks. Run `rank test demos/structures/missing-cells_test.ra`.
- [Successive tensor calls](tensor-calls.ra): normalize batches with shared column statistics while retaining earlier results. Run `rank test demos/structures/tensor-calls_test.ra`.
- [Gather and lookup scores](gather-score.ra): score repeating keys with XOR and a weight table. Run `rank test demos/structures/gather-score_test.ra`.
