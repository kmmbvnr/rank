# Explicit copy fusion

The first array-output stage extends the existing tensor expression compiler.
An expression ending in `copy` can allocate a fresh array and compute each cell
in one generated loop. It uses the same expression nodes and private-name
analysis as reduction fusion.

These forms share the compiled path:

```rank
return (A * A + A * 2.0 + 1.0) copy
```

```rank
Squared = A * A
Shifted = Squared + A * 2.0 + 1.0
return Shifted copy
```

Assigning the copied result before returning it also works. Repeated references
to a private intermediate share its per-cell computation. Observable or captured
intermediates retain ordinary execution.

The initial domain is equal-shaped materialized arrays with scalar operands.
The compiler preserves expression order, integer arithmetic and numeric
promotion. Unsupported inputs decline to ordinary execution. Filters that change
cardinality do not use the copy terminal yet. No automatic materialization is
introduced, and the result has independent writable storage.

Guards run in the generated loop. A failed guard can discard an unpublished
partial result and use ordinary execution to produce the original error. Input
binding only accepts existing materialized storage; it does not call lazy readers
or user functions. The fresh output is published only after a successful run.
Nonfinite numeric values also retain ordinary execution.

## Measurement

Run `node benchmarks/array-output-fusion.mjs` after building. The fixture checks
all outputs against an independent JS polynomial and records parsing/preparation,
first-call time and five alternating warm calls. First-call time excludes the
oracle check. Output materialization is included. Compilation coverage and
generated source are collected in a separate untimed interpreter.

The baseline checkout is `c20dc62`. Measurements use Node 24.15.0 on Apple M5.
Two independent runs compare the unchanged baseline with this compiler change.
At one million real cells, warm medians were:

| Form | Baseline, ms | Copy fusion, ms |
| --- | ---: | ---: |
| Inline return | 235.54 / 231.82 | 9.25 / 9.32 |
| Named intermediates | 243.01 / 242.83 | 9.42 / 9.33 |
| Assignment then return | 238.22 / 235.58 | 9.33 / 9.27 |

The inline expression improves by about 25 times. At 100K cells it improves
from roughly 15 ms to 1 ms. The handwritten JS control takes about 1 ms at 1M,
so generated dispatch and numeric checks remain worth profiling. Empty inputs
are measured in microseconds; these runs do not establish a small-input win.
These are operation measurements, not claims about whole-program speedups.

Raw data and full demo-suite comparisons accompany this page in
`benchmarks/baselines/2026-09-12-copy-*.json`. The raw commit field identifies the
checkout base; the modified checkout was measured before committing.

## Remaining work

The [fusion plan](tensor-fusion-plan.md) continues with profiles of unchanged
Deep-ML 019, Deep-ML 015 and Euler 008. They require more than this copy terminal:
broadcasting in standardization, reductions over axes/cells, and overlapping
windows. Choose and validate each extension separately. Recheck worker economics
after those local paths improve.

## Validation

All 1016 TypeScript tests passed (45 language and 971 interpreter), including
24 new copy-fusion cases. The existing tensor cell-copy tests remain intact.
Two runs of all 1168 demo tests in 334 files passed on each revision, with
identical per-file test counts and output digests.

Whole demo-suite times were 27.89 / 27.54 seconds before and 29.00 / 27.91 seconds
after. These sequential runs do not establish a whole-suite speedup; the strong
gain is in explicit materialization fixtures. Benchmark runs were separate from
the final test run. The first focused baseline run overlapped the end of a test
run, so the isolated repeat is the stronger timing evidence.
