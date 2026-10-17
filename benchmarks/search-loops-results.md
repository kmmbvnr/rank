# Search loop measurements

Measured on 2026-10-17, Apple M5, Node v24.15.0. Runtime based on main
`9e461a58` plus the issue #294 changes.

Build with `npm run langium:generate && npx tsc -b tsconfig.build.json`, then run
`node benchmarks/search-loops.mjs`. Use `--root /path/to/built/checkout` to hold
the source fixtures fixed while changing the runtime. Raw samples are in
[search-loops-results.json](search-loops-results.json).

Three sequential fresh-process samples per case, with local tests, builds and
profilers stopped. Execute time includes parsing and excludes module startup.
RSS is the process high-water mark, including startup, rather than live heap.
Answers are checked in every sample. Separate counted runs assert fixed work
counts; their timings are excluded. These measurements are not CI timing gates.

| Program | Median execution s | Median peak RSS MiB | Counted work |
| --- | ---: | ---: | ---: |
| recursive103 | 3.439 | 427.5 | 461956 |
| depth103 | 6.768 | 419.2 | 557641 |
| demo103 | 0.467 | 171.7 | 557641 |
| recursive88 | 4.504 | 436.2 | 421978 |
| batch88 | 3.066 | 618.8 | 421978 |
| stack88 | 6.615 | 587.5 | 421978 |

The frozen recursive fixtures come from `fc215673` (103) and `4eee030b` (88).
`depth103` is the pre-change demo from `9e461a58`; `demo103` is the updated demo.
The 103 sources visit different counted events: recursive candidate attempts
versus depth-loop iterations (including backtracking and bound termination).
Both depth sources execute exactly 557641 iterations. The scalar leaf spelling
allows the complete new loop to compile; it does not change the search bounds.

The updated 103 executes one whole-loop kernel. The original depth fixture
executes no whole-loop kernel. The recursive 103 executes scalar/block paths,
so zero compiled loops does not mean entirely uncompiled execution. The saved
set remains 20 31 38 39 40 42 45, sum 255, answer 20313839404245.

All 88 variants visit 421978 states and return 7587457. The stack fixture is the
explicit four-integer-array DFS added as `088_productsum_stack.ra`, not an
archived copy of the original reported 20.7-second program. It meets the 8-second
target on current runtime, but remains slower than the batch demo. Array payload
push/pop and unpack still use ordinary execution; no new typed-frame compiler
or container backend is claimed. Keep the faster batch demo alongside it.

Both local issue targets are met: updated depth-array 103 below 4 seconds and
the exact checked-in stack 88 below 8 seconds. The BigInt bit calls retain
checked native implementations; the complete-region statement budget is 128.
This implementation does not remove COW or alter array snapshot semantics.
