# Euler 404: exact sums over private vector stages

Research started at `be4dce18`; delivery is based on `3c8ea47e`. The intervening
main commits add demos and exclusions; they do not change the interpreter.
The original investigation is in [euler404-investigation.md](euler404-investigation.md).

## Delivered changes

The Rank solution keeps its conic parameterization and outer array loop.
It first removes the modulo-5 and non-coprime candidates, then computes U,V
only for survivors. This removes the two 0/1 masks and their multiplications.
The exact bound `M^4 < 64N/25` replaces the conservative fourth root of 3N;
this removes about 8% of the original parameter pairs. Every line stays within
40 columns, without a helper introduced solely for compilation.

The compiler now handles this whole loop, including the full N=10^17 input:

- A copied finite progression uses fresh private range storage and retains
  the normal copy builtin guard.
- Vector native calls use the shared dyadic grouping and the scalar operands
  from that grouping. The native binding is checked on entry. Integer gcd and
  bitwise calls retain their audited scalar contracts; min/max keep their
  existing tie, signed-zero and NaN behavior.
- Private numeric stages and their scalar dependencies remain checked
  Numbers. Wide scalar registers can feed a rank-one integer sum whose
  arithmetic (+, -, *, //, mod) and total use exact BigInts. Completed integer
  cells convert exactly at this consumer; no product/quotient arrays need
  publication. Wide or unsupported array storage retains ordinary fallback.
- Shape and cell failures replay the original region. Private stores and
  retained aliases use the existing transactional publication and copy-on-write
  rules. Empty domains, cancellation, budgets, ordinary `=` completion and
  unused lazy bindings retain their contracts.

The full solver now enters one mixed Number/BigInt loop. Its final visible
array bindings account for only **6 typed publications / 53,136 cells**, compared
with the original **418,986 / 2,464,789,896**. These are publication traffic
counters, not a measure of simultaneously live memory. Both the source rewrite
and private vector execution contribute; no integer arithmetic was approximated.

## Measurements

Node 24.15.0 on Apple M5 arm64 and Intel Core i7-10750H x64. Compiled and control
rows use medians from three fresh processes per variant/host, run sequentially
with alternating order. Reference rows are one fresh process each. Timings
include parsing and execution after interpreter construction; RSS covers the
whole process. Other sessions were active on the Mac, so absolute times vary.

| Variant | Mac seconds / peak MiB | Intel seconds / peak MiB |
| --- | --- | --- |
| Original compiled | 22.337 / 1353.6 | 51.386 / 435.0 |
| Final compiled | **8.756 / 300.6** | **17.182 / 202.5** |
| Same final demo without exact vector sum | 14.211 / 790.1 | 35.149 / 432.1 |
| Original reference, one sample | 20.815 / 1241.0 | 49.465 / 363.5 |
| Final reference, one sample | 13.537 / 746.6 | 35.212 / 395.2 |

Compiled speed improves **2.55x / 2.99x**, with **77.8% / 53.5%** lower median
peak RSS. Isolating the compiler feature gives **1.62x / 2.05x** on the same final
program and substantially lower RSS. Reference is faster on both hosts, but
its Intel peak is **8.7% higher** in the individual comparison. This is a
reference memory tradeoff, not an all-backend memory reduction claim.

The `same-demo-without-wide-vector` control runs the final Rank source and the
same runtime, disabling only the new exact wide vector sum admission through
an in-memory loader. It isolates the benefit of this compiler feature from the
source rewrite. It retains the copied-range and native-grouping fixes; the
full wide input then takes the ordinary path.

All **22 series runs** return **1199215615081353**, including both hosts and both
engines. This full-size agreement is backed by an independent small geometry
oracle rather than described as an independent full-size geometric proof.

## Validation

- **929 focused tests in 31 files pass on each host**, covering Number loops,
  private vectors, adaptive copying, array stages/arguments, exact consumers,
  aliases, cancellation, budgets and full Euler 404 answers in both engines.
  The final singleton/empty fixtures were additionally rerun after clarification.
- **126 comparisons** across seven sources, nine limits and both modes pass.
  Expected values at 0,1,208,209,210,500,1000 use direct (a,b,c) geometry, with
  exact rational c^2 and a checked integer square root. Published examples
  at 10000 and 1000000 remain 106 and 11845.
- Added focused regressions cover safe-integer boundaries, negative quotient
  and remainder, wide products/totals, Float64 integer cells, empty/singleton
  broadcasting, replay error ordering, aliases, builtin rebinding, copy argument
  errors and cancellation/budget reuse. The full solver test also asserts mixed
  loop execution and bounded publication counts.
- TypeScript build and test typecheck, application-form audit and semantic
  boundaries pass. Only Euler 404 main/fixture were selected in the additional
  differential, inferred-type and name-facts audits; no exhaustive audit ran.
- The obsolete full-main execution exclusion is removed. Its small embedded
  tests remain unchanged and eligible.

## Reproduction

From the repository root, after the normal TypeScript build:

```sh
node benchmarks/experiments/euler404-verify.mjs
python3 benchmarks/experiments/euler404-final-series.py /tmp/euler404.jsonl
```

The optional third Python argument chooses Node. Intel checks used
`/opt/rank-bench-node/bin/node` and an isolated snapshot at
`/tmp/rank404-final-20261104`, accessed through the verified SSH tunnel.
The series script checks every full answer and saves raw diagnostics. Sources,
method, medians and samples are recorded in
[the raw baseline](baselines/2026-11-04-euler404-followup.json).
