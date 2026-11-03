# Euler 362: squarefree factorizations

Research against clean runtime `836d84ff`, Node 24.15.0, Apple M5 and the
Intel x86_64 host. This section records the initial investigation; delivered
changes and current verification are in [euler362364-delivery.md](euler362364-delivery.md).

The task is to sum the counts of unordered squarefree factorizations for
integers from 2 through 10^10. The statement gives S(100) = 193:
https://projecteuler.net/problem=362
The full checked result is **457895958010**.

## Results

Exploratory fresh-process samples, seconds / peak RSS MiB; these are not
medians. Imports precede the timer; parsing, compilation and execution are
included. RSS includes the interpreter and imports. Background load was not
controlled. Large changes are clear; small differences need a serial series
before delivery.

| Variant | Mac | Intel |
| --- | ---: | ---: |
| Original | 41.596 / 1400.5 | 80.271 / 1366.2 |
| Do not cache terminal states; keep helper calls | 101.111 / 298.3 | not run |
| Read terminal counts directly; retain terminal recursive calls | 11.842 / 299.4 | 24.753 / 282.2 |
| Eliminate simple terminal calls, use prefix counts for loop end (`best`) | 5.576 / 300.7 | 12.482 / 284.8 |
| Same, twice the prefix-table bound (`bound2`) | **4.674 / 299.1** | **10.992 / 283.2** |
| Separate Number-compatible Mobius sum (`count-helper`) | 5.563 / 300.0 | 11.070 / 283.3 |

The first `direct-full` sample (20.701 s) overlapped another local experiment;
the later isolated 11.842 s sample is in `series`. Do not use the overlapping
sample as a baseline. Other individual research samples also carry normal
host-load uncertainty.

On Mac, enlarging the prefix bound fourfold took 4.443 s / 308.7 MiB;
eightfold took 4.844 s / 348.0 MiB. Twice the bound is a more conservative
candidate; the fourfold version has only a small timing advantage and more
memory. Neither factor is a proposed compiler constant.

## Why the original is slow

`fac(N, I)` counts a single remaining factor using the squarefree prefix
count, then recurses through nondecreasing factors up to sqrt(N).

* The factor memo has **9,373,998 entries**. Only **522,598** are nonterminal:
  8,851,400 stored entries merely cache a prefix-table result minus an offset.
  Retaining these BigInt keys and values dominates the excess memory.
* A matching manual traversal makes **61,395,733 factor calls**, including
  **60,122,306 terminal visits**. A memo read is cheaper than an ordinary
  linked helper invocation with full semantic argument specialization, which
  explains why merely removing terminal memo writes makes Rank slower.
* For `M = Sq I`, `squarefree(M - 1) = I`: the queue is the increasing list
  of squarefree integers starting at 2. The second squarefree helper call is
  redundant.
* `Cs (N isqrt)` gives the exclusive factor-index bound directly. There is no
  need to repeatedly test the queue length and break at the first large item.

The candidate uses direct `Cs` reads for small terminal counts and consumes
simple terminal children in their parent. It preserves the nonterminal memo:
removing all memoization raises the manual traversal to 179,265,141 calls.
Its 522,598 factor states are shared as before; the algorithm remains exact.

The candidate also handles limits 0, 1, 2 and 3. The original reads `Sq 0`
when its factor queue is empty at these limits. Deriving the terminal test
from `Cs (N isqrt)` avoids that read.

## Compiler and interpreter findings

The recursive functions already use the linked exact scalar compiler:
`onFunctionBodyExecuted` stays zero. The two generated block hooks alone do
not count these scalar kernels. No evidence of large array copies was found;
the huge factor index, rather than DP-buffer publication, explains the RSS.

The hot numeric recurrence still uses BigInt arithmetic. The entire function
cannot simply switch to Number: it shares mutable index arguments, calls
other functions, and writes memo entries. A Number overflow after a visible
index write needs defined recovery. The packed key at the root is 10^16,
which also exceeds the safe integer range. Removing guards is incorrect.

A manual JS implementation makes the remaining arithmetic cost visible:

| Manual JS, terminal children consumed directly | Mac time / RSS |
| --- | ---: |
| BigInt arithmetic and exact BigInt memo keys | 2.795 s / 168.0 MiB |
| Number arithmetic, exact BigInt memo keys | 0.314 s / 126.7 MiB |

These are arithmetic/domain comparisons, not claims that Rank can safely use
unchecked Number everywhere. The manual sieve uses a simple independent
prime test, and its runtime/import baseline is much smaller.

### Repeated argument specialization

The profile of the unchanged recurrence spends substantial time in
`argumentSignature`, `CallSpecializations.get`, `semanticArrayType` and its
`elementType` construction. Linked calls still select a return contract from
all argument domains. The existing last-signature memo does not cover the
queue and index arguments, and alternating calls have different signatures.

A disposable JS-only prototype caches a specialization using primitive
domains, weak identity tokens, array revisions/ranks, and native container
checks. The original full run falls to **28.829 s**, with approximately the
same high memory usage. On the reduced-call algorithm its effect is small
(6.321 versus 6.131 s in the earlier `child-end` sample), so this is not the
main remaining priority. The prototype verifies the numerical result only;
it needs declaration, host-object, queue-mode and mutation-contract audits
before it could become a production change. It retains no array reference
through a strong cache entry. See the experimental patch script.

### Array tail does not stay compiled

A natural array expression for a terminal suffix is:

```rank
fun Cs Sq N Start End tail
  Js' = Start till End
  Parts' = N // Sq Js
  return (Cs Parts - Js) sum
end
```

The experimental driver passes an ordinary stored factor array, converted
once outside the recursion. All tests used the same mathematical suffix.
At limit 10^6, this version takes 0.610 s and executes 12,317 ordinary bodies;
the scalar variant keeps ordinary bodies at zero. An inline expression also
fails to stay compiled.

`proveFunctionPlan` currently lacks range producers and composed gather
plans for this expression. Diagnostics first reject `Js' = Start till End`
as `scalar-function:plan-expression`; the fully inline form rejects the
reduction. These are general compiler gaps, not Euler-specific operations.
A scalar-loop tail helper stays compiled, but takes 7.138 s on the full Mac
input, slower than consuming simple children directly.

A useful next compiler experiment is a range -> gather -> arithmetic ->
gather -> reduction consumer inside an ordinary read-only helper. Preserve
ordinary `=` materialization boundaries and demand/error timing for deferred
stages. It should lower to one checked loop, without temporary suffix arrays.
Existing generic support for Number read-only buffer arguments can then be
used where the range and arithmetic guards permit it. Whether that beats the
simple scalar candidate must be measured; no speedup is established yet.

Separating the Mobius arithmetic into a pure helper already admits checked
Number execution (999 Number calls and array borrows at limit 10^6, no
precision fallbacks). Its full-input benefit was negligible on Mac. Merely
extracting a helper is therefore not a sufficient optimization.

## Correctness and reference execution

**78 checks pass on each host**: three candidates, both engines, limits
0, 1, 2, 3, 4, 5, 10, 30, 100, 200, 1000 and 10000, plus the existing fixture
against each candidate in both engines. The independent oracle enumerates
nondecreasing products of squarefree factors and sums their counts; it does
not use the Mobius recurrence. All full compiled candidates above reproduce
457895958010 on both hosts where measured.

At 10^6 the reference engine improves from **1.724 s / 442.7 MiB** to
**0.427 s / 271.1 MiB** for `best`. The full reference run was not attempted;
these reduced-input measurements must not be extrapolated into a full-input
timing claim. No exhaustive audits or full package suite were run for this
research-only change.

## Reproduction

```sh
node benchmarks/euler362-investigation.mjs original 10000000000
node benchmarks/euler362-investigation.mjs best 10000000000
node benchmarks/euler362-investigation.mjs bound2 10000000000
node benchmarks/euler362-investigation.mjs best 1000000 reference
node benchmarks/euler362-verify.mjs
node benchmarks/experiments/euler362-manual.mjs 10000000000 child bigint
node benchmarks/experiments/euler362-manual.mjs 10000000000 child
```

`RUNTIME` selects another built interpreter URL. `DIAG=1` records counters;
`PROFILE=/path/profile.json` and `KERNELS=/path/kernels.txt` save diagnostics.
Use ordinary benchmark runs without these flags for timings.

Raw observations are in `baselines/2026-11-03-euler362-investigation.json`.
The investigation preceded delivery; see the linked delivery report for the
implemented changes and retained reference execution budget.
