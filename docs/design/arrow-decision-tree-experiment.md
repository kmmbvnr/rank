# Arrow storage experiment: Deep-ML decision tree

This experiment uses [`demos/deepml/020_tree.ra`](../../demos/deepml/020_tree.ra),
without a database or input files. It generates four categorical columns in
memory: three binary features and a binary class. The class depends on two
features, so learning requires multiple splits rather than one perfect root
split. Values repeat frequently; these results do not represent high-cardinality
text columns or general-purpose Arrow performance.

Three modes receive identical generated values:

- `rows`: current Rank `ownedArray` of `ownedObject` rows, read by a JS learner.
- `arrow`: an `apache-arrow` v21.2.0 table, read by the **same** JS learner.
- `rank`: current Rank rows, passed to the actual `learn_tree` function from
  the demo. Its parsing/registration setup is timed separately.

The JS learner follows the demo's categorical information-gain and branching
rules but groups rows in one pass per attribute; the Rank implementation builds
masks and subarrays. All modes produce exactly the same complete tree, checked
against an independent column-array oracle. The `rows`/`arrow` timings isolate
storage access within one algorithm; `rank` is a functional control, **not** a
prediction of an Arrow-backed interpreter's speed.

Apple M5, Node v24.15.0, five fresh-process runs per mode and size, alternating
order; medians from 2026-09-23:

| Rows | Mode | Build ms | Learn ms | Retained MiB |
| ---: | --- | ---: | ---: | ---: |
| 1,024 | Rank rows + JS | 0.84 | 1.68 | 0.67 |
| 1,024 | Arrow + JS | 2.36 | 1.69 | 0.28 |
| 1,024 | Rank `learn_tree` | 0.82 | 24.06 | 0.43 |
| 8,192 | Rank rows + JS | 3.43 | 13.50 | 4.57 |
| 8,192 | Arrow + JS | 5.20 | 7.32 | 0.52 |
| 8,192 | Rank `learn_tree` | 4.36 | 114.88 | 4.36 |
| 32,768 | Rank rows + JS | 13.42 | 57.51 | 18.06 |
| 32,768 | Arrow + JS | 8.88 | 22.71 | 1.26 |
| 32,768 | Rank `learn_tree` | 12.54 | 444.31 | 17.86 |

Rank `learn_tree` setup (parsing and registering the demo) took about 90–92 ms
and is excluded from `Learn`. Source generation, input oracle, and output-tree
validation are excluded from timing. Memory is the post-GC change in
`heapUsed + arrayBuffers` after construction and release of the original
columns. It is retained memory, not peak RSS or the memory used while learning.
Small differences between the two Rank-row memory figures reflect different
process baselines and GC noise; compare storage primarily within the same
JS-learner modes.

At 32,768 rows, Arrow retains about 14 times less memory and the JS learner
runs about 2.5 times faster. At 1,024 rows, learning time is effectively tied
and Arrow construction is slower. This is evidence for a columnar table
prototype, not for replacing Rank's general arrays: the experiment neither
implements Arrow in Rank nor tests Rank's masking and value semantics on Arrow.

Run from the isolated worktree after `npm install` and `npm run build`:

```sh
node benchmarks/arrow-decision-tree.mjs
```
