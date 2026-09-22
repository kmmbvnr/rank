# General loop-control benchmark

Measured on 2026-09-22 with Node v24.15.0. Run from the repository root:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/loop-control.mjs
```

Each case and mode runs in a separate process, with 10,000 warm-up iterations
and five samples of 100,000 iterations. Every result is checked. The reference
mode sets `directLoopControl: false`; the direct mode enables the new default.
Both modes disable integer-loop compilation to measure the general interpreter
path. Fully compiled integer loops already use native JavaScript jumps.
Hash cases use the same Node MD5 backend in both modes.

| Case | Reference median (ms) | Direct median (ms) | Speedup |
| --- | ---: | ---: | ---: |
| Numeric loop, skip even values | 42.22 | 15.21 | 2.78× |
| Text prefix, skip matches | 82.25 | 77.16 | 1.07× |
| MD5 byte prefix, early `continue` | 696.42 | 247.06 | 2.82× |
| MD5 byte prefix, positive `if` | 186.10 | 185.09 | 1.01× |
| Nested loop, early `break` | 519.61 | 256.69 | 2.02× |

The change removes exception unwinding from ordinary loop jumps. It does not
change MD5 or recognize a particular task. The positive-`if` hash case checks a
path without jumps; its timings were nearly unchanged. Early `continue` still
costs more than the positive-`if` form in this workload.

Protected jumps through `try/catch/finally` retain exception unwinding. These
measurements do not claim an improvement for protected jumps, fully compiled
integer loops, or whole programs with different workloads.

The regression matrix covers both jump modes, compiled/reference blocks and
prepared/unprepared loop bodies. It checks nested and conditional loops,
suspended calls, generator cleanup, protected jumps, iteration results, invalid
jumps and cancellation.
