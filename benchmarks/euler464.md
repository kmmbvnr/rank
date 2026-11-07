# Euler 464: weighted prefix pairs

The original implementation repeatedly sorted packed integer keys at every merge level for each of the two inequalities. The main cost was the counting algorithm and its temporary arrays. Two general copy-admission gaps also prevented useful Number loops in a replacement implementation.

For an interval, let P and M count positive and negative Möbius values. The interval is invalid when either `99P - 100M > 0` or `99M - 100P > 0`. Both cannot be positive: their sum is `-(P + M)`. Thus the answer is the total number of intervals minus the two counts of strict prefix increases. A Fenwick tree counts earlier prefixes strictly smaller than the current prefix.

Zero Möbius values repeat the same prefix. The demo compresses these runs into positive weights and adds `currentWeight * earlierWeight` to each bad count. Pairs inside one equal-prefix run remain valid, as required. For nonzero signs, the first step is `(199 * sign - 1) // 2`; the second prefix is the negative first prefix minus the nonzero position. No floating-point ratios or approximate comparisons are involved.

The sieve and each tree pass live in separate helpers, each with one loop. There are no nested Rank loops. The command line still takes only N and defaults to 20,000,000.

## Compiler changes

Copy admission now recognizes two conservative lower bounds on useful work:

- For a bounded native prime traversal, a fixed set of mathematical prime facts below 256 can prove complete strided passes. This never executes the deferred prime plan, a user callback, or body array cells. Unknown bounds, starts outside the prefix, and possible early exits retain conservative behavior.
- A native Fenwick store contributes one work unit. An invariant range body can combine that work with its existing iteration checkpoints to cover a private snapshot.

The ordinary numeric-range heuristic also excludes prime traversals. Number precision guards, exact replay, and the existing copy thresholds are unchanged. A short loop or possible early exit does not gain admission merely because its container is large.

## Correctness and verification

Independent trial factorization and exhaustive interval enumeration cover N=0 through selected boundaries up to 500. Tests reconstruct the Möbius sequence from compressed signs and weights. Synthetic inputs cover all-zero runs, unequal weights, and both exact 99:100 ratio boundaries. The original imported fixture runs twice through one module (N=10 then 500), plus N=10,000, on the interpreter and both numeric backends. The full compiled test preserves `198775297232878`, uses three Number loops, and has no Number overflow replay.

The ordinary focused integration run passed 2,537 checks in 90 files on both Mac and Intel before the fixture test was strengthened to execute the actual imported file. The strengthened 24-case file passed separately on both hosts. No exhaustive corpus audits were run.

## Alternatives

Nine Mac runs monitored for competing Node workloads compared three variants in cyclic order (three fresh processes each). Weighted compression took a median 4.939 s / 1,336 MiB; unweighted counting 6.367 s / 1,161 MiB; segmented unweighted sieving 7.562 s / 1,068 MiB. The latter variants save memory but lose speed and add code. The weighted implementation was selected. These exploratory samples are separate from the final before/after series; its source subsequently received a line-length-only rewrite introducing the singleton Tail variable.

## Reproduction

Build the interpreter and its dependencies, then run from the repository root:

```sh
node benchmarks/euler464.mjs compiled 20000000
node benchmarks/euler464.mjs reference 100000
```

`RANK464_RUNTIME` can select a frozen interpreter build. `euler464-compare.mjs` compares fresh processes in alternating order, rejects competing Node workloads, and by default requires at least 98% idle CPU with no swap I/O before each Intel run. For the separately labelled ZFS-scrub measurements, `RANK464_ALLOW_IO_WAIT=true` permits idle plus I/O wait of at least 95%, still forbidding active swap. This accepts a known storage background and does not claim an idle host. A busy-host rejection preserves the accepted prefix for later resumption. Full RSS is the process high-water mark, not live array storage. Results include source hashes, CPU time, diagnostic counters, and the answer.

## Measurement conditions

The first Intel original-program sample overlapped two short-lived Python jobs and is excluded. ZFS scrub began during the second original sample at 00:24:01 on November 8; that sample is also excluded. The two earlier new-program samples are retained as quiet-start new-only observations, not mixed with the same-source compiler control under ongoing scrub. No final matched full-original/final pair was accepted on either host. The same-source pair and subsequent controls explicitly record the I/O-background allowance. Foreign high-CPU processes remain forbidden. Several Mac comparison attempts were rejected for other Euler jobs or busy applications; no final paired Mac result is inferred from those attempts.

The raw artifact retains the available excluded full-result samples and their reasons. Older rejected attempts preceded full-result preservation and yielded no usable timing row. An earlier Node-only supplementary monitor cannot rule out storage contention; it is not used to certify the scrub-startup sample. Minor timing differences across these backgrounds should not be interpreted as compiler regressions or gains.

## Results

| Measurement | Old runtime/program | New runtime/program | Peak RSS, MiB |
| --- | ---: | ---: | ---: |
| Intel, same new source, full N (one matched pair under scrub) | 39.782 s | 10.705 s | 1011.1 → 956.1 |
| Intel reference, N=100000 (three pairs under scrub) | 1.821 s | 1.830 s | 269.1 → 392.1 |
| Intel new program, full N (two quiet-start samples, no matched old sample) | — | 10.537 s median | 1011.8 |

The same-source control isolates a useful compiler improvement of about 3.7 times on this workload: Number-loop entries rise from one to three, with no overflow replay. This is one matched pair, not a broad throughput guarantee. The bounded reference run shows no meaningful time improvement and a higher RSS peak. Do not claim a universal memory reduction or reference speedup.

For context, the original full program's earlier exploratory runs took 108.889 s / 2463.5 MiB on Mac and 249.121 s / 2065.2 MiB on Intel. The Mac weighted variant took 4.939 s / 1336.5 MiB median in the separate three-round alternative experiment. These are not matched original/final medians: the repeated later comparisons were rejected for competing work. They support a substantial overall improvement, but not a precise cross-host speedup ratio.

The new full reference execution returned the exact golden answer in 261.604 s, with a peak of 899.7 MiB and zero Number loops. Foreign processes appeared during that run, so its timing is diagnostic only and is excluded from accepted measurement groups. The full reference workload remains in the manual lane; the compiled full-answer regression and small imported fixture remain automated.

Raw counters, source hashes, accepted ranges, exploratory measurements and available rejected samples are in [2026-11-08-euler464.json](baselines/2026-11-08-euler464.json).
