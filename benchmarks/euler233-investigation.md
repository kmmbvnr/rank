# Euler 233: bound prime candidates before array arithmetic

Source base: `f1ec5e60`; interpreter sources exactly match the isolated runtime built at `24447b05`. Euler 229 was a demo-only change. Apple M5, Node v24.15.0, macOS arm64.

## Change

The existing prime-exponent-core algorithm is retained. Only impossible candidate ranges are removed before expensive array operations:

- In the `(3, 2, 1)` case, the third prime C is at least 5. Restrict B to `isqrt(Limit // (A ** 3 * 5))` before entering the B loop.
- In the `(7, 3)` and `(10, 2)` cases, first restrict A using the smallest possible remaining prime, 5. For each retained A, take only a prefix of `Ones` before raising primes to powers. Since Y >= 2 and primes are positive, `isqrt(Limit // Base)` is a safe upper bound for both powers. The exact final `Cs at most Limit` filter is retained.

The shipping bound uses only exact integer arithmetic. The research prototype used a floating cube root plus one and an exact filter; that provisional bound was replaced before delivery. The slightly looser square-root bound processes only a small prefix and avoids a floating boundary contract.

Array-oriented code, lazy binding semantics, the mathematical cases and all three fixture assertions are retained. The outdated fixture timing comment is replaced with a description of its full-input coverage. No compiler, runtime budget or exclusion-catalogue change.

## Measurements

Three fresh sequential processes per source/engine. Parsing, preparation and execution included; runtime module import excluded. All full-input runs returned `271204031455541309` for Limit=100000000000.

| Cohort/source | Compiled median | Reference median | Compiled peak RSS median | Reference peak RSS median |
|---|---:|---:|---:|---:|
| Research original | 27.588 s | 28.858 s | 1174.14 MiB | 1170.30 MiB |
| Research prototype | 1.729 s | 2.177 s | 629.86 MiB | 575.95 MiB |
| Shipping exact-bound version, separate cohort | 2.084 s | 2.284 s | 631.28 MiB | 612.86 MiB |

The research original/prototype samples were interleaved and showed 15.96x/13.26x improvement. The shipping samples are a separate cohort, with individual times 2.446/2.084/1.846 s compiled and 2.973/2.284/2.262 s reference. They confirm a roughly two-second solver, but are not an interleaved final speedup comparison.

An attempted fresh original series with the shipping harness was stopped and excluded: after initial 27.485/28.438 s measurements, a sample took 55.968 s while multiple external Node workloads were active. Partial raw data are retained as rejected, not used to inflate the speedup. No controlled Intel results are claimed. RSS denotes process high-water, not retained memory.

A pair-only research ablation took 10.829 s compiled in one run; bounding the three-prime B loop supplied the remaining improvement. This ablation is not a repeated cohort.

## Interpreter findings

The original already enters compiled tensor kernels (3,527 entries in the exploratory run). Its expensive stages were approximately 9.79 s for three-prime cases and 17.08 s for two-prime cases; preparation was about 0.88 s. Original/prototype computed cells fell from 74,674,274 to 1,170,666, and empty arithmetic-domain fallbacks from 54,111 to 273.

The primary problem is requesting candidate arrays that will subsequently be discarded. Conservative scalar-evaluation and empty-domain guards preserve error timing; removing them wholesale is not justified. A future compiler optimization could improve empty-domain handling when scalar computations are proven safe, but is not needed for this solver improvement. No compiler correctness bug was established here.

## Verification

- Independent factorization of every integer through 20,000,000; original and shipping sources checked at 12 limits in both engines: 48 comparisons. Includes boundaries around the first two solutions, 359125 and 469625.
- Direct geometric point enumeration checks the factor-count formula for N=1..1000 and the official N=10000 example (36 points): 1001 checks.
- Complete existing fixture against shipping source in both engines: two blocks, all three assertions pass, including default and 10,000,000/20,000,000 limits.
- CLI static checks: both main and fixture pass.
- Portable scripts pass Node syntax checks; diff passes whitespace check. Interpreter source tree matches the runtime validation checkout. Full interpreter suite was not run for this solver-only change.

## Reproduce

From a built checkout:

```sh
node benchmarks/euler233-circlepoints.mjs --phases
node benchmarks/euler233-circlepoints.mjs --reference --phases
node benchmarks/euler233-circlepoints.mjs --original --phases
node benchmarks/euler233-circlepoints.mjs --fixture
node benchmarks/euler233-circlepoints.mjs --fixture --reference
node benchmarks/experiments/euler233-oracle.mjs
```

The benchmark accepts `--runtime=/abs/path/out/index.js` and `--Limit=10000000`. The oracle accepts the runtime path as its first positional argument. `baselines/2026-10-28-euler233-investigation.json` contains exact source snapshots, source/runtime hashes, repeated raw samples, rejected partial samples and delivery verification logs.

Official problem: https://projecteuler.net/problem=233
