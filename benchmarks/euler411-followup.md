# Euler 411: packed input scans and sorted search

Issue: https://github.com/kmmbvnr/rank/issues/447
Original demo: `c1887c6e`. Baseline runtime and integrated main before delivery:
`4746b95b`, including the concurrent reference-allocation/integer-reader changes.
Node v24.15.0 on macOS arm64 and Linux x86_64.

## Result

The full default still returns **9936352**. The demo maps fifth powers through
small helpers, with no nested loops and at most one loop in each helper.
All lines, including comments, fit 40 columns.

- Pure powers of three use the proved horizontal-path count.
- Tails grow geometrically from at most 1024 cells instead of reserving one
  cell for every generated point.
- Unused tails contain N, above all possible heights. `upperindex` therefore
  searches the entire sorted buffer without a prefix slice. Growth appends
  sentinel cells; each inserted tail preserves the sorted invariant.
- Prime-factor products use the existing array reduction operations.

This retains the period/sort/nondecreasing-subsequence algorithm. Original
point count: 49,935,581; retained point count: 40,330,084.

## General runtime/compiler changes

Numeric regions borrow a packed integer source for a direct scalar scan even
beside private writes to another array. Every use is audited: one data read per
traversal, optional length metadata, no rebinding or vector consumer. Stable
private helpers are permitted. Nested repeated reads retain the prepared path.
The proof works both for loop regions and for whole function bodies.

Each actual BigInt load checks safe Number conversion. Unsafe loads discard
private writes before exact replay; untouched unsafe tails are not pre-read.
Aliases keep their ordinary snapshots because destination buffers stay private.
Budgets and cancellation retain prior preparation and publication paths.

Existing `lowerindex` and `upperindex` operations now lower over numeric
rank-one integer buffers. A small search helper avoids expanding the generated
loop body. Budgeted/cancellable searches retain native observable checkpoints.
Neither precision checks nor the 64-cell/262144 copy admission constants change.

Full-run diagnostics show **40,304,039 packed input cells borrowed** and zero
converted read-buffer cells, with no numeric overflow. This is avoided input
preparation, not a claim that the whole program allocates no arrays.

## Controlled full benchmarks

Three alternating baseline/candidate pairs per host, each in a fresh process.
The control preload restores all three changed runtime modules from baseline
TypeScript. Baseline uses the archived original source; candidate uses production.
All twelve answers match. The Intel snapshot's 380 interpreter output JS modules
are byte-identical to the Mac modules.

| Host | Original, seconds / peak MiB | Delivered, seconds / peak MiB | Speedup |
| --- | ---: | ---: | ---: |
| Mac | 11.214 / 1590.3 | 7.609 / 1144.3 | 1.47x |
| Intel | 23.481 / 829.3 | 14.531 / 496.0 | 1.62x |

Medians of time and peak RSS are calculated separately. Peak RSS fell about
**28% on Mac and 40% on Intel**. Machine load was not controlled and varied
substantially during the investigation. These are final alternating paired
measurements after integration, rather than a comparison across separate
stages. CPU medians also improve: 12.152 -> 8.019 s on Mac, 25.769 -> 15.537 s
on Intel. RSS includes runtime, temporary buffers and garbage collection.

Two further Mac comparisons are single samples, not medians:

| Check at Count=13 | Control | Delivered |
| --- | ---: | ---: |
| Reference, original vs new source | 4.151 s | 2.268 s |
| Same new source, baseline vs new compiler | 1.885 s | 0.263 s |

The second comparison isolates support for sorted search and packed scans on a
bounded input. It is not a claim of a 7.2x full-default compiler-only speedup.
The reference benefits from replacing interpreted per-point binary-search
helper calls with the existing native search operation.

Earlier single full controls of unchanged neighboring demos also kept their answers:
Euler 408 took 2.463 -> 2.392 s, and Euler 410 took 7.319 -> 7.163 s.
Tracked allocation payload and published-cell counts were identical in each
pair. These single samples do not establish an additional speedup.

## Verification

- **1564 focused tests in 53 files passed on each host**, including compiled
  array operations, speculative arithmetic, private aliases, concat, slices,
  budgets, cancellation and real/integer kernels.
- New Euler checks compare all 2n+1 specified stations against the production
  result for 40 inputs on both engines, without period arithmetic or packed
  keys in the oracle. They include powers of two/three, repeated stations and
  a case that grows the tails buffer; existing fixtures and full golden pass.
- Fifteen packed-input regressions cover late overflow, untouched wide cells,
  errors after earlier stores, aliases, source replacement, vector consumers,
  nested repetition, stable helpers, whole functions, budgets and cancellation.
- Ten sorted-search regressions cover lower/upper/equal/end positions, empty,
  singleton, wide and real inputs, writes, errors, budgets and cancellation.
- The existing fixture passed scoped differential execution on both hosts;
  scoped type and name-fact audits passed on Mac.
- Six selected historical regressions passed: Euler 324 is also covered in
  the broad compiled-array suite; the extra run covers Euler 337 at three
  bounds, both orchard-recursion modes, and full Euler 283 with a wide total.
- TypeScript build and interpreter test typecheck, 65 semantic owners and
  application-form checks passed. No full suite or exhaustive audit was run.

The full default reference execution was not timed and remains excluded from
corpus execution audits. Its small fixture remains audited; the exclusion
reason now describes that limitation rather than stale compiled timing.

See `baselines/2026-11-05-euler411-delivery.json` for raw measurements,
source/runtime hashes, diagnostics and verification summaries. The preceding
investigation and rejected prototypes remain in `euler411-investigation.md`.

## Reproduction

```sh
node benchmarks/experiments/euler411-control-build.mjs
node --import ./benchmarks/experiments/euler411-control.mjs \
  benchmarks/euler411-investigation.mjs compiled 1 30 original
node benchmarks/euler411-investigation.mjs compiled 1 30 delivered
node benchmarks/euler411-investigation.mjs reference 1 13 delivered
```

`euler411-borrow-probe.mjs` is an archived research hook for the baseline
runtime; it deliberately rejects the changed runtime. Production needs no hook.
