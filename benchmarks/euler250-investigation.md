# Euler 250: prime-power residue periods

The original subset-sum DP is already compiled, but repeats 62,562,500 exact BigInt updates and the same number of explicit table-cell copies. Number execution correctly rejects the input modulus 10^16 as unsafe. Diagnostics record only two copy-on-write copies totaling 500 cells, not a fresh array snapshot on every step. The main opportunity is to reduce the work.

The replacement derives a residue period for every positive M, builds the short prefix and one complete period by the original DP, and raises the period polynomial by cyclic multiplication. It retains the default input and answer **1425480602091519**, exact integer arithmetic, arbitrary count moduli, and the original fixture assertions. No interpreter/compiler changes or numeric threshold adjustments are needed.

## Why the period is valid

Let T=lcm(M,phi(M)). For k>=M, k^k mod M repeats with period T. For each prime power p^a dividing M:

- If p divides k, k>=M>=a makes both k^k and (k+T)^(k+T) zero modulo p^a.
- Otherwise the bases agree modulo p^a because M divides T, and the exponent difference T is divisible by phi(p^a). Euler's theorem gives the same power residue.

The Chinese remainder theorem gives equality modulo M. Retaining the prefix avoids assuming this period holds at the earliest exponents for arbitrary M.

For N>M+T, Prefix=M+(N-M) mod T; otherwise Prefix=N. Build P for the first Prefix terms and B for the following T terms. The desired generating polynomial is P*B^Q modulo x^M-1 and Mod, where Q=(N-Prefix)//T. Binary exponentiation uses cyclic dot products; products and sums remain exact, and reduction happens after each complete dot product.

At the default M=250, phi(M)=100 and T=500, so Prefix=250 and Q=500. Only 750 ordinary DP steps plus 14 cyclic products are needed. The period 500 is computed rather than hardcoded.

## Controlled comparison

Base: `781b814f981a89ea25532c1a36099f5f8fe25824`. Fresh Langium generation and TypeScript project build; the same unchanged runtime executes each frozen source. macOS arm64 / Node v24.15.0. Three fresh sequential processes per variant, alternating order. Imports are excluded; parsing, preparation, evaluation and diagnostics are included. Load averages before were 1.94/2.40/2.32 and after 2.62/2.46/2.35. These are local measurements, not cross-platform claims.

| Full default variant | Median time | Median peak RSS |
|---|---:|---:|
| Original exact DP | 6.592 s | 173.03 MiB |
| Same DP with bounded signed residues | 1.601 s | 175.19 MiB |
| Periodic blocks, exact cyclic dot products (shipping) | **0.213 s** | 180.13 MiB |
| Periodic blocks, array dot products | 0.417 s | 303.13 MiB |

Shipping is **30.94x** faster by the ratio of medians. All samples give the full golden answer. The bounded signed variant was an experimental control for the default modulus, not an arbitrary-Mod replacement. The array variant is shorter but computes 1,743,000 intermediate cells and cannot compile the convolution loop (`loop:unsupported-op:sum`). The selected scalar loop backend compiles the dot products despite a scalar-function proof rejection. This is a separate general compiler opportunity, not a blocker for this workload.

Process peak RSS is not retained memory; the selected variant has a slightly higher process peak than the original. No memory-saving claim. Prior exploratory measurements are retained separately and are not pooled with this fresh-build comparison.

With compilation disabled, the shipping full program has a three-sample median of **1.433 s**. The expanded fixture passes in **0.320 s compiled / 2.327 s reference** (single observations), including its default assertion. The original full reference workload was not rerun; no full reference speedup ratio is claimed. Both historical execution-budget exclusions are removed, returning the main and fixture to type/differential audits.

## Verification

- Fresh language generation and TypeScript build.
- **86** direct-DP oracle comparisons across both engines: positive M including primes, prime powers and non-coprime residues, period boundaries and partial periods, empty input, M=1, Mod=1/2/3/97, negative Mod and Mod=10^30.
- Independent Python uses builtin modular power and direct residue DP with no periodic grouping; tiny cases are also checked by exhaustive subset enumeration. Full default answer independently verified.
- Four fixture blocks pass in both engines, preserving all three previous golden assertions and adding boundary/arbitrary-modulus assertions (16 module runs per engine).
- Scoped type and differential audits: **4/4** checks, covering both now-eligible files.
- Semantic checks: **11/11**, 65 semantic owners; application-form checks pass.
- CLI `check` passes separately for the main and fixture; harness JS syntax and whitespace checks pass.

No runtime code changed; the broad workspace test suite and unrelated Euler workloads were not rerun.

## Reproduce

From a built checkout:

```sh
node benchmarks/euler250-subsets.mjs --variant=original
node benchmarks/euler250-subsets.mjs
node benchmarks/euler250-subsets.mjs --reference
node benchmarks/euler250-subsets.mjs --fixture
node benchmarks/euler250-subsets.mjs --fixture --reference
node benchmarks/euler250-subsets.mjs --N=503 --M=10 --Mod=97 --expect=15
python3 benchmarks/experiments/euler250-oracle.py
```

The harness accepts `--runtime=/absolute/path/to/index.js` for isolated builds. Run timing samples in fresh sequential processes. Frozen comparison sources, SHA256 hashes, all raw measurements, independent validation results and check logs are in `benchmarks/baselines/2026-10-28-euler250.json`.
