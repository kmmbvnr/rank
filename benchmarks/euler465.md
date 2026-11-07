# Euler 465: modular totient tables

The full N = 7^13 answer remains **585965659**. [Project Euler 465](https://projecteuler.net/problem=465) examples retain P(1)=131, P(2)=1648531, P(3) mod 1000000007 = 461288482, and P(343) mod 1000000007 = 937293740.

## Program and arithmetic

The geometric counting formula is retained. Primitive ray levels contribute four phi(k) pairs of opposite rays, with weight floor(N/k). A product accounts for all vertex choices, and two weighted moments remove choices contained in a closed half-plane.

The original program computed exact summatory totients far beyond Number's safe range, kept large sieve intermediates as top-level variables, and allocated many temporary quotient arrays. The overflow replay was correct: the compiler cannot replace an ordinary exact binding with residues merely because this particular program later uses modular counts.

The new program explicitly computes summatory totients in two residue rings: modulo M=1000000007 for moments, and modulo M-1 for exponents. To form a triangular number modulo either modulus, it reduces X*(X+1) modulo twice the modulus before dividing by two. The residue stays even, so division is exact even when M-1 is even. Both doubled moduli fit the existing exact 31-bit modular multiplier.

A Rank function keeps the totient sieve intermediates local and flattens prime powers into one loop, following the existing Euler 448 approach. Two calls to the same descending quotient-table function handle the two residue rings. The counts are extracted with array operations. Exponents use (count-1) mod (M-1)+1, preserving a positive exponent when the base is zero modulo M. The manual balanced product loop becomes the existing seeded modular product reduction. This also makes the empty N=0 input return zero.

There are no nested Rank loops. Each helper has at most one loop; the main program has none. Names use words and every line is at most 40 columns. Ordinary bindings still complete their declared values; this is an explicit algorithm change, not fusion across a language boundary.

## Cutoff and memory

The automatic prefix length is half of floor(N^(2/3)), plus ten, clamped to a valid range. The approximate floating power only chooses a performance cutoff; correctness is guarded by the exact integer square-root lower bound. A positive --limit overrides the prefix size, clamped between that lower bound and N (with cutoff one for N=0).

The larger original-size modular prefix and the smaller prefix were compared in three alternating fresh-process pairs per host. The smaller table was selected to reduce peak RSS. Timing ranges overlap on Mac; Intel shows a modest speed cost with a substantial additional memory reduction. This is a measured tradeoff for these hosts, not a universally optimal cutoff. The larger modular version remains available through --limit=21095179 at the default N.

## Compiler scope

No compiler thresholds or runtime code change in this patch. Existing exact modular multiplication, modular scan/reduce, and private-loop compilation now handle all three heavy loops without overflow replay. The old source has two Number-loop entries and one overflow; the new source has three entries and none. Scalar helper rejection messages about whole-function array construction do not stop its heavy inner loops from compiling.

## Verification

Independent angular-subset enumeration covers actual grid rays for N=0, 1 and 2. Direct coprime-count totients and level products cover twelve further small N values, three prefix choices and all three backends. Small prime moduli exercise positive exponents with zero residues and zero bases. Tests also check totient cells, summatory caches under odd and even moduli, the actual imported fixture with repeated N changes, and the full default answer with three Number loops and no overflow replay.

**309 focused tests in ten files passed on both Mac and Intel**, including 21 Euler 465 cases and the reused modular arithmetic paths. Test TypeScript, semantic/application checks and execution-exclusion checks passed. The exact-name-filtered differential run passed both the full main and imported fixture on both hosts; all other corpus cases were skipped. The full main returns to ordinary audit eligibility, with an explicit exclusion-catalogue assertion. Exhaustive audits were not run.

## Measurements

All rows use the full N=96889010407 and medians of three alternating fresh-process pairs.

| Host / mode | Before → after, seconds | Before → after, peak RSS MiB |
| --- | ---: | ---: |
| Mac compiled | 7.541 → 4.397 | 1793.1 → 711.2 |
| Mac reference | 5.778 → 5.681 | 1877.9 → 1068.1 |
| Intel compiled | 15.252 → 10.768 | 1755.9 → 479.6 |
| Intel reference | 12.576 → 15.291 | 2025.4 → 533.1 |

The compiled workload is faster on both hosts and all four memory peaks are lower. Intel reference takes about 22% longer: the two residue-table passes do more interpreter work, while using much less memory. Mac reference ranges overlap, so its small median time difference does not establish a speedup. This is a documented memory/compiled-throughput tradeoff, not a universal interpreter speed improvement.

| Cutoff control | Larger modular prefix → half prefix, seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Mac compiled | 5.198 → 5.070 | 932.8 → 718.0 |
| Intel compiled | 10.102 → 10.871 | 674.5 → 477.8 |

The cutoff controls use the same final source/runtime on both sides. The full old/new comparison also changes the arithmetic and function scopes. Do not attribute that full improvement solely to the cutoff.

The source and runtime were frozen before the final series. Parsing, analysis and execution are included; process startup is excluded. RSS is the whole-process high-water mark. The monitor checks competing processes every second and excludes its own controller ancestry. The Intel measurements disclose ongoing scheduled ZFS scrub and require at least 95% idle plus I/O wait with no swap I/O before each sample. This is a known storage-background control, not a claim of a wholly idle machine.

One preliminary Mac sample overlapped a TypeScript check and was discarded. A later Mac reference sample and an Intel compiled sample were rejected for other busy processes. All three rejected full-result records are retained separately; resumption preserved the already accepted prefix. None contributes to the medians. Earlier single-sample experiments, including scope-only and larger-prefix variants, are kept as exploratory evidence. Diagnostic allocation/copy counters are partial accounting and should not be read as a complete allocation-volume profile.

Raw source hashes, all 36 accepted samples, ranges, available rejection records and exploratory results are in [2026-11-08-euler465.json](baselines/2026-11-08-euler465.json).

## Reproduction

Build the interpreter, then run from the repository root:

```sh
node benchmarks/euler465.mjs compiled
node benchmarks/euler465.mjs reference
node benchmarks/euler465.mjs compiled \
  96889010407 \
  demos/euler/465_polarpolygons.ra \
  --limit=21095179
```

`RANK465_RUNTIME` selects a frozen interpreter build. `euler465-compare.mjs` supports full-compiled, full-reference and cutoff workloads. It takes a baseline build root, output JSONL path and host name before the workload argument. `RANK465_ALLOW_IO_WAIT=true` explicitly enables the separately disclosed storage-background lane. The default quiet lane requires at least 98% idle CPU on Intel.
