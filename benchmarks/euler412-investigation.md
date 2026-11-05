# Euler 412 investigation

Final implementation and current-runtime results: [delivery](euler412-followup.md).

Base: `bff39e70` (2026-11-05). Research only: production source and runtime
are unchanged. Raw data: `baselines/2026-11-05-euler412-investigation.json`.

## Finding

The main cost is avoidable factorial work, followed by the demo's manual
array product tree. Existing modular folds already run natively in both
reference and compiled execution. The compiled loop compiler does not
compile the original helper as a whole, but this is not the principal
remaining bottleneck once the program uses the existing folds.

Default parameters: M=10000, K=5000, Cells=75000000, P=76543217.
The modulus is prime (also checked by trial division). Wilson's theorem gives

    Cells! = -inverse(product(Cells+1 .. P-1)) mod P

The tail contains 1543216 factors, versus 75000000 in the original factorial.
Choose this route only when Cells < P and the tail is shorter. Otherwise
retain the forward product. In particular, do not use the inverse shortcut
when Cells >= P. This does not attempt to extend the existing program's
contracts for hook denominators divisible by P or degenerate invalid shapes.

## Measurements

Wall time includes parse and execution; peak RSS is process maximum.
Compiled figures are medians of three fresh processes, sequential per host.
Local Mac and Intel Node v24.15.0 used identical interpreter output from the
Euler 411 delivery snapshot. Intel connected through port 22022 at viewflow.io.
The initial reference figures below are single runs, not medians.

| Variant | Mac compiled | Intel compiled | Mac RSS | Intel RSS |
| --- | ---: | ---: | ---: | ---: |
| Original | 6.842 s | 12.112 s | 1435.7 MiB | 1420.7 MiB |
| Native reduce/scan, original factorial bounds | 1.036 s | 2.078 s | 353.9 MiB | 334.6 MiB |
| Wilson + native folds + direct range | 0.137 s | 0.330 s | 172.1 MiB | 155.6 MiB |

The final Mac series is the three non-hooked entries of `stream-series`;
the other two rows are from `mac-series`. Intel rows are `intel-series`.
All full-default measurements return **38788800**.

Reference: Mac original 6.176 s / 881.4 MiB, final 0.127 s / 171.3 MiB.
Intel original 14.597 s / 1327.4 MiB; Wilson + native folds 0.343 s /
159.6 MiB (this Intel reference variant still materializes the chunk before
reducing; no final direct-range Intel reference timing was recorded).
Peak RSS varies with GC and process state; the reduction is large enough
to reproduce on both hosts, but these are not retained-heap measurements.

## Array style and compilation

Replace the manual pairwise product tree with the existing expression:

    V reduce * with 1 mod P

Replace the factorial-table mutation loop with the existing modular scan:

    Fc = 1 to 2 * M - 1
    Fc = Fc scan * with 1 mod P

Consume each chunk as a range rather than first copying `(Lo to Hi) mod P`.
Keep the Chunk argument to bound current native-fold scratch allocation.
The remaining hook products can use native reduce directly, without the
old helper's `copy`. The archived runner keeps a one-line helper only to
isolate the comparisons; it need not survive in the production rewrite.

The original compiler diagnostics include `scalar-function:unsupported-op:to`
inside modprod, and `loop:unsupported-op:modprod` in the chunk loop. Therefore
one should not describe the original product helper as fully compiled.
However, the optimized program is equally fast in reference because the
existing reduction/scan implementation already handles the expensive work.
Adding a special compiler rule for this particular helper is unnecessary.

There is a general runtime improvement available: `ReductionOps.modularFold`
currently calls `rangeResidues` before `modularReduce`, allocating an Int32
buffer even for a constructor-proved range. A fused range fold could compute
residues and accumulate in one pass, removing 4 bytes per input cell. For the
final default chunk that is about 5.89 MiB of scratch; for a full 4-million
chunk, about 15.26 MiB. Ordinary array reductions also prepare a residue copy.

`experiments/euler412-stream-probe.mjs` tests a range-fold prototype through
a loader hook, without editing production. Three alternating Mac comparisons
with the same hook enabled in both controls gave 142.55 vs 143.06 ms median;
peak RSS was too noisy to establish a process-level saving. No speedup is
claimed. This is a memory-oriented follow-up, not a prerequisite for the
roughly 50x/37x whole-program gains above. The prototype needs dedicated
budget/cancellation and general-domain tests before production use.

## Correctness

- 468 independent hook-length oracle comparisons: M=1..12, K=0..M-1,
  original/native/Wilson candidates, reference and compiled, Chunk=7.
  The oracle builds every cell's hook length and divides exact factorials;
  it does not use the demo's ratio of factorial products.
- Full default matches original in both engines: 38788800.
- M=6200,K=0 (near the route threshold): forward native and shortened
  candidate both return 45711240.
- M=9000,K=0 (Cells>P): forward native and guarded candidate both return 0.
- No production changes, exhaustive audits, commit, push or issue edits.

## Reproduce

From the worktree root:

    node benchmarks/euler412-investigation.mjs compiled 10000 5000 original
    node benchmarks/euler412-investigation.mjs compiled 10000 5000 native-original
    node benchmarks/euler412-investigation.mjs compiled 10000 5000 direct
    node benchmarks/euler412-investigation.mjs reference 10000 5000 direct
    node benchmarks/experiments/euler412-verify.mjs

Variants read the immutable `experiments/euler412-original.ra` archive.
