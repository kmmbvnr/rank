# Euler 514: count supporting lines instead of sorting points

Investigated from `13901d75` in `/tmp/rank514-investigation` for issue #447.
The full default remains N=100 and returns **8986.86698**. The statement's
N=1, 2 and 10 answers are preserved. No answer lookup is used.

## Two separate problems

The original source fails on `Nw choose Ps 0 scan max`. Named-fold grouping
rewrites `scan max` before finishing its input call, leaving `choose` and
`max` on the ordinary application stack. Parenthesizing the choice makes
the old algorithm executable. The benchmark retains both the untouched
source and that minimal grouping control.

The language repair groups the complete input of a named `scan`, `reduce`
or `segment` before placing its combining function. It starts at the last
fold, allowing successive named and symbolic folds. This is independent
of `choose`: ordinary pipelines and user-defined combiners also work.
Binding discovery no longer validates fold modifiers while classifying
collection mutations on the still-ungrouped surface tree. Actual fold
classification continues to validate modifiers.

Examples now accepted without additional parentheses:

```rank
Mask choose Values 0 scan max
Values abs scan max
Mask choose Values 0 scan + scan max
Mask choose Values 0 reduce max
```

Tests retain two/three-argument choice, eager scalar operands, array masks,
both execution modes, custom combiners, seeds, axes, later consumers,
segment queries and outer operations. Small fixtures from Euler 176, 202,
446, 461 and 473 also pass scoped type and differential audits.

## Algorithm

Let P=1/(N+1), Q=1-P, and T=(N+1)^2. Fix a primitive direction (dx,dy)
with dx>0 and dy>=0. For a supporting line containing K board points,
let L and R be the counts strictly on either side, so L+K+R=T.

For points i<j on that line, a counterclockwise hull edge requires both
endpoints, no points on the right or beyond the endpoints on the line,
and at least one point on the left. Its probability is

    P^2 Q^(R+K-1-(j-i)) (1-Q^L).

Using centred coordinates, the cross product of the endpoints is
`s*(j-i)`, where `s=dy*x-dx*y` is the line's centred coordinate.
For each gap g there are K-g pairs. Precompute

    F(K) = sum[g=1..K-1] g*(K-g)*Q^(K-1-g).

The complete contribution of one line, before the common P^2 factor,
is therefore `s*F(K)*Q^R*(1-Q^L)`. Four equal rotational contributions
and the shoelace factor 1/2 produce the final factor `2*P^2`.

Every line has exactly one starting point satisfying `x<dx or y<dy`.
Its length is `1+min((N-x)//dx,(N-y)//dy)`, with a separate horizontal
case. Store that length at integer coordinate `dy*x-dx*y+N*dx`.
Scanning those coordinates yields L as a running point count. Empty
coordinates contribute zero; singleton lines still advance the count.

At N=100 there are 6088 directions. The old algorithm repeatedly sorts
all 10201 points, gathers several arrays and performs prefix scans.
The new implementation removes sorting and those point arrays. It keeps
an O(N^4) scalar enumeration with O(N^2) live tables, instead of roughly
O(N^4 log N) sorting plus many generic array passes. The existing Number
loop compiler already handles the two direction passes; no new numeric
backend or speculative arithmetic rule was required.

An early N=30 CPU profile of the parenthesized old source records time in
array reads, operand conversion, selectors, storage checks, construction
and garbage collection. The profile is retained with the raw evidence.

## Full default measurements

Node v24.15.0, Apple M5 / arm64 and Intel i7-10750H / x86_64. Three
fresh-process samples per compiled variant, alternating order. Parsing
and compilation are included. Each process checks the complete answer.
Hosts can have unrelated background activity; RSS is whole-process peak.

| Host | Old algorithm, seconds | Line counting, seconds | Speedup |
| --- | ---: | ---: | ---: |
| Mac | 48.828 | 0.704 | 69.3x |
| Intel | 119.686 | 2.255 | 53.1x |

Mac median peak RSS is 331.0 MiB before and 354.9 MiB after. Faster
execution does **not** establish reduced process memory. The new version
still creates a histogram per direction and publishes its Number storage.
Intel median peak RSS is 318.4 MiB before and 307.2 MiB after; there is no
consistent cross-architecture process-memory saving.

An independent single full reference execution of the new program takes
104.043 s / 339.3 MiB on Mac and returns the same answer. The scalar
line passes remain expensive in the interpreter. A separate full reference
control of the old array algorithm takes 49.392 s / 337.3 MiB. Thus this
rewrite is about 2.1x **slower in reference mode**, while greatly improving
compiled execution. These are single reference observations, not repeated
medians. Full reference execution stays in the manual budget lane; the
exclusion explanation is updated.
The full compiled default has an ordinary golden regression test.

## Verification

- An independent monotone-chain hull oracle enumerates all point subsets
  for N=0..3 and weights their areas by the selection probabilities.
- A separate geometric oracle examines every oriented endpoint pair and
  every other point, counting forbidden points and the nonempty left side.
  It does not use primitive directions or the line-length formula.
- Both Rank algorithms match these oracles for N=0..12 in both engines:
  52 program executions, plus the complete default golden assertion.
- 359 focused interpreter tests across 11 files pass. The complete
  language suite has 1518 passes and two failures; the same two
  value-diagnostics failures reproduce on the unchanged `13901d75` tree.
- Scoped 514 type/differential/name-facts checks pass, as do 10 scoped
  type/differential checks for the other affected Euler fixtures.
- TypeScript build, application-form and semantic-owner checks pass;
  the three execution-exclusion metadata checks pass.
- No full interpreter suite or exhaustive corpus audit was started.

## Reproduction

After installing dependencies, generate Langium sources and build:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler514-series.mjs
node benchmarks/euler514-investigation.mjs 100 reference lines
DIAGNOSTICS=1 node benchmarks/euler514-investigation.mjs 100 compiled lines
PROFILE=/tmp/euler514.cpuprofile node benchmarks/euler514-investigation.mjs 30 compiled grouped
```

`original` selects the saved untouched source; `grouped` selects its two
explicit grouping repairs; `lines` selects the production demo. Raw
measurements and the CPU profile are in `baselines/2026-11-02-euler514/`.
