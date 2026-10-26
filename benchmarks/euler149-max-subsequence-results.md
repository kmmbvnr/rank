# Euler 149: reshape views and integer prefix consumers

The latest concat changes help the unchanged Euler 149 program. Array reshape
now also preserves shape and flat indices without completing computed cells.
An integer `scan +` consumes the resulting native view directly into its final
prefix buffer. The program and fixture are unchanged, including default
`N = 2000`, answer **52852124**, and all three test blocks.

## Behavior

For arrays with known geometry, reshape validates the element count before
reading cells. Stored scalars retain the existing copy-on-write sharing path.
Computed arrays retain a checked identity mapping of flat indices, with a new
shape. Repeated reshapes, concat, transpose and other supported views can feed
one native consumer without intermediate reshape buffers.

This intentionally removes reshape's former implicit completion boundary.
Shape errors still occur when constructing the view; errors from unread cells
occur on demand. Ordinary assignment, ordinary parameters, writes and explicit
copy still complete values. Repeated plan observations recompute their cells;
no result memoization was added. Text, queues and finite sequences retain their
one-pass construction of indexable storage.

The new prefix consumer supports rank-one native integer arrays, `scan +`, and
an optional integer seed. Its output includes the seed when supplied. Integer
storage widens without truncating arbitrary-precision sums. Native provenance,
reader identity, shapes, revisions, recursive contracts and operator guards
remain checked. Host readers, unsupported domains, named callbacks, observable
execution and unavailable dynamic code generation retain ordinary execution.

## Measurements

Apple M5, Node v24.15.0. Each table gives medians of three serial fresh-process
samples, with alternating version order. Parsing and complete Rank execution
are timed. Peak RSS is sampled before independent oracle validation; it is
process high-water memory, not retained storage. Diagnostics run separately.
Historical concurrent issue #447 inventory times are not comparable.

Immutable runtime snapshots were used throughout. The baseline is `029bda1e`;
the concat version is `72eed54e`. All snapshots share unchanged compiled modules.
The three changed baseline modules were reconstructed from their committed
TypeScript using TypeScript 5.9.3 with ES2020/ESNext output. The view-only snapshot
changes `modules/sequences.js` from the concat snapshot. The final snapshot also
contains the prefix consumer in `reduction.js`, `tensor-map.js` and
`tensor-kernel.js`. Raw files record source and relevant runtime hashes.

First, the concat commit alone, with the original reshape behavior:

| Compiled main | Time, s | Peak RSS, MiB |
| --- | ---: | ---: |
| Before concat | 9.331 | 1216.4 |
| Native concat consumers | 8.556 | 1063.8 |

That is an **8.3% time reduction** and **12.5% lower peak RSS**.
[Raw concat comparison](baselines/2026-10-26-euler149-concat.json).

The separate controlled reshape/prefix comparison:

| Compiled main | Time, s | Range, s | Peak RSS, MiB |
| --- | ---: | ---: | ---: |
| Concat baseline | 8.721 | 8.449–8.753 | 1063.1 |
| Reshape views only | 8.593 | 8.506–8.767 | 1197.7 |
| Views and direct integer prefix consumer | 5.714 | 5.701–5.777 | 939.2 |

Views alone have overlapping timing ranges and increase peak RSS by about 13%.
They remove buffers but expose the source chain to generic per-cell scan reads.
The final prefix consumer removes that traversal cost: **1.53x faster**, with
**34.5% less time** and **11.6% lower peak RSS** than the concat baseline.
The improvement must not be attributed to reshape views alone.
[Raw main measurements](baselines/2026-10-26-euler149-reshape-main.json).

| Workload and engine | Concat baseline, s | Final, s | Baseline RSS, MiB | Final RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Full fixture, compiled | 8.892 | 5.953 | 1066.2 | 926.1 |
| Main, reference | 18.634 | 17.206 | 1389.7 | 1083.2 |

The fixture is **1.49x faster** in compiled mode. Reference execution has no
native prefix consumer: its **7.7% time reduction** and **22.1% lower peak RSS**
come from the reshape-view change.
[Fixture measurements](baselines/2026-10-26-euler149-reshape-fixture.json),
[reference measurements](baselines/2026-10-26-euler149-reshape-reference.json).

Separate diagnostics for the compiled main:

| Counter | Concat baseline | Final |
| --- | ---: | ---: |
| Generic derived-cell computations | 4,004,000 | 4,000 |
| Compiled tensor executions | 32 | 12 |
| Element-type scanned cells | 4,024,000 | 4,000,000 |
| Typed cells unpacked | 4,000,000 | 4,000,000 |

The generator remains one compiled Number loop. Final prefix buffers and the
other arrays required by the current algorithm still occupy linear space.
This change does not remove all materialization or typed-buffer exposure.
[Raw diagnostics](baselines/2026-10-26-euler149-reshape-diagnostics.json).

## Correctness and verification

Every timed main compares **all four directional maxima** and its answer/output
with independent scalar Kadane walks. The oracle generates the lagged sequence
directly and uses no padding, skewing, prefix arrays or Rank implementation.
Every fixture sample checks all three test blocks and their complete output.
Validation follows timing and RSS sampling.

Additional correctness-only probes cover `N = 1, 2, 3, 4, 10, 50, 100` in both
engines, including the nonempty negative answer at `N = 1`.
[Small checks](baselines/2026-10-26-euler149-small-checks.json).

Verification completed:

- TypeScript build and interpreter test typecheck.
- Semantic boundary and application-form checks.
- **8,580 tests in 377 ordinary interpreter files**, excluding the exhaustive
  types/differential corpora and Nurikabe.
- **Four scoped type/differential checks** covering both full Euler 149 files.
- **68 final focused tests** for reshape views, scans and native completion.
  The new reshape suite has 34 tests, including selective reads, error timing,
  assignment and parameter completion, independent writes, missing cells, empty
  producer effects, short-circuiting, integer overflow, seeds, demand budgets,
  failure/retry and CSP fallback.

The demo algorithm, fixture assertions, execution lanes and deadlines are
unchanged. The semantic change to computed-array reshape is documented in the
language and stdlib references.

## Reproduction

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-max-subsequence.mjs --samples=3
node benchmarks/euler-max-subsequence.mjs --samples=3 --engine=reference
```

To compare prebuilt immutable interpreter snapshots:

```sh
node benchmarks/euler-max-subsequence.mjs --versions=concat,after --samples=3 \
  --concat=/path/to/72eed54e/packages/interpreter/out/index.js \
  --after=/path/to/current/packages/interpreter/out/index.js
```

Use `--cases=main` or `--cases=fixture`, and run `--diagnostics=true --samples=1`
separately from timing comparisons. The harness also accepts `--before=...`
and custom named snapshot paths through `--versions=...`.
