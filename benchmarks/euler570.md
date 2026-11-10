# Euler 570: keep modular powers batched in compiled loops

Base: `03cdcadb42ffa7773f6d629a823a406bc180b560`.
The full default sums ten million snowflake gcds and returns **271197444**.

## Findings and changes

The original modular reduction already avoids constructing exponentially large
snowflake counts. Its two array `powmod` operations use a four-lane kernel in
reference execution. Number loop compilation instead emitted individual scalar
calls and lost that advantage.

Materialized integer `powmod` vectors in Number loops now use the same
four-lane arithmetic. All three inputs may vary, including broadcast shapes.
The output keeps existing private vector allocation and reuse. Positive moduli
through 2^30 use the kernel; larger moduli retain the ordinary guarded calls.
Scalar tails and partially used plans retain their existing routes. Budget,
interrupt and inspection modes retain scalar checkpoint behavior. No Number
admission threshold changes.

The shared stored-array kernel also accepts three equally shaped integer
arrays. Safe signed bases, nonnegative safe exponents, compact positive moduli
and trusted ordinary storage are required. Unsupported inputs fall back before
publishing a result. Exact wide exponent bits are preserved.

The demo keeps its original formula and one array-oriented batching loop.
Smaller batches bound intermediate storage, descriptive names replace short
codes, and the final residue reduction is omitted because gcd is unchanged.
There is no materialized array of all ten million inputs.

A prototype removes all factors of three from the modulus and replaces the two
powers by one power of 4/3. It is correct, but the extra gcd and inverse-base
arithmetic made it slower; it was not adopted. Batch sizes 65536, 262144 and
1000000 had similar compiled times on Mac. The smallest lowers peak memory;
reference throughput is reported separately below.

## Measurements

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| mac, compiled | 2.957 | 1.367 | 205.5 | 174.3 |
| mac, reference | 1.437 | 1.475 | 300.9 | 257.5 |
| intel, compiled | 6.063 | 3.365 | 192.0 | 163.0 |
| intel, reference | 3.531 | 3.640 | 408.0 | 227.9 |

The smaller batch trades about 3% reference throughput for lower peak memory.
The compiled result is 2.16x faster on Mac and 1.80x on Intel. Single controls
using the old source with the new runtime took 1.418 s on Mac and 3.470 s on
Intel; the new source with the old runtime took 2.938 s and 6.069 s. The
main time gain is in the compiler; the demo rewrite primarily bounds memory.

Three alternating fresh-process old/new pairs per mode and host. Node
v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Each sample checks the full
exact answer. Timings include parsing/execution and exclude interpreter import;
RSS is the process high-water mark. Diagnostics and profiling are disabled.
Raw samples and single source/runtime controls are in
`baselines/2026-11-10-euler570.json`.

## Verification

474 focused checks passed on each host, including the Euler 536 and 374
regressions. Independent BigInt closed forms for the original A(n) and B(n)
check bounds 0, 1, 2, 3, 4, 11, 24, 100 and 500 on Number, exact and reference
backends. All primary samples check the full default answer. Kernel checks
cover signed bases, exponent bits beyond 32 bits, modulus boundaries, scalar
tails, broadcasts, wide output reuse, invalid domains, preceding writes,
unvisited branches and observable-mode fallbacks. TypeScript build, two
filtered differential cases, two filtered type checks, two filtered name-facts checks and exclusion policy
checks passed on Mac. Exhaustive audits and full npm test were not run.

```sh
node benchmarks/euler570.mjs compiled
node benchmarks/euler570.mjs reference
node benchmarks/euler570.mjs exact 500
node benchmarks/euler570.mjs compiled 10000000 benchmarks/fixtures/euler570-original.ra
```

`RANK570_RUNTIME` selects another built runtime. `RANK570_EXPECTED` checks the
answer; `RANK570_DIAGNOSTICS=1` and `RANK570_PROFILE=path` enable separate
instrumented runs.
