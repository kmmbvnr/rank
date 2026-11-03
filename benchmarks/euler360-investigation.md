# Euler 360 investigation

Baseline: `8e2f9e71`, Node 24.15.0, 2026-11-03. The original research baseline predates the compiler repair below. The issue's next unfinished ascending task was
`euler/360_sphere.ra` (fresh issue 447 read). All runtime measurements use the
clean 357 delivery build, excluding other sessions' pending working-copy edits.

The algorithm is already effective: remove the factor 2^10 from the radius,
then build chi(n) = r2(n)/4 up to twice 5^10 and sum the weighted sections.
The function's documented domain is powers of five. This is not a brute-force
search over all points of the original radius 10^10 sphere. The example
S(45) = 34518 comes from [the original problem](https://projecteuler.net/problem=360).

## Measurements

Fresh serial processes, three samples for compiled variants (median below),
single samples for reference. Background host load is uncontrolled. RSS is
whole-process peak, including the interpreter and language machinery. Import
happens before the timer, but source parsing and compilation happen inside it.

| Variant | Mac time | Mac peak MiB | Intel time | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original compiled | 0.246 s | 253.2 | 0.611 s | 239.7 |
| Original reference | 9.715 s | 256.3 | 26.703 s | 244.1 |
| Quarter table, inline, compiled | 0.291 s | 199.0 | 0.717 s | 187.7 |
| Quarter table, inline, reference | 17.209 s | 202.8 | not measured | — |

The compiled diagnostics show one Number region for the original complete
function body, zero overflow/replay, no compilation rejections, no array COW
copies or numeric read buffers. The table is already Int32 and publication
takes ownership of that buffer: 19,531,251 cells, about 74.5 MiB. There is no
large avoidable copy established by this investigation.

The full answer is `878825614395267072`, observed in both engines on both
hosts. The internal reduced-radius sum is `858228139057878`; its final scaling
by 1024 is exact BigInt arithmetic outside the Number region.

## Performance controls

A direct JS implementation with the same table construction, section sum,
Int32 storage and Number arithmetic gives 0.051 s median on Mac (three fresh
processes), 0.133 s on Intel (one process). It omits Rank's runtime contracts,
parsing and code generation. It is a lower-overhead control, not a replacement
with identical observable semantics.

A warm Rank call, after three calls to the same function in the same
interpreter, takes 0.105 s median on Mac and 0.270 s on Intel. Thus the cold
fivefold gap includes substantial preparation cost; the remaining warm gap
is about twofold. Warm RSS retains earlier allocations and is not comparable
to the single-call memory measurements above. A sampled cold compiled CPU
profile spends roughly one third of samples inside the generated region;
the rest is spread across setup, parsing, compilation and runtime work.

A research-only source rewrite marks the known small input and induction
bindings Int32. Three Mac runs take about 0.244 s, versus 0.246 s in the final
baseline batch. This does not establish a useful improvement. The rewrite
has no general bound proof and must not be shipped as a compiler repair.

A reference CPU profile distributes time across expression evaluation,
assignment/loop streams, block execution, frame access and binding updates.
There is no missing compilation in this deliberately disabled-compilation
mode. Reducing reference dispatch/context work is a general runtime project,
not a reason to replace the existing fast algorithm.

## Compressed-table experiment

Use chi(2n) = chi(n) and chi(n) = 0 for n = 3 mod 4. Store only odd n = 1 mod 4,
indexed by n // 4. Build those entries from pairs of opposite parity, then strip
powers of two from R-X and R+X before reading. This reduces the table to
4,882,813 cells (about 18.6 MiB), saving approximately 56 MiB of buffer space.
Both complete answers agree; independent small cases also pass.

The inline version saves about 54 MiB of measured RSS on Mac / 52 MiB on Intel,
but costs about 18% / 17% compiled time. Reference time also rises. Keep this
as an explicit memory-versus-speed alternative, not an unconditional upgrade.

The compact helper version takes 1.792 s in a Mac single run and peaks at
225.2 MiB. Diagnostics show 14,648,436 compiled Number helper calls and array
borrows. The outer sum uses exact compiled dispatch through helper wrappers;
the complete Number region is lost. Inlining the same calculation reduces
this to 0.291 s. This identified a general compiler gap, repaired below: allow validated
read-only array helpers to consume private local buffers within the caller's
Number region, preserving rebindings, errors and observable boundaries.
It improves composability; it does not by itself prove that the
compressed algorithm beats the current original.

## Verification and reproduction

`euler360-verify.mjs`: initially 32 checks per host; delivery runs 42 per host,
both engines, four program variants (including the actual production demo)
at radii 1, 5, 25, 125 and 625 against independent first-octant coordinate
enumeration, plus the actual existing fixture in both engines. All pass.
Full default original answers match in both engines on Mac and Intel.
Full compressed answers match compiled on both hosts and reference on Mac.
No exhaustive audits were run; no execution lanes or timeouts changed.

```sh
node benchmarks/euler360-investigation.mjs
node benchmarks/euler360-investigation.mjs default reference
HOT=1 node benchmarks/euler360-investigation.mjs
DIAG=1 node benchmarks/euler360-investigation.mjs
node benchmarks/euler360-verify.mjs
node benchmarks/experiments/euler360-manual.mjs
node benchmarks/euler360-investigation.mjs default compiled \
  benchmarks/experiments/euler360-quarter-inline.ra
```

`RUNTIME` selects a clean alternate interpreter build. `PROFILE` writes a Node
CPU profile; `KERNELS` writes generated sources. `PHASES` adds a print boundary
and consequently splits the compiled region, so do not use it as a production
performance baseline. `INT32` is an unsafe source-rewrite diagnostic only.

The original demo is retained for speed. The general private-buffer call gap
identified by the compressed-table experiment is fixed in the delivery below.

## Delivery: private-buffer scalar calls

The compiler now passes current 1D integer buffers into read-only scalar Rank
functions through the existing checked Number call ABI. There is still a
function call, with no source inlining and no change to ordinary `=` boundaries.
The same path handles private Int32 buffers after stores or widening, and
validated stored buffers. Scalar callee results and all binding, capture,
overflow, error and observable-execution guards remain in force. An array call
without a raw Number implementation declines the caller's speculative region;
it never sends an unwrapped buffer into an exact/user callback.

On errors, bounded call-frame summaries read at most eight integer cells. They
do not clone or convert the full argument buffer. Ordinary preceding-write
publication and exact overflow replay retain the existing caller machinery.

Three-sample compiled medians, before/after the general repair:

| Variant | Mac time / peak MiB | Intel time / peak MiB |
| --- | ---: | ---: |
| Helper experiment before | 1.770 s / 224.0 | 5.102 s / 213.8 |
| Helper experiment after | 0.445 s / 200.8 | 0.967 s / 187.8 |
| Original demo after | 0.253 s / 254.6 | 0.619 s / 241.4 |

The helper experiment improves about 4.0x on Mac and 5.3x on Intel while using
about 23 / 26 MiB less peak memory. It remains slower than the original demo,
so the production algorithm is retained. Original before/after timings are
approximately level; cold timing includes preparation and host load is not
controlled. No speedup or memory reduction is claimed for the original demo.
Reference single-run delivery times are 10.901 / 26.838 s, with full answers
matching. Reference dispatch is unchanged.

Build passes. The same 22 focused test files pass on both hosts: 643 tests,
including 23 new tests for private writes/widening, multiple array arguments,
invalid indices, unsafe cells and exact replay, parameter value semantics,
alias/capture protection, callee replacement, unsupported ranks/types,
short-circuiting, bounded error frames, interrupts and demand budgets. The
extended real demo fixture and independent oracle runner pass 42 checks on
each host. The fixture adds S(125) = 142038. No exhaustive audits were run.

Raw initial and delivery measurements are in
[`2026-11-03-euler360-investigation.json`](baselines/2026-11-03-euler360-investigation.json).
