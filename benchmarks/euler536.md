# Euler 536: carry CRT state and bound candidate scratch

The full N=10^12 result remains **3557005261906288**. The
[statement](https://projecteuler.net/problem=536) gives S(100)=32 and
S(10^6)=22868117. The current baseline at 56ac57f1 already takes about
13.5 seconds on Mac, rather than the historical issue estimate of 2.2 minutes
and 5 GB. Do not compare that historical estimate directly with these runs.

## Search and correctness

The identity holds exactly for squarefree m whose every prime factor p has
p-1 dividing m+3. Apart from m=2, admissible m are odd. Single-prime cases are
2, 3 and 5; m=1 is also included. The old unconditional +11 was wrong below
five. The replacement filters these four small cases by N.

Choose primes in decreasing order. With selected product Q, the remaining
factor u lies in a CRT progression u=R mod M. The first selected prime p>=7
gives R=p-4, M=p-1. Its first possible m is p*(p-4), so the existing
floor(sqrt(N))+4 prime bound remains sufficient.

When choosing another prime q, write u=q*v. Reuse the parent's progression:

    q*v = R mod M
    Q*v = -3 mod (q-1)

Divide each congruence by its gcd, rejecting inconsistent rows, then combine
the two reduced congruences by CRT. This replaces reconstructing all previous
constraints from a matrix of selected primes. Only Q, the smallest selected
prime's index, R and M travel to a child. The first compatibility filter runs
before modular inversion.

A node branches only when it has more than T candidates, with effective T>=1.
If L bounds u, its progression then satisfies T*M<=L<=N/Q. Since q<Q, the
child modulus is at most M*(q-1)<N/T. Thus child moduli stay below N; the old
clipped-modulus flag and repeated constraint reconstruction are unnecessary.
The maximum search depth is bounded by N's bit length because every selected
prime is at least three. This is a bound, not an assumption that a fixed
number of levels suffices.

Small remaining factors use tables for odd integers only: squarefreeness,
largest prime and lcm(p-1) over their distinct prime factors. The latter is
lambda(u) when u is squarefree; repeated factors are rejected independently.
A smallest-factor sieve and shrinking factor-stripping stages build the tables.
The primorial cap uses only a short prefix scan, capped at N+1.

Larger remaining factors pass the coprimality/base-two Fermat screen, followed
by exact `factors`, squarefree, largest-prime and divisibility checks. The
Fermat screen is only a necessary filter; it never replaces the exact check.
Using the existing factor library also removes the old scan of every prime
below the bound for each survivor.

## Bounded array work and style

The old search expanded all candidate progressions for a level at once.
Prefix counts now enumerate their flattened positions in batches of 262144,
then retain only matches and rare survivors. The state transition finishes
one batch before beginning the next. The default branch threshold is 2500.
Both remain explicit CLI controls (`--batch`, `--t`); `--u0` remains the table
cutoff. The search is independent of these partition choices.

There is one explicit Rank loop, for the sieve. Factor stripping, vector
Euclid, candidate batches and frontier progression use `repeat` state
transitions; array operations do the numeric work. All Rank lines fit 40
columns. Ordinary bindings retain their completion boundaries. No answer
tables or special cases for the full result are introduced.

## General array-kernel improvement

A scalar base with same-shaped stored exponent/modulus arrays can now use
four independent modular-power chains in lockstep. Exponents may use all
safe integer bits, including values above 2^32. Packed Int64 exponents are
read through their two words without allocating a BigInt per input cell.
The existing exact low-word multiplier proves results for moduli up to 2^30.
The output is packed Int32; strided/reversed native views keep their addressing.
A group containing larger positive Int32 moduli uses the existing wide scalar
multiplier. A late wide modulus therefore does not replay the whole array.

Other domains, broadcast shapes, opaque readers, observable inspection,
budgets and cooperative interruption retain existing paths. Wider integers
keep exact arithmetic. The extension is in the shared array kernel, so both
compiled and reference execution benefit.

The compiler-only contribution is modest on this workload. On Mac, the new
source on the old runtime takes 8.790 s versus the new-runtime median 8.569 s;
on Intel it takes 17.470 s versus 16.565 s. These are single control samples,
not independent repeated compiler-only series. The algorithm and bounded
storage produce most of the overall improvement.

## Measurements

Three alternating fresh-process pairs per host, Node 24.15.0, N=10^12,
including parsing. Original source and runtime are frozen at 56ac57f1. Values
below are medians of execution time and each process's peak RSS:

| Host | Compiled before -> after | Peak RSS before -> after |
| --- | --- | --- |
| Mac arm64 | 13.467 -> 8.569 s (1.57x) | 2607.6 -> 1467.2 MiB (-44%) |
| Intel i7-10750H | 25.069 -> 16.565 s (1.51x) | 2109.0 -> 928.1 MiB (-56%) |

Single full reference samples improve 13.293 -> 8.395 s / 2724.9 -> 1450.6 MiB
on Mac and 25.603 -> 16.286 s / 2058.9 -> 910.6 MiB on Intel.
Intel was checked again after the earlier unrelated workload ended. Every
sample records zero other Node processes at entry; the rise in load average
during this series includes this benchmark's own work.

The complete sets of 12993 nontrivial solutions match the original on both
hosts, separately from the four small values and the final sum.

Experiments rejected rather than silently adopted: lowering the table cutoff
to one million nearly doubled time without solving peak memory; threshold
100 at that cutoff cost 73.5 s and 7 GB; 65536-candidate batches reduced memory
but increased overhead; small-prime matrix filters cost 63 s; fully blocked
table construction reduced peak to about 815 MiB but took 21.3 s. The selected
configuration balances speed and peak memory. All completed exploratory runs
are retained in the raw data, including the slower choices.

Raw records: `baselines/2026-11-09-euler536.json`. The original program is
`fixtures/euler536-original.ra`. Optional result-set dumps occur after timing.

## Verification and reproduction

Independent trial factorization checks every qualifying integer through
several small limits in Number, exact compiled and reference modes. Additional
cases force tiny tables, thresholds and batch boundaries. Every residue a is
also tested directly against a^(m+4)=a mod m for m<=80. Odd-table flags, largest
primes and radical periods are checked independently. A full compiled golden
assertion retains 3557005261906288.

The new modular-power kernel is checked against BigInt arithmetic on 512
four-lane samples plus exponent/base boundaries, 4096-cell block edges,
strides, public broadcasting, exact fallback, errors, custom readers, budgets
and interruption. Both architectures pass the focused Euler/kernel suite.

The combined Mac focused run passed 295 cases across nine files. The additional powmod-focused run passed 88 checks across eight files,
including the final new-kernel file. Filtered differential passes the
imported fixture with both test blocks. Intel passes all 53 Euler cases and
the kernel coverage, including full-scale execution. No full suite or exhaustive audit was run. The large
default keeps its repeated-corpus exclusion, now with explicit full compiled
coverage; small imported tests remain in the audits. Timeouts and scheduling
are unchanged.

After building:

```sh
node benchmarks/euler536.mjs compiled 1000000000000
node benchmarks/euler536.mjs reference 1000000000000
```

`RANK536_RUNTIME` chooses a separately built frozen interpreter index.
`RANK536_U0`, `RANK536_T` and `RANK536_BATCH` override CLI controls.
`RANK536_DIAGNOSTICS=1` records counters; keep those samples out of timing
medians. `RANK536_PROFILE` optionally writes an inspector CPU profile.

## Integration with concurrent main repairs

Before delivery, this change was rebased onto e1124ace's tensor/function-plan
regression repairs. TypeScript and 285 focused cases across 14 files passed,
including the new Euler tests and those concurrent repairs' regression files.
A same-runtime Mac control on that integration runs the original source in
12.537 s / 2619.5 MiB and the new source in 8.675 s / 1415.5 MiB. The primary
paired tables above remain the controlled series against 56ac57f1.

The final modular-power refinement keeps a group with positive Int32 moduli
above 2^30 on the existing wide scalar multiplier instead of discarding earlier
array work. A 4101-cell mixed-modulus regression covers that late outlier.
The final powmod-focused suite passes 89 cases across eight files; the new
kernel file now has 22 cases. Both architectures retain full-scale correctness.

The final integrated runtime passes 75 Euler/new-kernel cases on Intel. Its
last Mac full-size check is 8.476 s / 1540.7 MiB with the exact same answer;
per-run peak RSS varies with collection and publication timing.
