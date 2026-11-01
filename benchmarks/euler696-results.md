# Euler 696 (#500)

The demo uses the existing `A convolve B mod P` operation for the flat
block-series products and final suit-series exponentiation. No interpreter
or compiler change is needed: the modular convolution kernel added for #484
already avoids overflow and uses NTT for the large products.

The old loops compute a prefix of a polynomial product modulo 1,000,000,007.
The new code computes that product, takes the same prefix, and preserves the
existing mask on the flat (length, tile-count) series. The block automaton,
counting DP, placement coefficients and exponentiation algorithm are unchanged.

## Measurement

After `npm run build`, from the repository root:

```sh
node benchmarks/euler696.mjs baseline
node benchmarks/euler696.mjs blocks
node benchmarks/euler696.mjs convolve
node benchmarks/euler696.mjs blocks --tail
node benchmarks/euler696.mjs convolve --tail
```

`baseline` reconstructs both old loops. `blocks` changes only the large
block-series products. `convolve` also changes the short suit-series products.
Each full-program sample runs in a fresh sequential Node process, including
parsing and execution, excluding imports and Interpreter construction.
Every sample asserts the answer `436944244`.

Apple M5, Node v24.15.0, three samples per mode:

| Mode | Wall seconds | Median | Peak RSS MiB |
| --- | --- | --- | --- |
| baseline | 10.414 / 12.388 / 12.256 | 12.256 | 760-831 |
| blocks | 2.322 / 2.329 / 2.412 | 2.329 | 651-673 |
| convolve | 2.289 / 2.657 / 2.452 | 2.452 | 633-688 |

The large-product change is about 5.26x faster than the current baseline.
The final version is about 5.00x faster and comfortably below ten seconds.
The second change has no distinguishable whole-program speedup in these
samples. Isolating the final exponentiation with `--tail` gives a median of
61.57 ms for manual loops versus 5.37 ms for convolution across five
executions after prefix initialization. This is a small part of total time;
these repeated tail executions include warm-up, unlike the fresh full runs.

The original 49-second report predates other interpreter improvements.
Investigation using separate execute calls per phase measured 7.9-8.9 seconds
for the old program and about 2.2 seconds for the new one. Full-program
measurements above are the delivery comparison. Timings vary with runtime
compilation, allocation and machine load.

Raw measurements are in `baselines/2026-11-01-euler696.json`.

## Verification

- `npm run build`: passed in the isolated worktree.
- Focused tests: 85 passed (`euler696`, `convolution`), including the full input,
  four published examples and exact modular convolution reference tests.
- Original Rank fixture: 1 passed, covering the four published examples.
- Exclusion manifest tests: 3 passed; Euler 696 is eligible again.
- During investigation, checksums of eight intermediate arrays matched between
  both programs for all five inputs, in addition to their golden answers.
- Full `npm test` and corpus audits were not run.
