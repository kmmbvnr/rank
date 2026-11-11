# Effect and suspension boundaries: coverage and performance

Workstream 9 of #565. Baseline `977eb9c0`; measured implementation `25237393`.
Node v24.15.0 on arm64 Mac and x64 Intel. Raw process samples are in
`effect-boundaries-results.json`.

## Protocol and paths

`effect-boundaries.mjs` checks each result against interpretation, parses once,
and records eight fresh-interpreter and twelve prepared-interpreter samples.
Startup, parsing, reference execution and interpreter construction are outside
the timers. Fresh execution includes disposal. Parsed syntax and process caches
are shared: fresh does not mean cold process startup. Scalar-entry compilation
is disabled to expose lower-tier composition; the capability matrix separately
checks ordinary default settings. Output goes to a no-op host callback. These
are compiler/call-boundary measurements, not terminal throughput measurements.

Six independent alternating process pairs per case and host; 1,000 iterations.
Each process contributes the median after discarding its first three samples.
Ratios are paired geometric means; 95% bootstrap intervals resample process
pairs (10,000 draws, seed 565). Tests did not run concurrently on the measured
host. Other system load is uncontrolled. No universal speedup is claimed.

| Case | Work | Changed execution path |
| --- | --- | --- |
| helper | Print in a helper between scalar operations | Generated loop body and framed helper |
| protected | Return through try/finally with output | Generated loop body and protected framed helper |
| generator | Yield in try and finally | Generated suspending loop |
| nested | Simple nested generator reduced by sum | Existing specialized exact loop remains selected |
| nested-protected | Nested generator with inner try/finally | Generated outer and inner suspending loops |
| unique | Scalar accumulation | Existing Number loop remains selected |

Generated boxed control retains checked callouts; it does not turn every
delegated operation into a numeric kernel. Counters identify entries, not
whole-program compiled percentages. COW copies remain zero in these workloads.

## Prepared execution and peak memory

Times are milliseconds. A ratio below 1 means less time. Peak RSS is KiB and
covers the entire process, including reference execution, warmups and diagnostics.

| Host | Case | Before ms | After ms | Ratio [95% interval] | RSS before → after |
| --- | --- | ---: | ---: | --- | ---: |
| mac | helper | 16.316 | 18.033 | 1.054 [0.988, 1.139] | 297,288 → 297,752 |
| mac | protected | 20.503 | 19.054 | 0.966 [0.892, 1.041] | 285,472 → 288,240 |
| mac | generator | 3.934 | 4.007 | 1.040 [0.895, 1.230] | 179,728 → 178,256 |
| mac | nested | 0.733 | 0.733 | 0.968 [0.895, 1.060] | 162,768 → 166,296 |
| mac | nested-protected | 10.042 | 10.054 | 0.906 [0.787, 1.001] | 199,488 → 199,520 |
| mac | unique | 0.079 | 0.074 | 1.024 [0.957, 1.105] | 153,456 → 149,296 |
| intel | helper | 18.446 | 20.101 | 1.084 [0.974, 1.200] | 278,164 → 276,066 |
| intel | protected | 26.930 | 24.157 | 0.883 [0.807, 0.953] | 272,890 → 266,840 |
| intel | generator | 3.369 | 3.214 | 0.947 [0.915, 0.976] | 165,846 → 165,096 |
| intel | nested | 0.813 | 0.772 | 0.977 [0.906, 1.053] | 151,490 → 151,586 |
| intel | nested-protected | 10.330 | 9.738 | 0.934 [0.894, 0.974] | 183,266 → 181,926 |
| intel | unique | 0.074 | 0.088 | 1.075 [0.899, 1.253] | 135,590 → 138,264 |
| mac-gc | generator | 5.316 | 5.426 | 1.011 [0.930, 1.103] | 152,664 → 153,080 |

## Fresh execution including preparation

Times are milliseconds. A ratio below 1 means less time. Peak RSS is KiB and
covers the entire process, including reference execution, warmups and diagnostics.

| Host | Case | Before ms | After ms | Ratio [95% interval] | RSS before → after |
| --- | --- | ---: | ---: | --- | ---: |
| mac | helper | 24.871 | 25.843 | 1.059 [0.918, 1.283] | 297,288 → 297,752 |
| mac | protected | 27.510 | 25.971 | 0.904 [0.820, 0.986] | 285,472 → 288,240 |
| mac | generator | 5.544 | 6.202 | 1.078 [1.004, 1.172] | 179,728 → 178,256 |
| mac | nested | 1.611 | 1.746 | 1.102 [0.965, 1.260] | 162,768 → 166,296 |
| mac | nested-protected | 14.225 | 12.268 | 0.815 [0.758, 0.889] | 199,488 → 199,520 |
| mac | unique | 0.989 | 1.076 | 0.996 [0.833, 1.160] | 153,456 → 149,296 |
| intel | helper | 28.950 | 28.248 | 1.040 [0.960, 1.135] | 278,164 → 276,066 |
| intel | protected | 32.729 | 31.455 | 0.979 [0.939, 1.025] | 272,890 → 266,840 |
| intel | generator | 6.287 | 6.201 | 0.951 [0.896, 1.018] | 165,846 → 165,096 |
| intel | nested | 1.675 | 1.703 | 0.990 [0.920, 1.074] | 151,490 → 151,586 |
| intel | nested-protected | 13.418 | 13.216 | 0.993 [0.937, 1.058] | 183,266 → 181,926 |
| intel | unique | 1.081 | 1.118 | 1.049 [0.995, 1.099] | 135,590 → 138,264 |
| mac-gc | generator | 6.807 | 6.594 | 0.965 [0.894, 1.050] | 152,664 → 153,080 |

## Interpretation and investigation

Intel prepared protected functions, protected generators and nested protected
generators improve in these runs. The helper intervals include 1 on both hosts;
its broader compiled coverage does not establish a speedup. Mac nested protected
fresh execution improves; its prepared interval narrowly includes 1.

An initial Mac run found unnecessary preparation of the general generator
alternative even when the existing specialized consumer ran instead. Preparation
now happens only on entry to the suspending path, and a regression test asserts
that the specialized consumer never invokes its code-generation hook. The final
nested control intervals include 1 on both hosts.

The final ordinary-GC Mac protected-generator fresh ratio is 1.078 [1.004, 1.172].
A separate six-pair run collecting before every sample gives 0.965 [0.894, 1.050]
for fresh execution and 1.011 [0.930, 1.103] for prepared execution. This does not
prove that GC caused the original difference; it shows the small fresh penalty
is not stable across collection regimes. We retain both results and make no
Mac speed claim for this case. The initial and final absolute timings also vary
with uncontrolled system load.

Fresh times include preparation and execution, not isolated compiler-only cost.
The raw report contains first samples and diagnostic `loop.prepare` costs, but
lazy generator preparation occurs later and is not wholly represented by that
counter. Do not interpret it as total compilation time. Peak RSS likewise is
whole-process memory, not retained live memory or a measured allocation rate.

## Validation

- Build: `tsc -b tsconfig.build.json` passed.
- 797 tests passed across 15 focused interpreter suites, including 414 capability
  matrix cases and 17 boundary tests. Matrix comparisons include traced, untraced
  and interpreted behavior; snapshots remove unused generator candidates.
- Tests cover checked callbacks, operand/effect order, wide integers, partial
  generator consumption, nested suspension, array snapshots, deferred capture
  restrictions, return/break/continue, cleanup-error precedence and cancellation.
- Three existing `compiled-array-arguments.test.ts` assertions expect at least
  eight compiled calls but observe six for queue/stack/deque. The same three
  failures reproduce on the clean `977eb9c0` baseline; values still agree.
- Root `npm test` and interpreter exhaustive audits were not run. A broad CLI
  invocation was stopped after discovering its explain test audits all demos;
  no full CLI-suite pass is claimed. CLI diagnostics were then run separately.

Reproduction: run `array-ownership-compare.py` with `--harness
effect-boundaries.mjs`, the two built checkout paths, `--iterations 1000`,
`--repeats 6`, and `--cases helper protected generator nested nested-protected
unique`. Add `--gc --cases generator` for the collection-controlled follow-up.
Use `array-ownership-summary.py` on the combined JSON to regenerate statistics.
