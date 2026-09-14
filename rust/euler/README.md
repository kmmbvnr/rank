# Euler 1–10: LLM-aided Rust rewrites

Each directory contains `exact/` and `i64/` Cargo projects. They include the
exported `task.md`, source/test snapshots, numeric-policy manifest, verification
inputs, generated `src/main.rs`, Cargo.lock and per-case verification report.
All 20 projects build; **237 comparisons pass**.

| Euler | Program | Default answer |
| --- | --- | ---: |
| 1 | [Multiples](001_multiples) | 233168 |
| 2 | [Even Fibonacci](002_evenfib) | 4613732 |
| 3 | [Largest prime factor](003_primefactor) | 6857 |
| 4 | [Palindrome product](004_palproduct) | 906609 |
| 5 | [Smallest multiple](005_smallestmultiple) | 232792560 |
| 6 | [Sum square difference](006_sumsquarediff) | 25164150 |
| 7 | [10001st prime](007_10001stprime) | 104743 |
| 8 | [Series product](008_seriesproduct) | 23514624000 |
| 9 | [Pythagorean triplet](009_pythagorean) | 31875000 |
| 10 | [Prime sum](010_sumprimes) | 142913828922 |

From the repository root, with built Rank packages and Rust/Cargo available:

```sh
npm run test:rust
cargo run --release --manifest-path rust/euler/002_evenfib/exact/Cargo.toml -- --limit 100
```

Use `CARGO_TARGET_DIR=/tmp/rank-euler-target` to share the Cargo cache across
projects. `verify.mjs` writes the aggregate [results.json](results.json) and each
project's `verification.json`. The verifier's default-input and other cases run
the actual original Rank source, including its print output.

The exact variants use BigInt for Rank integer arithmetic; checked machine
indices are used for prime storage/sieves and digit windows. Inputs beyond
machine indexing/allocation capacity fail explicitly. The i64 variants use
checked arithmetic with no external Rust crate dependencies. LCM at limit 50
and sum-square difference at limit 100000 demonstrate deliberate i64 overflow;
the exact variants match Rank. Fibonacci also covers an exact input of 10^100.

The original `_test.ra` default and workspace examples are included in the
verification inputs. Extra cases cover empty reductions, zero/negative limits,
invalid prime indices, oversized/invalid windows, missing triplets and malformed
arguments. Error text may differ; failure and preceding stdout must agree.
This is finite coverage, not a proof for all inputs or a general Rust backend.

The generated implementations fuse pure array/sequence operations into loops,
use arithmetic sums for pure ranges, avoid palindrome outer-product storage,
and sieve bounded primes. These fixture-specific optimizations were reviewed
against the source; the npm package exports facts and tasks rather than picking
these algorithms automatically.

`generate.mjs` preserves the coding agent's fixture implementations and prepares
the tasks through `@arrrank/compile`. It refuses to overwrite existing projects;
reproduction requires moving existing generated directories aside first.
It is a saved artifact recipe, not a template backend used by the npm package.
The saved task files contain only generation instructions and program context.
No independent external agent run is claimed.
