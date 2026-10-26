# Euler 125: accumulate consecutive squares with early stopping

The previous array algorithm constructs a grid of 10,000 starts and 668 lengths:
6,680,000 cells at the default limit 100,000,000. Only 371,234 runs are valid;
they produce 368,979 distinct candidate numbers and 166 distinct palindromes.

The new search accumulates squares for each start. Positive squares make the
sum strictly increasing, so reaching the limit ends that run. When the first
two squares already reach the limit, every later start can be skipped. It visits
371,234 valid sums and 7,070 stopping sums, or 378,304 inner additions. Decimal
digits are reversed arithmetically; only palindromes enter the set. Its 168
occurrences collapse to 166 distinct values before summation.

The search compiles as one exact integer loop with the existing runtime. No
compiler or interpreter implementation changes are involved. Default input,
strict upper bound, positive-square requirement, minimum run length two and
answer **2906969179** are preserved. The fixture keeps the default and 1,000
example (answer **4164**) and adds boundary checks: limit 5 gives 0, limit 6 gives 5.

## Controlled measurements

Apple M5 / Node v24.15.0, three serial fresh processes per version/workload/engine,
reversing order on alternating samples. Parsing and complete execution are timed;
interpreter construction, module imports and independent validation are excluded.
Peak process RSS is sampled before validation and is not retained-storage size.
No tests or profiles ran concurrently.

Both versions use the same interpreter build. The baseline is the archived array
program with **`End = St + Ln` already applied**, from the previous optimization
step. It is not the original lazy-End version. Both versions run the same
four-test fixture, including the two added boundary checks.

| Engine | Workload | Before, s | After, s | Speedup | Before peak RSS, MiB | After peak RSS, MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Compiled | Main | 3.783 | 0.190 | 19.9x | 658.2 | 169.3 |
| Compiled | Fixture | 3.835 | 0.210 | 18.2x | 651.6 | 171.7 |
| Reference | Main | 3.818 | 0.960 | 4.0x | 569.1 | 176.2 |
| Reference | Fixture | 3.953 | 0.975 | 4.1x | 662.7 | 178.3 |

The reference comparison demonstrates an algorithmic gain independently of loop
compilation. The additional compiled-mode gain comes from existing loop support;
it should not be attributed entirely to either algorithm pruning or compilation.

Separate diagnostics change compiled loops from zero to one, generic derived-cell
computations from 27,460,213 to zero, and record 168 compiled set-add effects.
The latter are the palindrome occurrences before deduplication.

Every timed main checks the exact answer and output. A separate prefix-sum oracle
uses rectangular enumeration and text reversal, independently of the selected
accumulation/digit-reversal implementation. Baseline runs compare all 368,979
candidates; selected runs compare the complete set of 166 palindromes. Every
fixture checks all four tests and their printed answers. Oracle validation runs
after the timing and RSS sample.

## Reproduction and verification

After building, run serially without concurrent tests or profiling:

```sh
node benchmarks/euler-palindromic-sums.mjs --samples=3
node benchmarks/euler-palindromic-sums.mjs --samples=3 --engine=reference
node benchmarks/euler-palindromic-sums.mjs --samples=1 --cases=main --diagnostics=true
```

The same four scoped type/differential checks pass for both full Euler files and
both engines. They retain the original golden assertions and exercise the two
strict-boundary cases. This demo-only change does not rerun the full interpreter
suite or change execution lanes, exclusions or deadlines.

Raw data: [compiled comparison and diagnostics](baselines/2026-10-26-euler125-pruned-runs.json),
[reference comparison](baselines/2026-10-26-euler125-pruned-runs-reference.json).
