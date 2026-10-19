# Big-integer popcount and text search

Measured on Node v24.15.0, macOS arm64. Three fresh processes per case.

The baseline is `e6ee5bb3`, the behavior-preserving search refactor on top of
`6510ae24`; its built interpreter outputs were frozen before implementation.
The candidate runtime is `d38e1a66`. Later catalogue/documentation edits do not
change the measured algorithms. These compare implementation against the
refactored baseline, not the total effect of all commits against the old main.

Reproduce after building:

```sh
node benchmarks/bit-text-search.mjs
# Optional: --baseline=/absolute/path/to/baseline/out/index.js
```

Raw samples: [2026-10-19-bit-text-search.jsonl](baselines/2026-10-19-bit-text-search.jsonl).

## Operation medians

Times below exclude input construction and process/module startup, include
conversion, matching/counting, and result construction. The popcount rows call
the actual native builtin, without parsing a Rank expression. Each sample is
one call except the tiny case (10,000 calls, divided by 10,000).

| Case | Baseline ms/call | Candidate ms/call |
| --- | ---: | ---: |
| tiny | 0.000170 | 0.000169 |
| dense250k | 1703.956708 | 1.762250 |
| dense1m | Not run | 2.737583 |
| dense4m | Not run | 6.613333 |
| sparse4m | 0.299000 | 0.288750 |
| four4m | 0.993625 | 0.902334 |
| characters | 89.271208 | 80.300208 |
| substring | Not run | 24.468958 |

`dense250k`, `dense1m` and `dense4m` are all-one integers of the given bit
length. `sparse4m` has one set bit; `four4m` has four widely spaced set bits.
`tiny` counts 13. The old dense 1M/4M cases were not run because repeated
BigInt clearing is quadratic. Substring matching was unavailable in the
baseline, so it has no comparable timing.

`characters` finds all 500,000 ones in one million alternating binary
characters. `substring` searches a million `a` characters followed by `b` for
10,000 `a` characters followed by `b` (one match at 990,000). Every output
position is validated outside the operation timer.

The 4M-bit operation median is below the issue's 100 ms target. This is not a
cold-process guarantee: that case has a candidate cold-execution median of
244.286 ms.
Raw samples separately report startup, construction, operation, cold execution
through operation completion, and parent-observed process wall time.

## Euler 167

The unchanged default demo returns **3916160068885** in every sample.
The existing demo uses `binary`/single-character `findall`, not `popcount`.
It therefore checks integration and regressions, rather than demonstrating
a dense-popcount speedup.

| Median | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| operationMs | 1096.684 | 1088.907 |
| executionColdMs | 1368.320 | 1333.387 |
| processMs | 1394.910 | 1372.041 |

Euler operation time includes parsing and full interpreter execution. Cold
execution also includes module loading and interpreter setup; process wall
time adds child startup/teardown. Do not infer a meaningful Euler speedup
from these closely spaced samples. Euler was rerun separately after the
ordinary test process stopped to avoid mixing CPU contention into the report.

## Costs and limits

- Hex conversion and scanning use temporary storage proportional to bit length.
  Four bounded bit-clearing steps preserve tiny/sparse performance without an
  unbounded quadratic loop. This does not claim lower peak heap usage.
- Text search uses streaming KMP with a pattern and prefix table proportional
  to pattern length. It reports code-point positions and overlapping matches.
  `findall` additionally stores every result; `find` stops at the first match.
- Scan/preparation loops poll for cancellation, including KMP failure links.
  Native BigInt-to-string conversion and allocation themselves are not
  cooperatively interruptible.
- Empty text targets retain the previous no-match behavior. Array searches
  retain whole-element equality; multi-character batched/default queries use
  the ordinary ranked path rather than a character-position index.
