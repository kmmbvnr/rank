# Complete AoC 2016 day 5 searches

Measured on 2026-09-22 with Node v24.15.0:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/aoc-chess.mjs
```

The benchmark imports the unchanged `demos/aoc/2016/005_chess.ra` and calls each
part with `abc`. Both modes use the same trusted Node MD5 backend and direct loop
control. The reference mode sets `nativeLoopCompilation: false`.

Each mode, part and repetition runs in a fresh process. Three repetitions run
sequentially, without concurrent test or build jobs. Timing includes the complete
function call and its first loop compilation, but excludes process startup and
module loading. There is no separate warm-up. Both official passwords are checked
on every run. An execution counter must report one compiled loop per compiled
search and zero for the reference search.

| Part | Reference samples (s) | Compiled samples (s) | Reference median | Compiled median |
| --- | --- | --- | ---: | ---: |
| Part 1 | 15.3493, 15.1629, 15.1209 | 6.3069, 6.3222, 6.2909 | 15.1629 s | 6.3069 s |
| Part 2 | 24.6181, 24.6210, 24.8301 | 10.1041, 10.1870, 10.2154 | 24.6210 s | 10.1870 s |

Part 1 returned `18f47a30`; part 2 returned `05ace8e3`. The sum of the two medians
is 39.7840 seconds for reference execution and 16.4938 seconds for compiled
execution, about 2.41 times faster. This sum is not a separate timing of a single
CLI invocation.

The compiler changes are general: trusted host-effect declarations, Unicode
string indexing, string `+=`, text-array reads/writes and `join`. The search
algorithm and Rank source did not change. Unannotated host callbacks still fall
back. Text-array aliases created and mutated within the same region also fall
back to preserve value semantics; the demo does not need that case.
