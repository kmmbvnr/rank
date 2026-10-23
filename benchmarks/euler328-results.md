# Euler 328 sparse minimax search (#359)

Measured on Apple M5, Node v24.15.0. Baseline runtime and original source:
`69fd955dfdd68e3f57c6b41bbb905c22ccfe024d`. The original source is retained in
[fixtures/euler328-original.ra](fixtures/euler328-original.ra).

Each timing is the median of three fresh processes. Execution includes parsing;
cold time also includes imports and disposal. Diagnostics and CPU profiles run
separately. Samples are in
[baselines/2026-10-23-euler328.jsonl](baselines/2026-10-23-euler328.jsonl).

| Program | Runtime | N | Execution | Cold |
|---|---|---:|---:|---:|
| Original | Baseline | 2000 | 6.271 s | 6.432 s |
| Original | Direct powers | 2000 | 5.194 s | 5.362 s |
| Precomputed tree costs | Direct powers | 2000 | 0.171 s | 0.327 s |
| Precomputed tree costs | Direct powers | 200000 | 3.819 s | 3.995 s |

## Interpreter change

Powers with synchronous operands now use the prepared operator path. Previously
`**` always required resumable evaluation, even for integer constants and local
scalars. The operator still decides integer versus real results, performs array
lifting, and reports domain errors. A leading sign remains outside the power:
`-2 ** 2` is `-4`, while `(-2) ** 2` is `4`.

The unchanged program is about 17% faster at N=2000. This improvement does not
make the original full search practical on its own. Scalar function compilation
still rejects the original `**` expressions, and recursive tree calls remain.

## Algorithm change

The original search checks 4,004,099,749 candidates at N=200000. Only 500,427,464
pass its filter. The new loop visits those candidates directly. It retains all
sizes through N=100 and the same `max(0, floor(4*I/5)-20)` root window.

The original `Ok` recurrence accepts exactly sizes congruent to 7 modulo 8.
The full-tree base cases have that residue. Each recursive split joins a full
subtree to a smaller subtree; two accepted children give `7 + 1 + 7 = 7 mod 8`.
Conversely, a non-full size with that residue has accepted children, by induction.
The small full subtrees rejected by `Ok` occur below the first accepted size.

For a tree shape, each path cost is `depth * Base + offset`. Precomputation keeps
the greatest offset at each depth. Attaching a left path adds `L+1`; attaching a
right path adds `(depth+1)*(L+1)`. These balanced shapes have paid-path depths H
and H-1, so each candidate needs at most two affine evaluations and a maximum.
The missing-path sentinel uses the same magnitude as the original best-cost
bound; it remains below real costs at the supported Euler input.

The candidate loop reads separate one-dimensional height and offset arrays.
This makes it eligible for the existing checked Number loop compiler. An initial
version reading the two-dimensional precomputation table directly took 44.25 s
at full size, using BigInt loops. The final full diagnostic run executes two
Number loops without overflow or fallback to BigInt. Public results stay BigInt.

The search remains quadratic, with about one eighth as many candidate visits.
Precomputation uses O(N log N) temporary cells and replaces repeated recursion;
this is a runtime improvement, not a claim of reduced memory use.

## Profiles and correctness

A 30-second CPU profile of the original N=200000 program, with direct powers,
still does not finish. Sampled self time includes garbage collection (12.5%),
execution-driver `advance` (8.4%), AST stream iteration (5.9%), and scalar
expression compilation (4.3%). Indexed reads are not the sole bottleneck.

The final N=200000 profile finishes in 3.75 s, with 87% of samples in generated
loop code and 0.3% in garbage collection. Startup is included in these sample
percentages. Profiles are observations, not additional timing trials.

Both compilation modes agree with an independent interval DP, which tries every
guess, at checkpoints through N=256, including the unrestricted-prefix and
power-of-two boundaries. The Rank demo also checks S(1000)=3120345. The manual
full-input assertion checks S(200000)=260511850222. Full reference execution
remains excluded from the corpus audit because of its 500 million candidates.

## Reproduce

Build with `npm run langium:generate && npx tsc -b tsconfig.build.json`.
Run the benchmark with `node benchmarks/euler328.mjs`. To measure the interpreter
change separately, build the baseline in another worktree and pass
`--baseline=/absolute/path/to/packages/interpreter/out/index.js`.

Run the full assertion with
`node packages/cli/bin/cli.js test demos/euler/328_lowestcost_default_test.ra`.

For bounded profiling, run:

```sh
node --cpu-prof --cpu-prof-dir=/tmp benchmarks/euler328.mjs --worker=original-full --budget-ms=30000
node --cpu-prof --cpu-prof-dir=/tmp benchmarks/euler328.mjs --worker=current-full
```

The bounded original run uses cooperative cancellation and reports
`interrupted: true`; it does not report a completed result.

Validation also covers the TypeScript build, semantic-boundary and application-form
checks, and 303 focused expression/compiler/demo tests. The language suite passed
1279 tests. The full workspace test command was stopped at the user's request
while ordinary interpreter suites were still running; corpus-wide completion is
not claimed.
