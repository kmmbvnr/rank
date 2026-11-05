# Euler 408: exact modular vectors and bounded scratch growth

Measurement base: `fbc7621940c60929cac57d94d9bd56ee955168aa` plus this
change, Node 24.15.0, Apple M5 arm64 and Intel i7-10750H x64.
Full N=10^7, **7850 forbidden points**, exact answer **299742733**.

## General compiler/runtime repair

Vector lowering for integer `A * B mod P` exposes both product leaves and
the modulus to the existing scalar modular lowerer. It no longer creates a
checked wide product before seeing the modulus. The existing bounded exact
multiplier handles large products; unsupported moduli and unsafe inputs
retain exact replay. Real operands follow their previous path. The three
operands retain trailing-axis broadcasting, including a non-scalar modulus.

This does not fuse across ordinary completed bindings: `Whole = A * B`
still completes its exact wide array, even if a later statement takes a
remainder. Integer precision and copy-admission thresholds are unchanged.
Empty inputs, invalid domains, shapes and earlier writes retain ordinary
error/demand behavior; observable execution keeps the existing paths.

Private vector scratch grows only when a dead buffer is too small. Gradual
growth can double that previous capacity; initial allocations, fixed-size
stages and large jumps stay exact. Logical cells are always the requested
subarray. Live arrays, aliases, retained results and operands still pin their
backing buffer. The maximum capacity matches the existing private-array
size domain; no new Number admission cutoff is introduced.

`number-loop.vector-buffer` diagnostics record backing-buffer acquisitions
through the scratch allocator. They exclude later widening, copy-on-write,
input snapshots and native-array allocations; they are not retained memory
or total-process allocation traffic. They make the reduction in allocation
churn measurable without timing-sensitive unit assertions.

## Program

The first-forbidden-point recurrence remains. Its predecessor list is filtered
before coefficient arithmetic, so impossible transitions are skipped.
Existing modular scans replace the two factorial loops. A pure array function
builds/scales primitive Pythagorean triples, then sorts the same forbidden
coordinates. At full scale 566 valid primitive triples generate all 7850 points;
the expansion mask has 447140 cells, rather than almost ten million square roots.

The program has one loop, whole-word names apart from formula symbols, and
lines at most 40 columns. Explicit lazy `Up`/`Down` ranges feed their scan
consumers without an unnecessary completed intermediate. Reverse already
produces numeric storage, so no extra copy is requested. The existing Rank
fixture, default input and full answer stay unchanged.

## Verification

Focused interpreter suites run through the audit configuration, with four
workers and without exhaustive audits. New cases cover exact/signed/near-safe
modular products, real fallback and mixed real arithmetic, multidimensional
broadcasts, invalid moduli, empty and singleton frames, completed wide bindings,
preceding stores, budgets and cancellation. Scratch cases verify allocation
budgets during gradual growth, fixed-size reuse, alias snapshots, overlap,
widening and errors while keeping logical shapes.

Independent rolling full-cell grid DP verifies both answers and sorted point
lists at 13 bounds from 0 to 1000, in both modes. Full default golden cases
run in both engines. Scoped differential, inferred-type and name-fact audits
cover only Euler 408 main/fixture. The main is restored to ordinary audits.
No exhaustive audit/full npm test was run.

## Controlled measurements

`experiments/euler408-final-series.py` uses fresh sequential processes on each
host, three compiled samples per variant in alternating order, then one
reference sample per source. Parse+execute are timed after imports and interpreter
construction; whole-process peak RSS is recorded. All runs assert the full
answer and point count. The shared Mac has unrelated load.

Controls use the same build and in-memory load hooks: disabling modular-product
admission and/or restoring exact-size scratch allocation. The original-control
source reproduces the original algorithm with both repairs disabled. Program-only
uses the final Rank source with both repairs disabled. Exact-pool enables modular
vectors but retains old allocation. No generated output is edited on disk.

`experiments/euler408-cross-pool.py` additionally compares exact/adaptive pool
allocation on unchanged full Euler 404, 407, 401 and real Euler 213, twice per
setting and host in reversed order. Known goldens are asserted for the first
three; 213 is checked against its exact-pool control. These are representative
controls, not a universal performance or memory claim.

Historical alternatives and manual JS controls are preserved in
[the initial investigation](euler408-investigation.md).

## Final results

Seconds / MiB peak RSS, medians of three compiled fresh processes:

| Variant | Mac M5 | Intel i7-10750H |
| --- | ---: | ---: |
| Original, repairs disabled | 10.131 / 1626.8 | 29.335 / 1033.7 |
| Final program, repairs disabled | 5.294 / 857.3 | 16.247 / 585.4 |
| Final + modular vectors, old pool | 1.792 / 763.9 | 4.455 / 536.9 |
| Final program/compiler/pool | 1.729 / 555.0 | 4.296 / 482.9 |

Compiled speedup against the original control is **5.86x Mac / 6.83x Intel**,
with about **66% / 53% lower peak RSS**. Same-source modular lowering
(with the exact pool retained) gives **2.96x / 3.65x**; the pool primarily
reduces allocation traffic and peak memory, with only small timing differences.

Allocation acquisitions in the same final-source pool comparison are
**23944 → 84 buffers**, **373411076 → 393180 bytes**, identical across
all samples on both hosts. This is scratch acquisition traffic, not live RAM.

Reference (one fresh sample per source/host):

| Source | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original | 35.269 / 1564.8 | 111.279 / 994.7 |
| Final | 5.304 / 726.1 | 14.428 / 495.1 |

Both reference samples improve, with lower peak RSS. These single samples
have greater timing uncertainty than the compiled medians.

## Other-demo pool controls

Two fresh samples per setting, same new modular compiler on both sides.
Seconds / MiB, exact pool → adaptive pool:

| Demo | Mac | Intel |
| --- | ---: | ---: |
| 404_crazyellipses | 6.238 / 298.2 → 6.225 / 178.4 | 14.973 / 173.4 → 14.839 / 164.3 |
| 407_idempotents | 3.378 / 510.7 → 3.353 / 510.9 | 9.912 / 499.1 → 10.097 / 499.8 |
| 401_sumsquares | 2.828 / 254.6 → 2.822 / 252.7 | 8.740 / 243.9 → 8.737 / 245.8 |
| 213_fleacircus | 1.503 / 259.3 → 1.494 / 259.1 | 5.905 / 234.3 → 4.252 / 225.6 |

Euler 404 is another gradual-growth workload: acquisition traffic falls
from 33749 buffers / 758857708 bytes to 105 buffers / 983004 bytes, with
lower peak RSS and similar elapsed time. Euler 407 has essentially unchanged
large-table allocation. Fixed-batch Euler 401 records exactly the same scratch
allocation volume. Euler 213 uses no private vector scratch; an Intel exact-pool
sample took 7.487 s versus 4.323 s for its other control. No speedup is attributed
to the pool there. Other small timing/RSS differences are treated as noise;
these four controls do not prove that every workload benefits.

## Checks completed

Mac and Intel each passed **1226 focused tests across 39 files**, then **35
edge cases** were rerun after adding a wide-modulus regression. That adds one
distinct test, for **1227 distinct tests per host**. Full default goldens in both
engines pass. Scoped differential/type/name-fact checks contribute six further
tests on Mac. Build (including test types), semantic-boundary, application-form
and whitespace checks pass. No exhaustive audit/full npm test was run.

[Raw samples, source hashes and verification](baselines/2026-11-05-euler408-followup.json).
