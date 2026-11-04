# Scoped array binding lifetimes

Measured on 2026-11-04: candidate `d969cfe5` against `a953e835`,
Node 24.15.0 on both
Apple M5 and Intel i7-10750H. These are targeted ownership workloads,
not an application-wide speedup claim.

Run after building both checkouts:

```sh
node benchmarks/array-lifetimes.mjs /path/to/baseline
node benchmarks/array-lifetimes.mjs .
```

Each case runs in a fresh process, with four warmups and the median of
seven measured calls. GC runs before each measured call. Every call checks
its answer. Arrays contain 262,144 cells; alias retirement and return chains
repeat 32 times. Diagnostics are enabled consistently in both versions.
RSS is the process high-water mark, including startup and warmup, not retained
heap or a measurement of total allocated bytes.

The bridge loop selects compiled scalar execution for integer, wide-integer,
text and live-alias cases (11 hook calls per process). Return chains remain
ordinary function execution even with compilation enabled. The reference
configuration disables compiler capabilities explicitly.

| Host | Case | Backend | Before ms | After ms | Before RSS MiB | After RSS MiB | Copies before → after |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| mac | integer | reference | 1.968 | 0.692 | 284.3 | 156.7 | 32 → 0 |
| mac | integer | compiled | 6.158 | 4.715 | 329.8 | 166.3 | 32 → 0 |
| mac | wide | reference | 3.113 | 0.754 | 322.6 | 163.0 | 32 → 0 |
| mac | wide | compiled | 6.287 | 4.538 | 295.8 | 179.1 | 32 → 0 |
| mac | text | reference | 408.466 | 1.054 | 430.7 | 164.4 | 32 → 0 |
| mac | text | compiled | 425.665 | 3.474 | 443.9 | 180.9 | 32 → 0 |
| mac | returns | reference | 5.023 | 2.385 | 433.6 | 288.8 | 64 → 0 |
| mac | returns | compiled | 4.754 | 2.242 | 441.7 | 291.1 | 64 → 0 |
| mac | live | reference | 0.292 | 0.328 | 159.1 | 153.6 | 1 → 1 |
| mac | live | compiled | 1.792 | 2.050 | 188.0 | 190.9 | 1 → 1 |
| intel | integer | reference | 14.298 | 2.679 | 270.5 | 141.8 | 32 → 0 |
| intel | integer | compiled | 28.236 | 9.084 | 279.0 | 168.5 | 32 → 0 |
| intel | wide | reference | 26.816 | 2.675 | 277.3 | 146.7 | 32 → 0 |
| intel | wide | compiled | 28.638 | 8.530 | 281.5 | 167.3 | 32 → 0 |
| intel | text | reference | 1104.943 | 3.681 | 408.9 | 132.8 | 32 → 0 |
| intel | text | compiled | 1111.714 | 6.889 | 415.7 | 162.2 | 32 → 0 |
| intel | returns | reference | 36.173 | 16.781 | 279.5 | 263.4 | 64 → 0 |
| intel | returns | compiled | 34.653 | 14.791 | 284.4 | 273.2 | 64 → 0 |
| intel | live | reference | 1.401 | 1.236 | 146.6 | 130.2 | 1 → 1 |
| intel | live | compiled | 5.218 | 8.631 | 162.6 | 176.6 | 1 → 1 |

Alias retirement removes 8,388,608 copied cells per measured call; return
chains remove 16,777,216. The text case especially stresses the former
repeated copying and validation of boxed scalar storage. Its large speedup
should not be extrapolated to normal text processing. Live aliases still
require one copy. Live-alias timings are mixed and do not establish absence of overhead; Intel
compiled peak RSS increases in this control, so there is no universal RSS
reduction claim. Compiled execution also remains slower than reference for
some short workloads, despite eliminating copies in both.

The runtime now distinguishes scoped bindings from conservatively retained
owners. Overwriting a local or completing a nonescaping invocation retires
only its own bindings. The same scope is used by reference frames and exact
compiled kernels. Opaque callbacks, external returns, lazy readers, globals,
closures, generators, inspection and original diagnostic arguments retain
their protection. The callback boundary is necessary for filters that keep
using the array passed into their predicate.

Direct `NativeFunction.call` inputs now retain an implicit caller owner even
without a Rank binding. Mutating a freshly supplied host array can therefore
require one copy. Ordinary Rank calls can still transfer a proven private
last-use argument. Constructor-only scratch arrays keep the cheaper existing
compiler bookkeeping, avoiding a scope allocation when no alias can retire.

Current limits: scoped retirement accepts completed native one-dimensional
scalar arrays. Other array ranks/storage and escaping frames retain the
previous conservative ownership. This is not general SSA liveness: a local
that is merely no longer read still owns its value until overwrite, an
existing proven last-use transfer, or scope completion. Mutating linked
callees still have the compiler's existing admission restrictions. Number
speculation keeps its replay/publication snapshots; uniqueness alone does not
permit changing public buffers before a region commits.

Raw observations: [2026-11-04-array-lifetimes.json](baselines/2026-11-04-array-lifetimes.json).


## Integration and regression checks

The final implementation includes `origin/main` at `937a2133`. A failure of
`array-block-copy.test.ts` was reproduced on that clean main: eliding a real
selection copy caused a 10,000-cell type rescan at private publication. Such
copies now keep the native path and its existing uniform-kind evidence.

All 12,117 ordinary interpreter tests in 568 files passed on Mac; the three
exhaustive audits (`types`, `differential`, `nurikabe`) were excluded as required
by `AGENTS.md`. The Intel selection passed 678 tests in 23 files, including
ownership, replay, slice copies and the full Euler 407 answer. The root build
and interpreter test typecheck passed on Mac; interpreter/test typechecks
also passed on Intel.

Existing composable-region controls were compared separately with the newer
clean main (`937a2133`), using 40 warmups, eight rounds and the median of three
samples without diagnostics:

| Host | Control | Main ms | Candidate ms |
| --- | --- | ---: | ---: |
| mac | helper | 2.827 | 1.817 |
| mac | plans | 34.899 | 34.631 |
| intel | helper | 3.531 | 3.389 |
| intel | plans | 97.927 | 101.971 |

These controls exercise pure numeric helper calls and a function combining
reusable factor plans, a set and local scratch arrays. They check that scoped
ownership does not impose the same bookkeeping on every compiled function.
