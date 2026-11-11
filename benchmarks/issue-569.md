# Call and collection overhead: issue 569

## Method

Baseline: `9177bb48`, including the delivered nightly repairs. Node 24.15.0,
Mac ARM64 and Intel x64. The nightly harness checks identical source hashes
and complete answers in fresh processes, alternating before/after order for
three pairs. Times below are medians, not confidence bounds. CPU profiles are
separate from timing comparisons. Full suites and exhaustive audits are not
part of this targeted check.

Raw samples: [baseline archive](baselines/2026-11-11-issue-569.json).

## Speed 1 and 2: positional recursive bridge

A bounded arity-specialized bridge keeps arguments and their Number conversions
in local variables. It creates argument arrays only on error or tail-transfer
paths. Arity above 16 retains the existing generic implementation. Static
admission reasons are selected during preparation; hooks, polling, demand
budget and read-only admission remain dynamic. Overflow replay, backoff,
recursion depth and return contracts retain their previous behavior.

| Case | Mac before / after, s | Intel before / after, s |
| --- | ---: | ---: |
| Euler 505, input 100000000000 | 4.055 / 3.807 | 12.315 / 10.638 |
| Euler 452, default input | 0.603 / 0.593 | 1.674 / 1.638 |
| Euler 792, default input, control | 14.385 / 14.368 | not measured for this bridge |

Euler 505 improves by 6.1% on Mac and 13.6% on Intel by median. Mac's three
candidate samples range from 3.617 to 4.297 seconds: the smaller Mac benefit
is noisy. Intel improves in all three pairs. This does not establish the same
speedup at Euler 505's default input of 1000000000000.

A separate static-conditions-only experiment at the default Euler 505 input
changes the median from 65.849 to 66.247 seconds on Mac and 195.415 to 187.943
seconds on Intel. Euler 452 changes from 0.606 to 0.593 and 1.645 to 1.665
seconds respectively. Static folding alone is not a consistent acceleration;
it is retained as part of the measured positional bridge.

Verification: TypeScript and 206 focused tests in nine files, including
recursive calls, tail calls, function composition, private state, observation,
wide-input replay and the arity boundary. The previous static-only experiment
passed 76 focused tests.

Repeat the bridge comparison:

```sh
CASES=452,505 ROUNDS=3 \
CASE_INPUTS='{"505":{"args":["100000000000"],"answer":"459260736097816346"}}' \
node benchmarks/experiments/nightly-2026-11-11.mjs BEFORE AFTER
```

Set `PROFILE_DIR` to save CPU profiles; profiled runs are marked in the JSON
and must not be mixed with timing samples. The remaining issue items are still
under investigation.
