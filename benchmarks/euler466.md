# Euler 466: share equal blocker sets

The full P(64, 10^16) answer remains **258381958195474745**. The [official examples](https://projecteuler.net/problem=466) include P(3,4)=8, P(64,64)=1263, P(12,345)=1998 and P(32,10^15)=13826382602124302.

## Program

The inclusion-exclusion algorithm is retained. Each product belongs to its largest table row. For row d, a later row e claims d*c exactly when e/gcd(e,d) divides c. Removing divisibility-redundant blockers gives a canonical set. Inclusion-exclusion merges equal LCM keys after each factor and removes zero coefficients.

Many rows have the same minimal blocker set: the default input has 42 distinct sets and 22 memo hits. The new program uses an ordinary Rank `memo` function with two scalar arguments: the column limit and a bitset encoding the blockers. Both inputs are part of the key; neither depends on captured global variables. Arbitrary-width integers avoid a 64-bit mask limit. The stored set is decoded inside the function, and array operations retain the coefficient computation. Normalizing the dimensions also makes the swapped 10^16 by 64 input practical.

The blocker test becomes an outer remainder matrix instead of a division/multiplication matrix. Existing `lcm` replaces the separate multiply/divide/gcd arrays. There is at most one loop per function or main body, with no nested Rank loops. The program is 64 lines, each at most 40 columns. Ordinary bindings and exact integer arithmetic retain their semantics.

## General runtime improvements

The standard dyadic scalar-ranked `lcm` now uses the existing stored integer mapper. It supports scalar operands on either side, array broadcasting, signed and zero inputs, and results wider than 64 bits. The exact scalar implementation is shared rather than duplicated. Standard-function identity and implementation guards protect user functions; opaque inputs fall back without inspecting their cells. Long work polls for cancellation and publishes an independent result.

Stable signed Int64 sorting now selects 8-bit digits below 1024 cells, 11-bit digits below 65536 cells, and the existing 16-bit digits above that. Short arrays avoid scanning 65536 buckets per pass. The sort still reads exact integer words, preserves equal-key order and supports descending order. Int32 sorting is unchanged.

Native BigInt64 input gets two early witnesses before full Int32 admission: a wide middle or last cell declines that narrower path immediately. If both witnesses fit, every cell is still checked. This avoids scanning a long sorted small prefix before discovering a wide tail; it is not a substitute for the full proof and does not inspect host or lazy cells.

No Number-mode admission limits or overflow behavior change. These are shared runtime array paths, useful with compilation enabled or disabled. The whole inclusion-exclusion function still does not become a Number loop.

## Measurements

Full input, medians of three alternating fresh-process pairs:

| Host / mode | Before → after, seconds | Before → after, peak RSS MiB |
| --- | ---: | ---: |
| Mac compiled | 4.416 → 1.586 | 440.5 → 428.2 |
| Mac reference | 4.519 → 1.626 | 447.9 → 426.8 |
| Intel compiled | 8.958 → 3.453 | 378.3 → 374.7 |
| Intel reference | 8.847 → 3.678 | 392.2 → 376.7 |

These results show a large time reduction and a modest memory reduction, not a large memory saving. RSS is the whole-process high-water mark.

One-pair source/runtime isolation controls:

| Control | Mac seconds | Intel seconds |
| --- | ---: | ---: |
| New source: frozen → current runtime | 1.813 → 1.586 | 4.094 → 3.510 |
| Old source: frozen → current runtime | 4.519 → 4.403 | 8.822 → 8.708 |

The dominant improvement is sharing repeated blocker sets and applying LCM directly. The old-source timing control does not establish a meaningful macro speedup from the sort change. Its RSS also rose from 377 to 416 MiB on Intel and from 442 to 445 MiB on Mac in these single samples; the patch does not establish a universal memory reduction for unchanged programs.

Stored LCM control, 100000 cells, medians of five warmed calls:

| Input | Mac before → after, ms | Intel before → after, ms |
| --- | ---: | ---: |
| Small integers | 7.975 → 4.941 | 25.274 → 13.993 |
| Integers above 2^53 | 11.544 → 6.047 | 33.842 → 17.807 |

Adaptive sort controls use three rotating rounds. At 512 wide cells, Mac falls from 145 to 16 microseconds and Intel from 324 to 37; at 8192, Mac falls from 248 to 145 and Intel from 569 to 339. At 524288 cells, the retained 16-bit path stays approximately unchanged: Mac 10.73 → 10.74 ms, Intel 24.59 → 24.89 ms. A sorted Int32 prefix followed by one wide value benefits from the admission witnesses: at that size, Mac 13.13 → 9.90 ms and Intel 21.38 → 16.31 ms.

Fixed-width controls justify retaining the large-array path. For 131072 mixed-word keys, Intel's 11-bit variant took about 9.53 ms against 7.35 ms for 16 bits, although the Mac slightly favored 11 bits. At 524288, 16 bits won on both hosts. The thresholds are measured choices for these workloads, not universal optimal constants.

The frozen baseline is commit `8616ec6b`; the original Rank source is retained as a fixture. Parsing, analysis and execution are timed; process startup is excluded. Samples alternate order, record hashes and monitor foreign processes. Intel had an ongoing scheduled ZFS scrub: the explicit storage-background lane requires at least 95% idle plus I/O wait, with no swap I/O before a sample. This is not a wholly idle-host comparison. A sample overlapping a foreign CPU job was rejected and retained separately. All 32 accepted samples, the rejection record, ranges and primitive controls are in [2026-11-08-euler466.json](baselines/2026-11-08-euler466.json).

## Verification

396 focused checks in 19 files passed on **both Mac and Intel**. New coverage includes independent direct multiplication-table enumeration; an unmerged inclusion-exclusion oracle over subsets of table rows; zero dimensions; swapped tables; exact limits around 2^53 and above 2^80; memo masks above bit 63 and changed limits; the imported fixture; and the full answer in compiled/reference modes. LCM checks include signs, zero, wide results, broadcasts, independent storage, cancellation, opaque input, unary calls and same-named user functions. Sorting checks cover both thresholds, signed extrema, stable ties, descending order and an interior wide value missed by both witnesses.

The exact-name-filtered differential run passed **both the full main and imported fixture on both hosts**. The full main returns to ordinary audit eligibility, with an explicit exclusion-catalogue assertion. Source and test TypeScript checks, semantic boundaries, application forms and exclusion tests passed. Exhaustive audits and the full npm test were not run.

## Reproduction

Build the interpreter and run from the repository root:

```sh
node benchmarks/euler466.mjs compiled
node benchmarks/euler466.mjs reference
node benchmarks/experiments/euler466-lcm.mjs . small
node benchmarks/experiments/euler466-lcm.mjs . wide
```

`RANK466_RUNTIME` selects a frozen interpreter build. The comparison driver takes baseline build root, output JSONL, host and workload (`full-compiled`, `full-reference`, `same-source`, `compat-source`). `RANK466_ALLOW_IO_WAIT=true` explicitly enables the disclosed storage-background lane; the default Intel lane requires 98% idle CPU.

`benchmarks/experiments/euler466-radix.mjs` takes current build root, output JSONL, control (`widths`, `random`, `adaptive`, `prefix`) and frozen baseline build root. It writes only ignored build-output variants, checks stable order against JavaScript BigInt sorting, and reproduces the digit-width/admission controls. Both consolidated experiment scripts were smoke-tested after packaging.
