# Euler 214 — Totient Chains

Base revision: `4542df096201d1fe15a47a230e8718eb5f4b8652`. macOS arm64,
Node v24.15.0. Measurements include parsing and execution, with diagnostics.
Inputs and the full answer **1677366278943** are preserved: Limit=40,000,000,
Len=25. The unused segmentation option Block is removed with the old algorithm.
Execution exclusions and timeout settings are unchanged.

## Controlled numeric-prefix measurements

Three fresh serial processes per combination, alternating runtime order for the
same final source. Baseline runtime is the base revision; updated runtime at this stage adds
numeric function prefixes. No other jobs overlapped these measurements.

| Source / runtime | Median wall time | Median process peak RSS |
| --- | ---: | ---: |
| Original segmented program / baseline | 5.998 s | 369.75 MiB |
| Final ordinary helper / baseline | 1.685 s | 678.47 MiB |
| Same final helper / updated runtime | **1.322 s** | **305.69 MiB** |

- End-to-end gain at this stage: **4.54x**.
- Runtime-only gain on the same helper: **1.27x**, or **21.6%** less wall time;
  peak RSS decreases **54.9%**.
- The original already executed its outer segmented sieve as one Number loop,
  without overflows or compiler rejections. The remaining cost was mostly its
  generated arithmetic, not AST interpretation or generic selectors.
- The final helper has one Number region and no overflow. Its terminal return
  still uses ordinary function dispatch.

After the reference-writer change below, three fresh final confirmation runs
were 1.342/1.320/1.349 s: median **1.342 s**, median peak RSS **305.67 MiB**.
This separate cohort confirms the final compiled result at roughly **4.5x**
faster than the original program; the small difference from 1.322 s is not
presented as a regression.

RSS is whole-process high-water, including preparation, GC, publication and
private buffers. It is not retained logical storage or allocation volume.
The full Phi table has more logical cells than the original segmented sieve;
less measured RSS does not imply better asymptotic storage.

Three-sample serial controls using unchanged programs:

| Demo | Baseline median | Updated median |
| --- | ---: | ---: |
| Euler 211 main | 4.923 s | 5.057 s |
| Euler 213 main | 1.675 s | 1.634 s |

These small differences have mixed signs and do not establish a speedup or
regression. Both controls keep their answers; neither changes its main numeric
loop count. This is a Mac measurement, not Intel validation.

The final fixture passes in both modes (single diagnostic observations: 0.140 s
compiled / 0.855 s reference). Final source at Limit=100,000 / Len=15 takes
0.747 s reference in a single check, returning 162726509. Small-input timings
must not be extrapolated into measured full-reference times.

## Algorithm

The old segmented implementation stored Phi and residual factors Rem, repeatedly
removed prime powers from Rem, and retained a separate compressed chain-length
table. Segmentation saves logical storage, at the cost of extra arithmetic.

The final helper initializes Phi[n]=n. In ascending order, a cell still equal to
its index identifies a prime. Apply its totient update to multiples, compute
`1 + Phi[Phi[n]]`, and replace Phi[n] with this chain length. Since phi(n)<n,
the indexed cell already holds its length. Later primes only update later cells,
so they never overwrite a completed chain length. Phi[1]=1 supplies the base case.

This removes Rem, factor-removal loops, the separate length table and predecessor
block overlap. It naturally includes prime 2: the old explicit `N greater 2`
condition incorrectly returned 0 for Len=2 instead of 2. Empty exclusive ranges
and the strict upper bound are covered by the fixture and independent checks.

## General compiler change

A function ending in return with at least two top-level loops can prepare its
numeric prefix as one region when it writes only fresh local arrays. Allocation,
initialization and consumption share private storage. The Rank program needs no
one-iteration wrapper. The terminal return keeps ordinary contracts, tail-call
dispatch and result completion.

This reuses existing loop lowering and Number binding/native guards, safe-integer
checks, private-array widening, overflow replay and error/cancellation publication.
The code contains no Euler-specific rule. Prefixes with deferred bindings,
unsupported operations, early returns, external array destinations or local
aliases retain ordinary execution. No copy-cost, precision or code budget changed.
A helper declaration alone previously dispatched its two loops independently,
copying and publishing the large array at each boundary.

## Reference interpreter improvement

A separate CPU profile at Limit=1,000,000 identifies general indexed assignment
as a hot path (9.4% self samples in its generator, plus selection, expression
and task-dispatch costs). `Phi K -= Phi K // N` used the general slice writer
because the RHS contains an array read, although its destination is one cell.

The existing scalar-address writer now also accepts RHS values evaluated by the
ordinary, potentially suspendable interpreter. It preserves selector-before-RHS
validation, exactly-once RHS evaluation, shape fallback for object results,
checked stores and copy-on-write. It generates no JavaScript and changes neither
BigInt arithmetic nor the `compilation: false` contract.

Controlled serial three-sample medians, same final source, Limit=1,000,000 / Len=15:

| Reference runtime | Median wall time | Median process peak RSS |
| --- | ---: | ---: |
| Numeric-prefix change only | 6.255 s | 285.63 MiB |
| Plus scalar writes with interpreted RHS | **4.514 s** | **373.41 MiB** |

This is **27.8%** less time (1.39x), with a **30.7% higher** process high-water RSS.
No compiled loop, function or tensor executes in these samples. The RSS tradeoff
is measured and must not be described as a memory improvement. Do not extrapolate these times linearly.

The final full reference run completed in **194.321 s**, peak RSS **566.97 MiB**,
with answer **1677366278943** and zero compiled-loop/function/tensor counters.
This is one fresh isolated run, not a median or a measured full-input speedup.
The remaining interpreted expression/loop dispatch cost is substantial.

An initial full-reference validation before this change was externally stopped
at 300 s while overlapping the ordinary suite. It produced no completed result
and is not an isolated before measurement.

## Investigation history

The initial unchanged full samples were 5.932/6.193/6.090 s, median 6.090 s.
These are preliminary observations; the first overlapped small checks. Use the
controlled final cohort for comparisons.
An artificial one-iteration wrapper demonstrated the potential: median 1.295 s
and 304.63 MiB. Separate loops and a helper before the compiler change gave
single full observations of 1.696/1.710 s and 688/691 MiB. Those prototype singles
are diagnostic, not final comparative medians. Earlier measurements and source
captures remain in the raw JSON; default runs use the final source.

The initial CPU profile is dominated by the generated numeric function (4276
samples), followed by polling. Original small-input checks found 10 prime-2
mismatches across five limits/two engines; the prototype matched all 60 cases.

## Verification

The independent oracle counts coprime integers with Euclid's GCD to compute phi,
then follows prime chains. All **96 final comparisons** pass: eight bounds
(0,1,2,3,10,31,100,257), six lengths, both engines. It does not use a sieve or the
in-place recurrence. Full compiled golden answer and both fixture test blocks
pass; scoped type audits include the main and fixture, and differential execution
covers the fixture. Full-reference validation also confirms the full golden answer.

New reference-write tests cover suspendable calls, exactly-once evaluation,
RHS-created aliases, object-result shape fallback, invalid-index ordering, failed
RHS atomicity and exact wide integers in both modes. Other runtime tests cover combined preparation, repeated calls, empty arrays,
returned arrays, capture rebinding, ordinary and deferred errors, aliases,
early return, overflow replay, native replacement, cancellation/finally and
compilation options. An existing Euler 311 helper also joins two Number loops;
its independent sum-of-squares tests now require one region. A reduced direct
helper control, with the separate scalar-entry compiler disabled, changes from
143.3 to 139.5 ms (three-sample medians); preparation dominates this small case,
so the timing difference is not presented as an established speedup. Euler 213's stale
binding audit is updated for its previously shipped scoped degree/state source;
the old audit failed with the unchanged baseline runtime as well.

Final validation: TypeScript build and test typecheck; 11 semantic source/catalogue
tests; 65 semantic-boundary owners; application-form checks; **9,172 ordinary
interpreter tests in 404 files**; two scoped type audits (main and fixture); one
fixture differential audit; the 96 independent comparisons; and full golden
checks in both engines. The ordinary run excludes exhaustive types/differential
and Nurikabe, which are separate lanes. The shipping execution exclusion and
timeouts are unchanged; the main exclusion was removed only in the isolated
validation checkout for its scoped type audit.

## Reproduction

After building, from the repository root:

```sh
node benchmarks/euler214-totient-chains.mjs
node benchmarks/euler214-totient-chains.mjs --variant=original
node benchmarks/euler214-totient-chains.mjs --variant=inplace
node benchmarks/euler214-totient-chains.mjs --fixture
node benchmarks/euler214-totient-chains.mjs --fixture --reference
node benchmarks/euler214-totient-chains.mjs --Limit=100000 --Len=15 --reference
node benchmarks/experiments/euler214-oracle.mjs
```

The harness supports `--runtime=/absolute/out/index.js`; the oracle accepts that
path as its first positional argument. `inplace` retains the artificial wrapper;
`separate` and `helper` retain the earlier research forms. Raw results and captured
original source/fixture are in `baselines/2026-10-27-euler214-investigation.json`.
Use an external process deadline for large reference runs.
