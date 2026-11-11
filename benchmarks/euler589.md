# Euler 589: reduced real systems and captured array functions

Measurement base: `e397b730025316bae9a443463dc395389104998f`.
Delivery additionally integrates c57fc859's synchronous array-constructor
improvement and guards optional weak scratch reuse on older hosts. Focused
checks and full-default smoke runs are repeated after integration; the primary
measurement samples below retain their original runtime hashes.
Defaults remain K=100, D=5; the full rounded answer is **131776959.25**.
The historical issue timing predates the current nested-loop compiler: the
original program already finishes in seconds when compiled on this base.

## Rank program

The original program builds a 2V+2 system for two phase vectors and their
means, then implements Gaussian elimination with nested Rank loops. Here
U=N+D, V=M+D and Q=M-N+1. Eliminate the first phase and both means before
solving: only a V-by-V system remains. Closed-form sums of expected minima
replace the construction loops. The existing `solve` and `matmul` operations
perform the remaining linear algebra. Prefix lengths and `upperindex` expand
all M,N pairs; the Rank program has no explicit loops and all lines fit 40
columns. K=0 and K=1 retain a real zero result.

For the reduction, define B[r,s]=1/Q when U<=r+s<=V, C[r,s]=1/Q when r-s>=U,
and i[r]=1 when r>=U (indices 1..V). With H=i*i'/Q^2 and c[r]=E[min(r,T)],
the original equations are `(I-H)X-(B+C)Y=c` and `(I-H)Y-BX=c`.
Since `(I-H)^-1=I+i*i'/[Q*(Q-1)]`, substitute X to obtain
`[I-H-B*(I-H)^-1*(B+C)]Y=c+B*(I-H)^-1*c`.
The coefficient formula counts interval overlaps, a corner triangle and a
rank-one correction. Summing c uses a cubic prefix formula. The final weighted
sum of Y and the recovered even-phase mean matches the original opening-race
expectation. Dense elimination remains cubic per system; this is a reduction
in system size and construction work, not a new asymptotic solver.

## General runtime changes

Ordinary numeric array functions can now use finite numeric scalar captures,
real comparison intermediates and Boolean-to-integer masks. Pure arithmetic
bodies no longer need an artificial reshape/structural operation to enter the
existing numeric-function generator. Captures are reread on every call and
participate in the cached plan signature. Forward/written captures, captured
arrays, unsafe integers, opaque storage, nonfinite domains, observable budgets
and cancellation retain ordinary execution. Mixed integer/real min/max also
decline, preserving errors from heterogeneous intermediate arrays.

`solve` snapshots completed finite real inputs into private flat buffers.
It uses partial pivoting, supports multiple right sides and reuses coefficient
scratch through a weak slot. Inputs and previously returned answers remain
independent. An execution without an interrupt signal needs no inner polling;
signalled private runs poll bounded work. A zero elimination factor skips work
only when the remaining pivot row and its right sides are finite: an overflowed
cell must still preserve the old `0 * Infinity -> NaN` propagation. Other
storage, nonfinite inputs, inspection and demand budgets keep the previous
solver. No syntax, number-mode threshold or demo-specific runtime recognizer
was added.

## Measurements

Node v24.15.0, arm64 Mac and x64 Intel. Three alternating fresh-process pairs
per comparison; medians below. Every sample validates the golden answer.
Execution time includes parsing and excludes importing the interpreter; RSS
is the median process high-water mark. No test/build/other Node job was run
by this task on the same host during a primary measurement. Recorded one-minute
loads were 1.32-1.96 on Mac and 0.10-1.12 on Intel. External load cannot be
ruled out; Intel compiled ranges overlap.

| Host / workload | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, full compiled | 3.265 | 2.416 | 213.1 | 548.4 |
| Intel, full compiled | 7.663 | 7.657 | 198.6 | 498.8 |
| Mac, reference K=20 | 2.938 | 0.297 | 308.6 | 248.3 |
| Intel, reference K=20 | 10.171 | 0.889 | 282.5 | 223.7 |

Full new reference: **5.299 s / 791.0 MiB** on Mac and
**16.025 s / 374.1 MiB** on Intel. The full old reference was not measured;
small-input speedups must not be extrapolated into a full-input timing.

**Memory tradeoff:** full compiled RSS increases substantially. This is not
an overall memory reduction for Euler 589. Smaller reference inputs use less
memory, and the old manual nested loops are replaced by array code that runs
in both engines. Further fusion of matrix construction with its solver could
remove another coefficient copy; it is not implemented here.

A single new-source/old-runtime control took **7.200 s / 765.1 MiB** on Mac
and **18.697 s / 369.3 MiB** on Intel. The shared runtime changes are necessary
for this array formulation to match or beat the old compiled program; those
controls are single samples, not medians.

A separate general example calls a captured, broadcast numeric helper fifty
times on 256-by-256 outputs. Three alternating compiled-runtime pairs give:

| Host | Old ms | New ms | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac | 97.8 | 41.6 | 268.8 | 196.4 |
| Intel | 262.7 | 127.2 | 234.3 | 168.9 |

Raw samples: `baselines/2026-11-11-euler589.json`.

## Verification

- TypeScript build; 635 focused checks on each host, including the current
  array-selection and structured-value compiler cases integrated from main.
- Two filtered differential checks: full main and the unchanged K=5 fixture.
- Original two-phase equations at ten small K,D pairs in both engines, the
  statement's E(60,30)=1036.15 example and every full benchmark golden.
- Native solve against the scalar/budgeted solver through size 80, with and
  without signalled polling; pivoting, multiple right sides, retained inputs,
  singular errors, overflow/NaN propagation, opaque/shared inputs and budgets.
- Capture rebinding/domain guards, broadcasts through three dimensions,
  retained outputs, empty/mismatched inputs and real zero signs.
- Five execution-exclusion policy checks; the full demo is restored to audits.

A separate existing `numeric-call-loop.test.ts` check, "borrows fresh inputs on
repeated calls and retains earlier outputs", still expects four compiled loop
entries but sees zero; values agree. The same failure was reproduced with the
unmodified 8efab4e6 core before this work, and remains on the integrated base.
Its expectations were not weakened. The other 28 checks in that file pass.
No exhaustive audits or full npm test were run.

```sh
node benchmarks/euler589.mjs compiled
node benchmarks/euler589.mjs reference
node benchmarks/euler589.mjs reference 20 5
node benchmarks/euler589.mjs compiled 100 5 benchmarks/fixtures/euler589-original.ra
node benchmarks/captured-array-functions.mjs compiled
```

`RANK589_RUNTIME` chooses another built interpreter index;
`RANK_ARRAY_RUNTIME` chooses its directory for the generic array example.
