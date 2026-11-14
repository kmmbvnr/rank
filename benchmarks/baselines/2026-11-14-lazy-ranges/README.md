# Lazy range tensor inputs (#573)

Each measurement used a fresh Node process. Timings include parsing and input
construction; peak RSS comes from `process.resourceUsage()`. These are individual
samples, not timing guarantees. Both machines used Node v24.15.0.

Reproduce after building:

```sh
node benchmarks/lazy-ranges.mjs lazy 100000000
node benchmarks/lazy-ranges.mjs stored 100000000
node benchmarks/lazy-ranges.mjs reference 100000000
node benchmarks/lazy-ranges.mjs lazy 1000000 6
node benchmarks/lazy-ranges.mjs stored 1000000 6
```

The script checks answers against independent closed forms. For Euler 1,
`stored` restores the original eager binding; `reference` disables compilation.
For Euler 6, `stored` restores the original `Range ** 2` expression (the range
was already lazy). Its new multiplication recipe can use checked Number
registers, with an exact BigInt fallback. No phone measurements were made.

## Demo review

The review searched eager arithmetic range bindings feeding deferred expressions
throughout `demos/euler`, then inspected their collection use. Two changes have
measured benefits:

- Euler 1: make `N` lazy. The mask and selection sum now share one numeric kernel;
  the source range and mask flags do not need stored arrays. Peak RSS fell from
  about 1.5 GiB to 170 MiB on the Mac and 158 MiB on Intel at 100 million values.
- Euler 6: keep the existing lazy range and express squares by multiplication.
  This enables one numeric kernel for the sum of squares. At one million values
  this was about 1.5 times faster on the Mac and 1.6 times faster on Intel, with
  similar peak memory.

Representative candidates left eager after inspection:

- Euler 120 and 158 return their elementwise results in records. Changing arrays
  into sequences would also change those public result fields.
- Euler 123 and 183 combine aligned arrays and use elementwise selection; replacing
  a leaf by a sequence introduces different alignment and mask semantics.
- Euler 190 and 203 reshape ranges for broadcast grids; these need array shapes.
- Euler 207 uses a stored prefix scan and aligned masks, rather than a scalar
  range map followed directly by a reduction.
- Euler 131 builds and filters polynomial candidates before prime membership;
  that consumer is outside this scalar-map/reduction optimization.

This review does not claim that every Euler demo was benchmarked. It avoids
blanket apostrophe replacements: sequence zips, array broadcasting, random
access, and mutation require separate checks.

`final-*.jsonl` repeats the Euler 1 measurement after adding native reader and
predicate replacement guards. The Mac repeat overlapped the ordinary test suite,
so its elapsed times include CPU contention. Both repeats retain one kernel and
the same memory reduction.
`final-mac-idle.jsonl` ran after that suite finished: 0.464 s / 174 MiB for
the lazy form versus 2.105 s / 1552 MiB for the stored form.
