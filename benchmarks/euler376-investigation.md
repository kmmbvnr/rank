# Euler 376 investigation

The first sections record the initial research at `11ca0994`. The production
implementation and its final verification are described in the Delivery section
below. Timings isolate unrelated edits in the shared worktree.

At the initial inventory check, the next unfinished task was `376_dice.ra`.
The table recorded 222.1 s reference and 4.2 s compiled. Current timings are lower;
those old figures are not the baseline for this investigation.

## Findings

Both the algorithm and runtime leave substantial room. The existing DP packs
three face counts and three capped win counts into a 24-bit key. It processes
every label from 1 to Limit, including transitions that put that label on no
die. It also keeps all three cyclic rotations of a partial state.

At Limit=30 the manual control counts 11,994,803 candidates, 1,333,499 accepted
transitions and at most 8,827 live states. The maximum per-state count is
2,919,178,890,557,010, below MAX_SAFE_INTEGER, although the language must not
assume that bound for arbitrary larger inputs.

Current Rank compiles 30 layer passes, using the publishing exact backend.
There are zero Number loops. Root layer creation (`new index`) cannot compile,
and inside each layer both live queue iteration and queue push explicitly
exclude the private Number backend. This is not an overflow/admission-size
problem. Exact loops perform BigInt arithmetic and publish/check scalar bindings
throughout their bodies. The compiled CPU profile includes about 384 ms in a
fast-path closure and 75 ms in frame binding checks, besides generated code.
Reference time is distributed across expression/application dispatch, frames,
assignments, ranges and nested loop execution, not one expensive array builtin.

## Algorithm

Only the order and equality of labels affect comparisons. Group faces by their
K occupied distinct values. Every such pattern uses at least one of 18 faces
per group, so K <= 18. A fixed ordered pattern can choose its actual labels in
`Limit binomial K` ways; there is no K! factor, since the group order is fixed.

Remove the all-zero transition. Let C_K count completed labeled cycles after
exactly K nonempty groups. Then:

`Answer = sum(C_K * binomial(Limit, K)) // 3`, for K=1..min(Limit,18).

The existing `numbers` library supplies exact binomial coefficients. The final
weighted sum runs outside the DP pass and remains exact, including at Limit=100
where the answer is 1886791851742265960399180. Hot coefficient counts stay small:
the observed maximum is 6,247,026.

Canonicalizing each state under the three cyclic dice rotations further merges
its equivalent partial states. The transitions and pruning are cyclically
invariant, so the total weight of an orbit can be propagated from its canonical
representative. Do not divide each partial weight by three: some packed states
are fixed under rotation. The final division still counts each valid cyclic
set once.

Native work controls:

| Algorithm | Candidates | Accepted | Maximum live states |
| --- | ---: | ---: | ---: |
| Original | 11,994,803 | 1,333,499 | 8,827 |
| Cyclic symmetry only | 4,022,403 | 446,667 | 2,953 |
| Occupied groups only | 2,373,518 | 257,189 | 7,943 |
| Both | 793,112 | 85,951 | 2,653 |

`euler376-occupied.ra` isolates the formula; `euler376-both.ra` also merges
rotations. An alternative packed-key `cycle` helper makes the rotation code
shorter but adds reference call overhead (single controls 4.753 s versus
3.329 s for explicit packing). It is not the selected timing candidate.

## Compiler experiments

An array-backed key buffer can replace the queue: append each newly found key
once, double a private buffer when necessary, then copy its filled prefix for
the next layer. This uses the growing-array support from Euler 375. It is a
control/proposal, not a safe speedup to ship on its own.

The current compiler still splits that version into 19,251 Number invocations
because the five `shr` field extractions use audited scalar native calls, and
entry-array rebinding currently rejects every call. The split also publishes
7,193 arrays / 10,343,091 cells. Its runtime is worse than the short queue-based
algorithm despite using numeric kernels.

Two loader-only compiler prototypes were compared:

1. Admit only scalar calls carrying the existing `privateIndexSafe` proof next
   to array rebinding. Callbacks, array operands and unproved calls stay out.
   This gets 18 Number passes, 54 publications and 51,251 published cells.
2. Inline safe-integer `shr` directly in Number code. This removes these calls
   and keeps the existing call-admission restriction. It is the narrower
   preferred change for this workload.

For a safe Number integer A and integer shift K >= 0:

- K <= 52: `floor(A / 2**K)` is an exact arithmetic right shift. Scaling a binary
  float by a representable power of two is exact here, including for negative A.
- K > 52: the result is 0 for nonnegative A and -1 for negative A.
- Negative shifts replay the existing exact implementation; unsafe integer
  inputs retain the existing entry fallback.

This avoids JS's signed-32-bit truncation and masked shift counts. Operands are
captured in order and the builtin binding remains guarded. The prototype does
not change Number/copy thresholds. Release implementation still needs ordinary
regressions for guarded builtins, operand errors/order, cancellation, budgets
and replay; these were not replaced by the loader experiment.

A general Number queue implementation would be broader work: queue iteration
can see appended entries, aliases share the container, and overflow needs a
transactional rollback. Simply removing its `numberMode` checks is insufficient.

## Measurements

Node v24.15.0, Apple M5 / arm64 and Intel i7-10750H / x86_64. Three fresh serial
processes per compiled variant on each host, alternating order. Times include
parsing/preparation/execution, excluding imports; RSS is whole-process peak.
Every full sample asserts **973059630185670**.

| Full Limit=30 | Mac time / RSS | Intel time / RSS |
| --- | ---: | ---: |
| Original | 1.420 s / 275.0 MiB | 3.669 s / 264.2 MiB |
| Occupied groups, queue | 0.383 s / 189.5 MiB | 1.071 s / 179.7 MiB |
| Groups + symmetry, queue | 0.244 s / 185.7 MiB | 0.664 s / 175.9 MiB |
| Same algorithm, array buffer, current compiler | 0.415 s / 239.4 MiB | 1.362 s / 208.6 MiB |
| Array buffer, audited-call admission prototype | 0.193 s / 202.6 MiB | 0.519 s / 207.2 MiB |
| Array buffer, inline-shr prototype | 0.186 s / 206.0 MiB | 0.489 s / 202.6 MiB |

The fastest candidate saves about 25% of baseline Mac peak RSS and 23% on Intel.
The queue algorithm is more compact and uses another 20–27 MiB less peak memory;
the array/shr combination trades that for about 24–26% less compiled time. All
of these peaks include language/runtime startup, and are not retained-storage
measurements. Mac samples had occasional stalls; the original samples were
1.399, 1.420 and 2.781 s. Raw samples are retained.

Single full Mac reference controls: original 40.637 s / 442.9 MiB, queue algorithm
3.329 s / 395.0 MiB, array algorithm 3.414 s / 400.4 MiB. The original reference
control overlapped brief prototype checks. Treat these as indicative controls,
not a repeated isolated reference estimate. No full Intel reference was run.

Hand-written native JS controls for the original and combined algorithm were
0.138 s / 77.1 MiB and 0.018 s / 59.1 MiB on this Mac. Counts are checked for safe
integer addition. They omit Rank parsing, dynamic bindings, collection contracts,
cancellation and exact replay, so the whole difference is not removable loop
arithmetic overhead.

## Correctness and next implementation

73 cross-checks pass against an independent enumeration of six-face multisets
for small N and the original DP with BigInt counts at N=7,10,18,19,30,100. Rank
candidates are checked in both modes through N=6 and at full N=30; larger
comparisons use compilation. All candidates retain 581 at N=6 and the full
golden. Exact enumeration gives 15 at N=5 and 0 through N=4.

The original demo raises `missing keyed value` for N=0..4 instead of returning
zero. The prototypes use `Cur Term default 0` when collecting a coefficient and
handle those cases. Their N=100 answer exceeds Number precision and matches the
BigInt oracle.

99 signed/right-shift boundary comparisons pass against the reference evaluator
on both processors, including safe-integer limits, values just outside the safe
range, shifts 0/31/32/52/53/64/1000000 and negative shifts. There are 77 Number
entries in each boundary run; unsafe inputs retain fallback.

Recommended production work: implement general Number `shr` lowering with the
required safety regressions, then deliver the occupied-group/symmetry formula
and choose the key-buffer form using the measured speed/memory tradeoff. Keep
all existing fixture assertions and add the empty/no-cycle and wide-answer
cases. Verify both processors again after integration. The initial research made no production changes or external updates and ran no
exhaustive audits.

## Reproduction

Build the runtime first; RUNTIME may point to an absolute isolated built
interpreter index.js. Compiler hooks patch loaded module source only.

```sh
node benchmarks/euler376-investigation.mjs
DIAG=1 PHASES=1 node benchmarks/euler376-investigation.mjs
node benchmarks/euler376-investigation.mjs \
  benchmarks/experiments/euler376-both.ra reference
node --import ./benchmarks/experiments/euler376-shr-hook.mjs \
  benchmarks/euler376-investigation.mjs \
  benchmarks/experiments/euler376-array-control.ra
OUTPUT=/tmp/euler376-series.json node benchmarks/euler376-series.mjs
VERIFY_SHR=1 node benchmarks/experiments/euler376-verify.mjs
```

Raw measurements, counters and oracle results:
`baselines/2026-11-04-euler376-investigation.json`.


## Delivery

Production implements the array-backed occupied-group recurrence and cyclic
state merging, plus general safe-integer Number `shr` lowering. The intrinsic
captures both operands in order, keeps the builtin guard, and leaves mixed
BigInt operands on the existing exact/native path. Negative counts still replay
the native validation. No call-admission policy or numeric/copy threshold was
relaxed. The value 52 is a mathematical safe-integer bound, not an admission
heuristic. The three existing range parentheses were removed after verifying
identical AST and generated loop code.

The existing six-pip fixture assertion is retained. Additional fixture cases
cover empty/no-cycle limits 0/4 and the five-pip answer 15. Dedicated tests
compare sorted-die enumeration and the original DP with BigInt weights; they
cover labels below, at and above 18, plus the wide Limit=100 answer.

Final fresh-process medians (three alternating-order samples per variant):

| Full default | Prior original | Delivered | Peak RSS, before / after |
| --- | ---: | ---: | ---: |
| Mac | 1.415 s | 0.190 s | 276.4 / 203.3 MiB |
| Intel | 3.640 s | 0.496 s | 262.8 / 201.8 MiB |

Every answer is 973059630185670. The same delivered Rank source on the old
compiler takes 0.419 s on Mac / 1.369 s on Intel. Thus the compiler-only change
improves this source by about 2.2x / 2.8x; the algorithm and compiler together
improve the original by about 7.5x / 7.3x. On the original queue-based algorithm
the compiler change is neutral: 1.415 -> 1.409 s and 3.640 -> 3.720 s.

A general one-million-shift scalar loop improves 112.9 -> 89.2 ms on Mac and
317.4 -> 243.0 ms on Intel, including parsing/preparation. Unchanged neighbour
369 returns 862400558448 (Mac 184.5 -> 182.8 ms, Intel 505.6 -> 493.9 ms);
375 returns 7435327983715286168 (Mac 488.7 -> 483.4 ms, Intel 1197.1 ->
1167.1 ms). There is no demonstrated neighbour regression within these sample
ranges. Mac had occasional stalls; all raw samples are preserved.

The delivered full Mac reference control is 3.487 s / 410.6 MiB (one sample).
The earlier original reference control was 40.637 s / 442.9 MiB, subject to the
initial overlap caveat. These are not repeated reference medians.

Verification: TypeScript build, 621 focused tests in 17 files on Mac, 192 in six
files on Intel, and six scoped main/fixture differential/type/name-facts cases
pass. New coverage includes 169 shift boundary pairs, native-binding changes,
operand errors/order, wide mixed values, negative counts, cancellation, budgets,
array rebinding and exact replay. Full suites and exhaustive audits were not run.

Reproduce a clean before/after comparison with an independently built prior
runtime:

```sh
BASELINE_RUNTIME=/absolute/prior/packages/interpreter/out/index.js \
  OUTPUT=/tmp/euler376-delivery.json \
  node benchmarks/euler376-delivery.mjs
```

Final raw files are `baselines/2026-11-04-euler376-delivery-mac.json`,
`baselines/2026-11-04-euler376-delivery-intel.json` and
`baselines/2026-11-04-euler376-verification.json`. Historical research hooks and
series above should use the prior runtime; the shift hook recognizes the shipped
intrinsic and leaves it unchanged on newer builds.

The shared-worktree integration build also passed, followed by 127 targeted
shift, dice, vector and concat tests from the interpreter package. The final
style-adjusted source was rechecked on Intel: the golden and 18 Number passes
remain intact. Unrelated shared-worktree edits are excluded from this delivery.
