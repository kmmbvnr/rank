# Scoped array binding lifetimes

Measured on 2026-11-04 against `a953e835`, Node 24.15.0 on both
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
| mac | integer | reference | 1.968 | 0.655 | 284.3 | 157.0 | 32 → 0 |
| mac | integer | compiled | 6.158 | 4.473 | 329.8 | 180.9 | 32 → 0 |
| mac | wide | reference | 3.113 | 0.687 | 322.6 | 160.3 | 32 → 0 |
| mac | wide | compiled | 6.287 | 4.575 | 295.8 | 179.8 | 32 → 0 |
| mac | text | reference | 408.466 | 0.988 | 430.7 | 163.8 | 32 → 0 |
| mac | text | compiled | 425.665 | 3.407 | 443.9 | 180.4 | 32 → 0 |
| mac | returns | reference | 5.023 | 2.309 | 433.6 | 288.1 | 64 → 0 |
| mac | returns | compiled | 4.754 | 2.043 | 441.7 | 290.6 | 64 → 0 |
| mac | live | reference | 0.292 | 0.299 | 159.1 | 159.9 | 1 → 1 |
| mac | live | compiled | 1.792 | 1.822 | 188.0 | 187.7 | 1 → 1 |
| intel | integer | reference | 14.298 | 2.904 | 270.5 | 142.8 | 32 → 0 |
| intel | integer | compiled | 28.236 | 8.273 | 279.0 | 170.0 | 32 → 0 |
| intel | wide | reference | 26.816 | 2.707 | 277.3 | 147.4 | 32 → 0 |
| intel | wide | compiled | 28.638 | 8.739 | 281.5 | 167.2 | 32 → 0 |
| intel | text | reference | 1104.943 | 3.642 | 408.9 | 130.0 | 32 → 0 |
| intel | text | compiled | 1111.714 | 6.699 | 415.7 | 165.0 | 32 → 0 |
| intel | returns | reference | 36.173 | 15.191 | 279.5 | 247.9 | 64 → 0 |
| intel | returns | compiled | 34.653 | 14.184 | 284.4 | 274.2 | 64 → 0 |
| intel | live | reference | 1.401 | 1.546 | 146.6 | 145.7 | 1 → 1 |
| intel | live | compiled | 5.218 | 4.846 | 162.6 | 176.2 | 1 → 1 |

Alias retirement removes 8,388,608 copied cells per measured call; return
chains remove 16,777,216. The text case especially stresses the former
repeated copying and validation of boxed scalar storage. Its large speedup
should not be extrapolated to normal text processing. Live aliases still
require one copy. The small live-alias timing changes are mixed; Intel
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

Current limits: scoped retirement accepts completed native one-dimensional
scalar arrays. Other array ranks/storage and escaping frames retain the
previous conservative ownership. This is not general SSA liveness: a local
that is merely no longer read still owns its value until overwrite, an
existing proven last-use transfer, or scope completion. Mutating linked
callees still have the compiler's existing admission restrictions. Number
speculation keeps its replay/publication snapshots; uniqueness alone does not
permit changing public buffers before a region commits.

Raw observations: [2026-11-04-array-lifetimes.json](baselines/2026-11-04-array-lifetimes.json).
