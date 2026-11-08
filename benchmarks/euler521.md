# Euler 521: keep only the consumed sieve result

The full result is **44389811** at N=1000000000000, modulo 1000000000.
The statement fixture remains S(100)=1257. The main demo is restored to
scoped differential execution; the historical three-minute exclusion is removed.

## Algorithm and memory

The program retains Lucy's prime-count/sum sieve. It stores counts and sums
for x through floor(sqrt(N)) and at x=floor(N/i). A prime p removes composites
whose least prime factor is p, adding p times their count to the answer. The
remaining sum of primes completes the answer.

The old finishing stage expanded pairs (i,p) for every prime above the cube
root and every i <= N/p^2, then updated all high-count/high-sum entries through
accumulating scatter writes. Those intermediate tables are never consumed.
Only the final high sum at i=1 contributes to the answer.

For p above floor(cuberoot(N)), p^3>N: the read at floor(N/(i*p)) is below
p^2 and already final. The small table is also final because sqrt(N)<p^2.
The finishing contributions can therefore be read together before any further
updates. The new program computes the composite contribution and the correction
to the sum at N directly, without constructing the unused pairs or updating
the unused count/sum entries. This is the same sieve, not an approximation or
a table of answers.

Sum entries are normalized modulo the modulus after each sieve update. Inner
subtraction normalization is unnecessary because the entire update is computed
in the same residue ring. This keeps the stored sums bounded. Explicit small
steps make completed array bindings clear and reduce retained temporary storage.
A floating cube-root seed is corrected against a four-element array using exact
integer cubes. There is one explicit prime loop and every Rank line fits 40
columns. N=0 and N=1 return zero without reading an absent high-table entry.

## General compiler coverage

Loop-local named arithmetic ranges can now feed rank-one numeric/boolean
array gathers in Number regions. The consumer reads the captured start/end/step
rather than evaluating their original expressions again; it traverses the
progression without constructing an index vector. The selected result still
completes at ordinary `=` boundaries. Retained results and later writes preserve
snapshots; this does not turn ordinary bindings into deferred plans.

The previous vector slice-write guard also rejected any escaping compound
assignment result. A fresh completed RHS is safe to return, including after
`+=`, `-=`, and `*=`: Rank returns the operand, not the updated target. This
restriction is now removed for fresh operands only. Existing live slice operands
retain their publishing backend. Unsupported operators, unsafe integers, invalid
ranges, and shape failures retain exact replay. Observable demand budgets and
column/table/order metadata retain the ordinary path.

## Verification

An independent first-prime-factor sieve checks 61 limits through 10000 in the
reference, exact-loop and Number modes, including zero, one, exact cubes and
adjacent values. The statement fixture passes in all three modes. Named-range
and fresh-operand tests cover positive/negative/empty/exclusive ranges, captured
bounds, integer/real/boolean gathers, aliasing, retained real results, errors,
wide arithmetic, metadata and warmed functions under a demand budget.

The 13-file selected regression run has **389 passes and one existing counter
failure out of 390**, on both hosts. The old `number-loop-slice` case
“fuses a discarded slice transform with mod” still expects one Number loop
and gets zero; its value/error comparisons pass. This was already reproduced
on the clean baseline during Euler 519 and is not a new regression. The changed
“keeps an escaping transformed RHS fresh” case now compiles and additionally
asserts the actual operand result. Source/test TypeScript builds and whitespace
checks pass. No full test suite or exhaustive corpus/type/name audit was run.

## Paired full-scale measurements

Node v24.15.0, fresh processes, diagnostics disabled. Three old/new pairs per
host; medians below. Baseline is frozen commit `f5df9543` and the retained
original source. Peak RSS is the process high-water mark, not live heap size.
No other own benchmark or test ran on the same host during these pairs.
The Intel host was idle before the experiment; the later load near one is
accounted for by the benchmark itself.

| Host | Before | After | Speedup | Peak RSS before / after |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 16.204 s | 12.387 s | 1.31x | 1736 / 418 MiB |
| Intel i7-10750H | 44.161 s | 30.425 s | 1.45x | 1347 / 383 MiB |

Total CPU time medians fall from 26.67 to 13.22 seconds on Mac and from
70.98 to 32.02 seconds on Intel. Every full timed run returns 44389811.
Raw pairs, source hashes, CPU times, process peaks and separate control
observations are in `baselines/2026-11-09-euler521.json`.

### Attribution and limits

Single-run controls distinguish the source rewrite from compiler coverage:

| Control | Mac wall / RSS | Intel wall / RSS |
| --- | ---: | ---: |
| New source, frozen compiler | 10.805 s / 679 MiB | 29.396 s / 481 MiB |
| New source, compilation disabled | 11.034 s / 681 MiB | 30.842 s / 433 MiB |
| Old source, new compiler | 15.727 s / 1614 MiB | not measured |

Most wall-time improvement comes from the program. The generic compiler fixes
provide the single private Number sieve region and reduce CPU work and peak
memory further; they do **not** make every source-only wall-time control faster.
In particular the Mac Number run is slower than the reference/source-only
control, while using substantially less memory and CPU. These controls have
one sample each, so they are not a separate statistically stable speed claim.
The paired before/after RSS reductions are approximately 76% on Mac and 72%
on Intel. An initial old-source observation was slower than the paired baseline;
the table uses the repeated comparisons, not that more flattering single run.

The main demo and its existing fixture pass scoped differential execution on
both hosts: two completed programs, one passing embedded test, two Number-loop
entries. No assertion relies only on matching failures.

## Reproduction

```
node benchmarks/euler521.mjs compiled
node benchmarks/euler521.mjs reference
node benchmarks/euler521.mjs compiled 10000
```

The optional final argument selects a source file; the original is retained at
`fixtures/euler521-original.ra`. Set `RANK521_EXPECTED=44389811` to check the full
answer, `RANK521_RUNTIME` to select a frozen interpreter `out/index.js`, and
`RANK521_DIAGNOSTICS=1` or `RANK521_PROFILE=/tmp/euler521.cpuprofile` for separate
instrumented runs. Leave instrumentation off for timing comparisons.
