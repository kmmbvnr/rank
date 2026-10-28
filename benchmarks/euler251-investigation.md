# Euler 251: bound the existing segmented search

The default input remains `Limit = 110000000`, with answer `18946051`. Keep the full default fixture and the 1,000, 20,000 and 1,000,000 golden cases. Add small boundary cases, including an empty input, direct E=1 candidates and E>=2 candidates. No interpreter or compiler changes are needed: the existing complete outer loop already compiles in Number mode, with no overflows, compiler rejections or COW copies.

## Algorithm

With a=3k-1, b^2 c=k^2(8k-3). Since 4(b+c)^3 >= 27b^2c, b+c >= (15k-3)/4 for k>=1: cubing reduces this conservative inequality to 81k^3+729k^2-405k+27 >= 0. Thus a+b+c >= (27k-7)/4 and `Top = (4 * Limit + 7) // 27` safely bounds k. This replaces a looser bound and corrects the former comment's rounded 6.78k claim.

For each k, the sieve supplies g and h with 8k-3=g^2h. Candidate e divides kg, with b=kg/e and c=e^2h. Count e=1 directly. If 4h exceeds the remaining sum budget, every e>=2 is impossible, so skip its square root and divisibility search. The remaining loop starts at 2.

## Research comparison

Fresh sequential processes, three samples in alternating order, Node v24.15.0/macOS arm64, built runtime from parent main `ade3540c`. Imports excluded; parsing, preparation, evaluation and diagnostics included. No other investigation processes ran during this cohort; host load was not controlled. All four variants return the exact default answer.

| Variant | Median seconds |
| --- | ---: |
| Original | 3.104 |
| Shipping bounded search | 2.624 |
| Closed-form base plus sieve corrections | 2.810 |
| Formula plus sparse exception buffer | 2.784 |

Shipping reduces elapsed time by 15.5%, or 1.18x. The formula counts all b dividing k by summing floor((Limit+3d^2+1)/(8d^3+3d+1)), then adds the missing square-factor cases. Its extra complexity and the sparse buffer do not win in normal compiled execution. No memory savings are claimed; raw process high-water RSS is retained in the baseline.

Single exploratory reference runs were original 85.365s, formula 43.807s and bounded search 53.194s. These are not repeated controlled medians: the original run overlapped some validation. They establish that full reference execution still costs tens of seconds. Both existing execution-budget exclusions remain, with updated explanations. The full fixture is not shortened and no timeout is raised.

## Final delivery verification

After upstream grammar commit `de91d5eb`, generated Langium and built the TypeScript projects in a fresh checkout. A new three-sample alternating cohort gave original **3.066s** and shipping **2.627s**: **1.17x**, or 14.3% less time. This final cohort supersedes the research numbers for the delivery claim. The full fixture passed all three blocks (13 program runs) in both engines. Final fixture timings are retained as single observations in the baseline, not repeated medians. Fresh CLI checks, semantic boundary checks and application-form checks passed.

## Verification and reproduction

The baseline contains the research comparison and 96 oracle/golden checks across four variants and both engines. Small bounds use independent direct enumeration of b, testing exact divisibility of k^2(8k-3) by b^2. Run the shipped fixture in both engines to check all three blocks, including the unchanged full default. CLI checks, semantic boundary checks and application-form checks pass. A broad interpreter/workspace suite was not run because runtime code is unchanged; the budget-excluded files were exercised explicitly instead.

```sh
node benchmarks/euler251-cardanotriplets.mjs
node benchmarks/euler251-cardanotriplets.mjs --variant=original
node benchmarks/euler251-cardanotriplets.mjs --fixture
node benchmarks/euler251-cardanotriplets.mjs --fixture --reference
python3 benchmarks/experiments/euler251-oracle.py --limit=1000
```

Use `--runtime=/absolute/path/to/packages/interpreter/out/index.js` for an isolated built checkout. Use `--Limit=46 --expect=6` for a small main-file check; `--variant=base` and `--variant=sparse` reproduce the alternative algorithms frozen in the baseline JSON.
