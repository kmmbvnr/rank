# Euler 427: fold the two binomial sums

2026-11-06. Full answer **97138867** is unchanged. The main improvement is
algebraic: combine the two inclusion-exclusion sums before enumeration. The
program also makes table ownership explicit in ordinary Rank functions, so
all three numeric loops use the existing Number compiler.

## Identity and domain

The original program computes `Total = S1 - S2`, using

```
A(m,k) = sum_p C(m-p*k,p) * n^(m-p*(k+1)) * g^p
S1 = sum_k A(n-1,k)
S2 = sum_k A(n-1-k,k)
g = 1-n
```

Shift the second sum's index from `p` to `p-1`. For each `p>=1`, set
`r=n-1-p*k`, `l=n-p*(k+1)`. Combining the two terms gives

```
r! / (p! * l!) * n^l * g^(p-1) / n * (g*(r+1)-p)
```

The range is exactly `p*(k+1)<=n`, `k>=1`. The unmatched first-sum `p=0`
contribution is `(n-1)*n^(n-1)`. At `l=0`, the first binomial is zero and the
combined expression still includes the second term correctly; no negative
power lookup is required. All computation is modulo 1000000009. As with the
original factorial-inverse formulation, positive n is below the prime;
the default n=7500000 satisfies this. n=0 is handled directly.

For each p, factor `g^(p-1)/(n*p!)` out of its row. The remaining polynomial
factor advances by subtracting `g*p` modulo the prime when k increases.
Accumulate a row before reducing its sum. The runtime still checks Number
safety and replays exactly if needed; the default has no replay.

The scalar event loop walks the `(p,k)` domain without nested Rank loops.
Separate table and inverse-factorial functions each contain one loop. Table
entries use meaningful names, and the source avoids unnecessary conversions
and repeated materialization. Only half as many sign powers are needed.

## Compiler findings

The original table loop writes three global arrays. The existing copy-cost
policy charges all three speculative destinations; it does not admit that
large multi-destination loop in Number mode. This is an intentional policy,
covered by `number-loop-adaptive.test.ts`, rather than a missing operation.
Moving allocation together with its producer into an ordinary function makes
those arrays private. The compiler already handles this general ownership
case, and the final program has three Number loops with no overflow or
copy-budget fallback. No compiler threshold or language semantics changed.

An ownership-only control retaining the old formula also reaches three
Number loops, but one run took 14.351 s / 352 MiB. It does not deliver the
combined program's speed or memory result. Keeping the algorithm unchanged
and merely forcing admission would miss the larger opportunity.

## Measurements

Node v24.15.0, paired base `7fe23511`, matching language build on both hosts.
Three alternating fresh-process runs per source variant; no runtime patch
is hidden in the comparison. Wall times vary with uncontrolled host load.
RSS is process peak memory, not retained heap.

| Full n=7500000 | Original | Final |
| --- | ---: | ---: |
| Mac compiled median | 15.580 s | 7.184 s |
| Mac median peak RSS | 330 MiB | 281 MiB |
| Intel compiled median | 30.177 s | 12.574 s |
| Intel median peak RSS | 336 MiB | 271 MiB |

This is about **2.17x** faster on Mac and **2.40x** on Intel, with lower peak
memory. The old 56-second compiled exclusion was stale before this change.

Three alternating reference controls at n=100000 on Mac improve median
**8.868 -> 4.830 s**, peak RSS **182 -> 185 MiB**. This bounded reference
control has a small memory increase; do not generalize its timing to the
full input. Full default reference remains manual and was not run here.

A separate three-way experiment compares retaining the sign table with
updating its coefficient by recurrence. The latter removes about 15 MiB but
requires extra modular products. Medians for table / recurrence:

| Variant control | Sign table | Recurrence |
| --- | ---: | ---: |
| Mac full time | 7.124 s | 8.155 s |
| Mac peak RSS | 282 MiB | 267 MiB |
| Intel full time | 12.666 s | 12.966 s |
| Intel peak RSS | 271 MiB | 257 MiB |

Retain the sign table: the Mac timing cost outweighs that modest additional
memory reduction, and Intel shows no convincing speed benefit. The final
program already uses less memory than the original.

The paired final source precedes the last local `Tail` alias used to avoid
two parenthesis pairs on one line. Integrated checks use the delivered
source. Later main changes for `unique counts` were integrated at `c7bbb9b6`;
matching language/interpreter builds are used for integrated verification.

## Verification and reproduction

- Independent bounded-run DP counts strings by their current run length and
  number of possible color changes. It uses neither factorials nor the
  inclusion-exclusion identity. 32 sizes, including zero, odd/even boundaries
  and 100, across reference/exact/Number execution: **96 comparisons per host**.
- All **25 focused tests** pass on Mac and Intel, including the full default
  answer, exactly three Number loops and no numeric replay/copy-budget fallback.
- The Rank fixture passes in all three modes, including repeated module runs
  and the boundary answers n=0/1/2 -> 0/1/6. Existing statement checkpoints
  n=3/7/11 and n=60/100 are retained.
- TypeScript builds pass. Exhaustive type/differential audits were not run.

[Raw measurements](baselines/2026-11-06-euler427-followup.json) retain the
primary pairs, variant controls, bounded reference samples and integrated
confirmation. From `packages/interpreter`:

```sh
node scripts/test.mjs test/euler427.test.ts
```

From the repository root after the normal TypeScript build:

```sh
node benchmarks/experiments/euler427-verify.mjs
node benchmarks/experiments/euler427-final-pairs.mjs
node benchmarks/experiments/euler427-final-pairs.mjs reference 100000
```

`euler427-pairs.mjs` reproduces the table/recurrence comparison using the
archived experimental sources. The runner accepts mode, n and source path.
