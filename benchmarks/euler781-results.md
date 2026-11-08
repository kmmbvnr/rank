# Euler 781: reuse safe-integer scan storage

Issue: https://github.com/kmmbvnr/rank/issues/558

Count=50000, Mod=1000000007 and the full answer `162450870` are unchanged.
The Rank source, layered recurrence, scans, shifts and concatenations are
unchanged. The repair is in the shared integer storage path.

## Cause and runtime change

A compact integer prefix scan calculates exact safe integer results in a
private Float64 buffer. When a prefix needs more than Int32, it previously
allocated another eight-byte-per-cell buffer and converted every result with
`BigInt64Array.from(out, x => BigInt(x))`. That conversion was repeated over
hundreds of millions of prefix cells in this workload.

Array arithmetic already had a helper that repacks proved safe integers as
Int64 words in the same backing buffer. Move that helper to the storage module,
name it `consumeSafeIntegerBuffer`, and reuse it for wide scans. Read each double
before overwriting its low/high words; account for byte offset, length and host
endianness. No numeric alias escapes or is read after the conversion.

All existing safe-integer and overflow checks precede this conversion. Unsafe
prefixes still decline to the exact path, and cancellation/demand guards are
unchanged. The helper's contract requires private storage and safe integer
cells. It does not make arbitrary Float64 values into Rank integers.

The original Count=10000 CPU profile sampled `scanInt32Axis` and its conversion
callback heavily. Its instrumented time is kept separate from full timings.

## Measurement method

Base revision: `c3780a1f`. Apple M5 arm64 and Intel i7-10750H x64, Node 24.15.0.
Each sample starts a fresh process, includes parsing and excludes imports.
CPU time and peak process RSS are recorded separately. There is one full
baseline and three final samples per host; baseline variance was not measured.
Other machine activity and frequency are uncontrolled. No samples are removed.

Peak RSS is approximately unchanged on Mac and only modestly lower on Intel.
The eliminated per-scan allocation and boxing do not establish a large
whole-process peak-memory saving. Raw data are in `results/euler781/`.

## Full-input results

| Host | Original seconds | Final seconds | Median speedup | Original peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 48.92 | 24.84 / 24.75 / 27.38 | 1.97x | 585.81 | 582.56 |
| Intel | 117.21 | 48.94 / 43.77 / 44.99 | 2.61x | 353.48 | 341.08 |

## Alternatives tested, not shipped

Adding `mod Mod` directly after the suffix scan preserves the final modular
answer and uses the existing modular scan. A single full run took 13.28 s on
Mac and 36.31 s on Intel. However, Mac peak RSS was 744 MiB versus 585.81 MiB
in the baseline. These are exploratory single samples, not a demonstrated
memory improvement. Keep the Rank source unchanged for this repair.

Replacing the scan callback with `Left + Right mod Mod` was also tried. The
Mac run was stopped after more than 69 seconds, without a full result, because
it was already slower than the original. No timing or answer is fabricated
for that incomplete experiment.

## Verification and reproduction

Tests check signed safe-integer and word boundaries, buffer reuse, offset
slices, empty buffers, wide and unsafe scan prefixes, products, axes, source
isolation, cancellation and demand budgets. Small Euler cases use a literal
exact BigInt recurrence with separately summed suffixes, without intermediate
modular reduction, in both execution modes and with two moduli. The
[published F(4)=5 and F(8)=319 examples](https://projecteuler.net/problem=781)
are retained. Every full measured run returns `162450870`.

All 85 focused tests pass on each host. TypeScript build, semantic boundaries
(65 owners), application-form checks and five exclusion-policy tests pass.

Build each checkout, then run in a fresh process:

```sh
EXPECTED=162450870 node benchmarks/euler781.mjs
```

`RANK_ROOT` selects another built checkout. The first argument changes Count;
a second argument `reference` disables compilation. `DIAGNOSTICS=1` and
`PROFILE=path.cpuprofile` enable separate instrumented runs. `RANK_SOURCE`
allows reproducing the exploratory source variants.

The under-30-second issue target is met on Mac, not on the Intel host. The full
demo remains excluded from corpus audits because it still takes tens of
seconds. Full suites and exhaustive audits were not run.

Runtime change: `0ce06e5b`. Recurrence tests: `dbff0563`.
