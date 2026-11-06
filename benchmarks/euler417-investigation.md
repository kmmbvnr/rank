# Euler 417: Reciprocal Cycles II

Research base: `43e4ecfb`, Node v24.15.0, 2026-11-06. This records the
initial investigation before delivery. See the [follow-up](euler417-followup.md)
for the final demo, compiler changes and measurements. Sources under
`experiments/` remain research controls.

## Diagnosis

The mathematics is already reasonable. Strip powers of 2 and 5 from each
integer, find the multiplicative order of 10 on the coprime part, and weight
that order by the number of 2^a 5^b multiples within N. Orders of prime powers
are lifted, and coprime factors combine by lcm. This avoids decimal expansion
for every denominator.

The issue's old approximately 44-second baseline is stale on the current Mac:
a fresh full run takes 10.930 s, answer **446572970925740**. A separate phase
probe takes 8.409 s (1.106 s sieve, 0.079 s setup, 7.224 s orders), showing
substantial run variability. Do not compare these as controlled medians.

The main order loop already enters Number mode without overflow. The original
transaction copies its 100,000,001-cell order array (400,000,004 bytes) and
allocates a 100,000,001-byte dirty bitmap. Both public tables are Int32, but
the sieve and publication also create substantial temporary allocation. Peak
RSS varies strongly with GC; it is not the size of live tables.

## Experiments

1. Replace the binary search for every m with a monotone boundary. As m grows,
   the number of admissible smooth multipliers only decreases. Maintain that
   count and update its boundary only when it changes, instead of performing
   about eight search steps for every coprime denominator.
2. Store only odd indices in both tables. For factoring p-1, handle factor 2
   explicitly; an odd sieve entry of zero denotes a prime. This halves each
   table's cells. The original even values are otherwise unnecessary.
3. Use existing scalar `lcm` instead of an inline Euclidean loop. Both work;
   exploratory probes did not establish a universal speed advantage for the
   manually expanded version, so the compact library operation is preferable.
4. Move the order table into an ordinary Rank function. The existing compiler
   already recognizes its local ownership: copied snapshot bytes fall to zero
   and the order-table dirty bitmap disappears. No relaxed rollback rule or
   special technical wrapper is needed.
5. Scope the sieve too and construct smooth products with an outer product,
   flattening and filtering. A forward prime stream compiles the sieve, while
   a reversed bounded prime plan keeps the original smallest-factor order and
   avoids the large sieve temporaries seen with indexed prime-array traversal.

Selected single Mac probes, all full answers equal:

| Variant | Seconds | Peak MiB |
| --- | ---: | ---: |
| Original | 10.930 | 1986.6 |
| Monotone weights only | 7.640 | 2876.7 |
| Monotone + library lcm | 9.397 | 2863.5 |
| Odd-only tables | 6.438 | 1378.7 |
| Local order table | 6.804 | 1144.8 |
| Both helpers, indexed sieve | 6.159 | 1189.4 |
| Forward prime stream | 7.761 | 585.3 |
| Reversed prime stream | 5.989 | 589.0 |
| Native JS, odd Int32 factor/order tables | 5.090 | 436.7 |
| Native JS, Uint16 factors + Int32 orders | 4.839 | 341.3 |

These exploratory observations were sequential, not controlled pairs. In
particular, monotone weights alone did not reliably reduce memory. The final
candidate combines the changes rather than relying on that isolated probe.

## Final candidate comparison

The `prime-reverse` candidate leaves order state local, uses odd tables and
monotone weights, and traverses the small bounded prime plan in descending
order. Three alternating fresh-process original/candidate pairs per host use
N=100000000. Parsing is included; phase logging is disabled. Machine load is
not controlled. Every result is **446572970925740**.

| Host | Original seconds | Candidate seconds | Median before → after |
| --- | --- | --- | --- |
| mac | 10.687 / 8.779 / 10.166 | 5.945 / 7.171 / 5.924 | **10.166 → 5.945 s** |
| intel | 20.563 / 21.937 / 21.092 | 14.605 / 14.736 / 14.997 | **21.092 → 14.736 s** |

Original Mac peak RSS varies from 2318.6 to 3188.7 MiB in these pairs; candidate
peaks are 587.9–589.5 MiB. The earlier standalone original peak was 1986.6 MiB,
so do not treat a particular RSS ratio as a stable guarantee. Both table-size
reduction and elimination of concrete snapshot/dirty allocations are measured,
not merely inferred from noisy RSS.

Intel baseline peaks in the pairs are 1633.3–1634.4 MiB; candidate peaks are
574.4–574.6 MiB. The median speedup is approximately 1.7x on Mac and 1.4x on
Intel. An initial Intel native UInt16 control takes 10.405 s / 341.4 MiB; the
Rank scoped-indexed control takes 15.063 s / 692.3 MiB. These are single probes.

## Compiler finding

A minimal independent probe demonstrates a general missing case:

```rank
use sequences
Total = 0
for P in (primes from 3 to 200) reverse
  Total += P
end
```

The forward form enters one Number loop; the reversed form returns the same
4225 but is rejected with `loop:loop-header:ForStatement`. See
`experiments/euler417-prime-probe.mjs`. The traversal normalizer in `loop-traversal.ts` only unwraps `reverse`
for a named source. A bounded prime expression remains an application and
fails the header recognition; the prime-bound header branch itself only emits
a forward iterator. Both stages need to preserve the reversed plan. Supporting finite reversed prime
plans would be a useful general compiler improvement, with tests for finite
bounds, indexed traversal, binding guards and interruption. Infinite reverse
plans must keep their existing errors; merely ignoring `reverse` is incorrect.

This gap concerns the small sieve loop, not the dominant order loop. It should
not be claimed as the reason for the old 44-second total, nor as a demonstrated
large speedup until implemented and measured. The largest gains above already
use existing compiler ownership handling and a better program representation.

Remaining memory savings are possible with narrower integer storage: every
stored composite factor here is at most sqrt(N), so UInt16 is sufficient at
this bound. Native JS saves about 95 MiB by changing only that table's element
width. Rank's ordinary integer-array storage currently uses Int32/Int64;
introducing narrow storage would be a broader runtime/compiler change, not a
new Euler-specific public operation. The factorsieve builtin's 2^20-1 bound
limits its retained factorization cache to 4 MiB; this experiment does not
justify simply raising that cache limit to 10^8.

## Verification and limits

The standalone verifier checks ten source variants on both engines against an
independent decimal long-division oracle at N=0,1,2,3,4,5,6,7,8,9,10,11,12,25,
32,49,81,121,125,169,200,997,1000, plus the published million checkpoint in
compiled mode: **470 checks per host**, all passing on both Mac and Intel. It includes termination, prime powers, lifting
and domain boundaries. No exhaustive corpus audit or full-reference default
run was attempted.

At bounded N=100000, original/scoped-indexed reference probes agree at
638005899 and take 1.361 / 0.807 s on Mac. At the published N=1000000
checkpoint, original/final-candidate reference probes agree at 55535191115
and take **5.557 / 2.138 s**, with peaks 201.5 / 188.5 MiB. These are single
probes and do not establish default N=10^8 reference performance. The new reverse-loop lowering and any final style cleanup are not yet
implemented. No production patch, commit, push, table update or comment has
been made for Euler 417.

## Reproduction

```sh
node benchmarks/experiments/euler417-run.mjs
node benchmarks/experiments/euler417-pairs.mjs
node benchmarks/experiments/euler417-verify.mjs
node benchmarks/experiments/euler417-prime-probe.mjs
node benchmarks/experiments/euler417-native.mjs
node benchmarks/experiments/euler417-native.mjs 100000000 32
```

Raw observations: [baseline JSON](baselines/2026-11-06-euler417-investigation.json).
