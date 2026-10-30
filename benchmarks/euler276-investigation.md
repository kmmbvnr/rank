# Euler 276 investigation

Issue: https://github.com/kmmbvnr/rank/issues/447

The next unfinished numbered problem after 275 is 276, Primitive Triangles.
The demo and fixture are both unmarked in the observed-slow-cases table.
Initial research used only prototypes; the implemented change and final
verification are recorded below.

## Findings

The original algorithm already uses Moebius inversion rather than enumerating
triangles. Its expensive part is building a length-10,000,000 cumulative table
of *all* triangles and doing another length-10,000,000 indexed reduction.
This work also allocates large intermediate/exact-integer buffers. This is an
algorithmic representation cost, not a case where compilation alone will make
an otherwise small computation fast.

A full compiled stage sample took 10.513 s: 6.254 s before the Moebius sieve,
0.335 s for the sieve, and 3.924 s for the final lookup/reduction. A separate
reference stage sample took 15.220 s: 6.452 / 4.297 / 4.472 s respectively.
These diagnostic samples are separate from the repeated timing series below.

The reference sieve is slower because its compound indexed writes take the
general assignment path; the compiled loop uses bulk writes. A CPU profile of
the grouped reference prototype found general assignment, cell reads, integer
operators, binding-contract checks and GC among the leading costs. Optimizing
only prefix scanning cannot remove that cost.

## Array algorithm prototype

Let T(n) count sorted integer-sided triangles of perimeter n. The existing
formula rounds n^2/48 for even n and (n+3)^2/48 for odd n. Let F(q) be the sum
of T(1)..T(q). For q=12k+r, 0<=r<12, its exact quasipolynomial is

```
F(q) = ((12k + 3r + 6)k + A[r])k + B[r]
A = 0 2 3 6 8 12 15 20 24 30 35 42
B = 0 0 0 1 1 2 3 5 6 9 11 15
```

These are coefficients of the perimeter formula, not cached Euler answers.
B[r]=F(r), and A[r]=F(12+r)-F(r)-18-3r. The third difference at step 12
is 72; substituting the original T(n) proves the cubic for each residue.
The independent verifier additionally sums the original T formula through
20,000 and checks every prefix against this expression.

Moebius inversion gives Answer=sum(mu(d)*F(Limit//d)). Only d<=Limit//3
contribute because F(0)=F(1)=F(2)=0. Thus the sieve can be three times smaller.
The `formula` prototype uses this smaller sieve and F directly, still reducing
over every d.

The `grouped` prototype additionally combines equal quotients q=Limit//d.
Their coefficient is M(Limit//q)-M(Limit//(q+1)), where M is the prefix of mu.
With s=floor(sqrt(Limit)), the unique quotients are

```
Limit // (1 to (s min (Limit // 3)))
concat
3 to (Limit // (s+1))
```

At the full input there are 6,321 quotients, rather than ten million final
terms. The sieve and its prefix remain O(Limit); the final exact-arithmetic
work is O(sqrt(Limit)). The prototype retains array expressions and the one
existing loop over primes. No triangle-search loop is introduced.
The small-limit bound in the first quotient range handles Limit=0,1,2.

## General runtime prototype

Ordinary unseeded rank-one `scan +` does not dispatch stored Int32 input to
`scanInt32Axis`. The existing axis kernel also rejects lengths above 2^21,
a sufficient worst-case bound for exact Number prefix arithmetic.

The research loader routes only such `scan +` inputs to the existing compact
axis kernel and replaces the length exclusion with a safe-integer check on
every addition for long axes. It declines on an unsafe prefix, leaving the
unchanged exact path responsible for the result. Input is not mutated, and
the speculative output is private. Smaller axes retain the existing bound.

The initial loader is a research control, retained here with a no-op guard
when the shipping implementation is already present. Shipping adds bounded
checkpoints and declines compact scanning during inspection or observable host
polling. Public-interpreter tests cover exact fallback and seeded scans.
The prototype's direct kernel checks cover positive/negative
Int32 values, narrow and Int64 output, and declining unsafe prefixes.
Simply removing the length guard would be incorrect.

The compact scan helps the compiled grouped demo. Reference elapsed time did
not improve in the repeated series, and its RSS was worse: the general sieve
has already allocated heavily before the scan runs. Do not describe this
prototype as a demonstrated reference optimization.

## Measurements

Node v24.15.0, macOS arm64; three fresh serial processes per case, rotating
case order. Imports excluded; parse and execution included. No own benchmarks,
profiles or oracles ran concurrently during this series. Other host activity
was uncontrolled. Every full sample asserts the exact golden answer.
RSS is the whole process high-water mark, not retained array storage.

| Full Limit=10,000,000 | Compiled median | Reference median | Compiled RSS median |
| --- | ---: | ---: | ---: |
| Original | 11.747 s | 17.537 s | 1461.8 MiB |
| Exact F, smaller sieve | 2.892 s | not measured | 828.3 MiB |
| Grouped quotients | 0.439 s | 1.813 s | 422.0 MiB |
| Grouped + compact-scan prototype | 0.264 s | 1.875 s | 224.5 MiB |

Algorithm alone: 26.7x compiled, 9.7x reference. Compact scan adds about 1.67x
compiled, for 44.6x versus original. Original and grouped reference RSS medians
were 1536.0 and 660.5 MiB; scan-prototype reference RSS was 933.5 MiB, with no
memory benefit established for that engine.

The earlier unreplicated stage/loader trials are not pooled into the series.
Two exploratory runs overlapped and are excluded. After timing, the grouped
source gained the tiny-input range bound; this does not change full-input
quotients. The loader gained optional TRACE_SCAN logging, off in timed runs.
The JSON records hashes of the timed versions and the final artifacts.

The compiled JS files all predate the series; their newest mtime was
2026-10-30 23:04:11 local, before the first sample file at 23:15:55. Concurrent
source-only commits for Euler 655 landed during investigation; no build was
performed here or during the series. The JSON records the loaded JS digest.

## Verification and reproduction

- Full golden 5777137137739632912 asserted in all 21 timing samples.
- 112 small limits, including 0..100 and quotient/square/residue boundaries,
  compared against direct enumeration of a<=b<=c<a+b with gcd(a,b,c)=1.
  Three variants in both engines: 672 comparisons.
- Every F prefix through 20,000 independently checked: 20,001 comparisons.
- The same 20,673 checks pass with the loader enabled.
- Eight long-prefix compact-kernel checks pass, including unsafe fallback.
- These are the initial research checks; shipping verification is recorded below.

```sh
node benchmarks/euler276-investigation.mjs compiled original 10000000
node benchmarks/euler276-investigation.mjs reference grouped 10000000
node --no-warnings --loader ./benchmarks/experiments/euler276-scan-loader.mjs \
  benchmarks/euler276-investigation.mjs compiled grouped 10000000
node benchmarks/euler276-verify.mjs
node --no-warnings --loader ./benchmarks/experiments/euler276-scan-loader.mjs \
  benchmarks/euler276-scan-verify.mjs
```

Use STAGES=1 or DIAGNOSTICS=1 only for separate diagnostic runs.
The implementation preserves the original full and small fixture assertions,
adds Limit=0..3 checks, updates the explicit-plan-demo binding checks, and
restores the full fixture to ordinary execution audits. The generic scan
change applies to stored Int32 inputs in either engine. Ordinary `=` and
deferred bindings retain their existing evaluation boundaries.

## Shipping validation

The grouped array algorithm and guarded compact scan are implemented together.
The compact kernel checks cancellation/work budgets in chunks of at most 4096
cells and keeps speculative output private. Inspection and observable polling
use the existing path. Seeded scans keep their existing behavior.

A separate matched series uses the shipping runtime for both the frozen
original source and the final production demo. Three fresh serial processes
per case; the same measurement boundaries and golden assertions as above:

| Full input on shipping runtime | Compiled median | Reference median | Compiled RSS median |
| --- | ---: | ---: | ---: |
| Frozen original demo | 10.492 s | 15.397 s | 1462.8 MiB |
| Shipping demo | 0.246 s | 1.482 s | 230.1 MiB |

This is 42.7x compiled and 10.4x reference; reference RSS medians were
1533.0 → 617.6 MiB. Keep these controls separate from the earlier prototype
series. A diagnostic full compiled run counted 63210 computed cells, one
compiled loop and 239400 bulk writes, with no Number loop overflow.

Validation:

- TypeScript build of language and interpreter passes.
- 655/655 tests in 11 focused interpreter files pass, including seven new
  compact-scan cases and the existing scan/axis/fold/interrupt/plan tests.
- Scoped type and differential audits: four cases pass; both main and fixture
  complete, with all three fixture blocks, including the full default.
- Independent oracle: 20,897 checks across four source variants and both engines,
  including shipping; eight long compact-prefix checks also pass.
- Semantic-boundary checks: 11 tests and 65 owners pass.
- Full ordinary and exhaustive audits were not run.

The existing full answer 5777137137739632912 and small assertions are retained.
Limit=0,1,2,3 cases are added. The old 300-second fixture exclusion and its
corresponding timeout-list assertion are removed. No execution timeout is added.
