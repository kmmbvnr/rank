# Euler 289: integer index loops and compact frontier states

Initial investigation: `d580579b`. Delivery base: `a9d84f88` (including the
concurrent slice-view optimization). Node v24.15.0, macOS arm64.
The solution to [Eulerian Cycles](https://projecteuler.net/problem=289) keeps its
frontier-connectivity DP and ordinary `index`; no custom hash table ships.

## Delivered changes

- Number loop regions support integer index reads, stores, compound stores,
  scalar membership and tuple keys. An overlay holds private writes, shared by
  storage identity across aliases. Overflow discards the overlay before exact
  replay. Real errors and cancellation publish preceding index/array/scalar
  state. Wide scalar reads retain exact BigInt values in mixed regions.
- Native integer storage is checked at every entry without scanning the whole
  map. Unsupported values, container operations, calls alongside indices, host
  Map hooks and custom entry callbacks retain the publishing backend. Existing
  mutation/capture validation and Number admission thresholds are unchanged.
- Euler 289 uses a compact matching key, computes endpoint positions once per
  vertex, and rejects a premature closed cycle immediately. Explicit array
  copies remain: swapping buffers did not establish a useful improvement.
- The default assertion moved to a dedicated full compiled test. The small
  fixture now checks six grids, including the independent 2x3/3x2 count 672,
  and is restored to type/differential audits. The full ~42 s reference main
  remains a manual execution-budget workload.
- The concurrent upstream slice-view change had a TypeScript return-type
  error: its selected value was typed as RankValue. Checking `isRankArray`
  before returning the view restores the declared RankArray contract.

## Final measurements

Fresh serial processes, parse/JIT included, imports excluded. Each compiled
case has three samples; case order alternates forward/reverse. The legacy loader
restores the four pre-change loop/index modules from `a9d84f88` in memory.
Transpilation happens in a child process, avoiding a retained TypeScript compiler
heap in the benchmark. An earlier exploratory series retained that heap and was
not used for final comparisons. No own tests/oracles/profiles overlap this series;
unrelated host load is uncontrolled.

| Workload | Before | After |
| --- | ---: | ---: |
| Euler 289, compiled, median | 2.177 s | 0.573 s |
| Euler 289, reference, single sample | 41.202 s | 41.878 s |
| Unchanged 104, compiled, median | 0.745 s | 0.765 s |
| Unchanged 129, compiled, median | 0.119 s | 0.120 s |
| Unchanged 026, compiled, median | 0.100 s | 0.102 s |
| Unchanged 093, compiled, median | 1.674 s | 1.692 s |

The compiled 289 gain is about 3.8x. Full reference execution is effectively
unchanged in these single samples; this delivery does not establish a reference
speedup. Controls differ by 1–3%, without enough samples or host isolation to
attribute those differences confidently. Individual samples vary substantially.
Peak process RSS is recorded, but these runs do not establish retained-memory
savings or a universal runtime speedup. Intel was not measured.

Shipping diagnostics: 154 compiled entries, all 154 Number entries, zero
Number overflows, 134523 index reads, 21411 index writes, zero COW copies.
Explicit demo-level array copies are not counted by the COW counter.

## Why this representation works

The algorithm enumerates non-crossing local matchings and merges equivalent
frontier states, rather than enumerating complete paths. At a fixed vertex the
cut has a deterministic set of arc endpoints, shared by every surviving state.
Sort these endpoints and cache their positions from the first valid state.
For every pair, only the smaller endpoint contributes its partner's position
to the base-16 key. Decode by taking the smallest remaining endpoint, pairing
it with the recorded position and removing both endpoints. This uniquely
reconstructs the matching. At most 16 endpoints fit the existing state storage,
so at most eight hex digits fit safely in Number. Keys are compared only within
one vertex's index, never across cuts with different endpoint sets.

The old key stored both absolute endpoints of every pair in base 65536 and grew
to hundreds of bits. The old Number backend also rejected all containers. Both
constraints mattered: making a compact key alone left the main state loop in
the exact publishing backend. Simply deleting the container guard would have
published speculative index writes before an overflow replay.

The general runtime change stages only changed keys, without cloning or eagerly
converting the entire index. Aliased wrappers of the same entries use one overlay.
There are no callbacks in these regions; guards exclude host hooks and custom
entry callbacks. Successful/error publication cannot be interrupted by ordinary
polling. Existing index APIs still handle unsupported regions normally.

`new index` still prevents compiling the enclosing vertex loops as one region;
the main state loop now compiles in Number mode. Increasing a compiler size
budget is unnecessary for this change.

A closed cycle before the last vertex invalidates the candidate regardless of
its remaining local pairs. Early rejection skips that work; the next candidate
overwrites temporary state. Final-vertex closure validation remains intact.

## Initial experiments

These pre-implementation measurements use `d580579b`; compiled medians have
three samples. Early-close variants used a later batch. They are research
controls, not final delivery performance claims.

| Variant | Compiled |
| --- | ---: |
| Original | 2.182 s |
| Buffer swap only | 2.285 s |
| Compact key + swap, ordinary index | 2.154 s |
| Compact key + numeric hash arrays + swap | 0.646 s |
| Original + early rejection | 1.938 s |
| Numeric hash prototype + early rejection | 0.559 s |

The numeric hash table (8191 slots against the existing 4000-state capacity)
was diagnostic only. It demonstrated the missing Number execution path. Its
48.148 s reference sample overlapped a ~1 s small-grid CPU profile and is
exploratory; the combined prototype's separate reference sample took 41.850 s.
Neither justified shipping a custom hash table. Buffer swapping also retained
302 COW copies of 10,208,000 cells in aggregate in the combined prototype.

## Verification and reproduction

- TypeScript build: `tsc -b packages/language packages/interpreter`.
- 25 focused runtime files: **1043 tests passed**. The new index suite has 18
  cases covering alias wrappers, tuple/negative keys, insertion order, overflow
  replay with arrays/scalars, missing keys, division/bounds errors, protected
  storage, cached function entry guards, mixed wide reads, host hooks/custom
  callbacks, and cancellation/finally.
- Dedicated full compiled test: `6567944538`, Number entries asserted and zero
  overflows. Every timed full sample also checks this answer.
- Scoped fixture type and differential tests: 2 passed; six small grids in one
  test block. The official 3x3 example remains `104290`.
- `euler289-verify.py`: **90 comparisons** on the final runtime, against an
  independent union-find enumeration of all local matchings on nine small grids,
  for original/hash/early-close/combined/shipping variants in both modes.
- Broad suites and exhaustive audits were not run. No claim of full CI or Intel
  validation is made.

From repository root after building language/interpreter:

```sh
node benchmarks/euler289-investigation.mjs compiled 6 10 shipping
node --import ./benchmarks/experiments/euler289-legacy-loader.mjs benchmarks/euler289-investigation.mjs compiled 6 10 original
DIAGNOSTICS=1 node benchmarks/euler289-investigation.mjs compiled 6 10 shipping
python3 benchmarks/euler289-verify.py original hash prune hashprune shipping
```

Variants: `original`, `swap`, `keyswap`, `hash`, `prune`, `hashprune`, `shipping`.
Frozen sources are under `benchmarks/experiments/euler289-*`; shipping reads the
actual demo. Raw initial and final samples, source hashes, diagnostics and
oracle results are in `baselines/2026-10-31-euler289-investigation.json`.
