# Euler 249: exact bounded residues and a private function region

Euler 249 updates a descending subset-sum table once per prime. At the unchanged
`Limit=5000`, there are 669 primes, the largest sum is 1,548,136, and the program
performs 325,967,779 table updates. The answer remains **9275262564250418**.
The dynamic programming algorithm and default arguments are retained.

## Cause and change

The original nested loop already compiled. Its `Mod=10^16` is larger than
`Number.MAX_SAFE_INTEGER`, so the Number entry guard correctly selected the
exact BigInt backend. There were no CoW copies or typed-buffer unpacks in the
recorded original full runs. Removing that precision guard would be incorrect.

The program now stores a residue in `[-Low, High)`, where
`Low=floor(Mod/2)` and `High=Mod-Low`. For positive moduli whose upper bound fits
Number's exact integer range, addition wraps **before** forming an oversized sum:

- If `From >= 0` and `Value >= High-From`, add
  `(Value-High) + (From-Low)`.
- If `From < 0` and `Value < -Low-From`, add
  `(Value+Low) + (From+High)`.
- Otherwise add `Value+From` directly.

Each branch preserves the residue modulo `Low+High`. Both the comparisons and
the executed arithmetic stay in the safe integer range. The wrapped result stays
in `[-Low, High)`. The initial count is represented canonically for moduli 1 and
2 as well. Odd moduli are supported. The final prime-index sum and reduction use
exact arithmetic. Larger and nonpositive moduli retain the original BigInt
algorithm, including its division-by-zero error for modulus zero.

The table is allocated inside an ordinary helper. Previously, function-region
preparation required at least two top-level loops; one outer loop with a nested
loop did not qualify. Region preparation now also tries a single top-level loop.
The existing lowering and entry guards still require fresh local writable arrays
and safe speculative execution. No copy threshold, precision limit, lazy-binding
rule, or fallback behavior was relaxed. Allocation and all updates run as one
Number region, followed by ordinary return dispatch.

This does not add general array iteration to the scalar-function kernel. Its
`loop-range` rejection can still appear during preparation; the existing numeric
function-prefix backend executes the hot region instead.

## Measurements

Fresh processes on Apple M5, macOS arm64, Node v24.15.0. Parent revision
`24238fbbacf1248bbc49ff831b9b6b4998b214b2`; baseline and changed runtimes were
built in an isolated copy with local workspace package links. Imports are
excluded; parsing, preparation, evaluation and diagnostics are included.
Samples were sequential, with alternating version order. RSS is whole-process
high-water memory, not retained table bytes. Terminal and WindowServer remained
active; these are local loaded-machine observations, not cross-platform results.

Final program comparison, three full-input samples per version:

| Version | Median seconds | Samples, seconds | Median peak RSS, MiB |
| --- | ---: | --- | ---: |
| Original program and compiler | 28.214 | 28.110, 32.720, 28.214 | 219.08 |
| Final program and compiler | 4.365 | 4.361, 4.377, 4.365 | 211.09 |

The measured ratio of medians is **6.46x**. The original 32.720-second sample
illustrates the noise; the conclusion does not rely on that outlier. No universal
memory-saving percentage is claimed.

A separate control ran the **final program with the baseline compiler**:
**33.246 seconds**, correct answer, zero Number loops, and
`number-loop:condition-write-budget`. This is one control, not a median. It shows
why changing only the program does not provide the measured improvement.

Earlier alternatives, three samples each in a separate cohort:

| Representation | Median seconds | Median peak RSS, MiB |
| --- | ---: | ---: |
| Original | 28.334 | 219.77 |
| Two bounded digits in a private matrix | 3.980 | 337.95 |
| One signed-residue table, even-modulus prototype | 4.203 | 212.03 |

The single table was chosen for its much lower peak memory and small speed
tradeoff. The final version also handles odd moduli. An initial single sample
replacing `% Mod` with a comparison/subtraction took 32.847 seconds, versus
27.932 seconds for its original control. Two standalone digit arrays took
61.437 seconds because the Number copy-budget guard selected exact execution.
Those are exploratory single samples, not pooled with the final cohort.

Reference controls at `Limit=500`, three fresh processes each: original median
**0.842 seconds**, final **0.874 seconds**. Samples were 0.840/0.866/0.842 and
0.859/0.874/0.910 seconds respectively. This does not establish a reference
speedup. Full-default reference execution was not rerun, and its existing manual
lane/exclusion remains. No lane, timeout or exclusion files changed.

## Reproduce and verify

After generating the language and building TypeScript:

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/euler249-prime-subset-sums.mjs --variant=original
node benchmarks/euler249-prime-subset-sums.mjs
node benchmarks/euler249-prime-subset-sums.mjs --fixture
node benchmarks/euler249-prime-subset-sums.mjs --fixture --reference
python3 benchmarks/experiments/euler249-oracle.py --limit=300
clang++ -O3 -std=c++17 benchmarks/experiments/euler249-oracle.cpp -o /tmp/euler249-oracle
/tmp/euler249-oracle 5000
```

The benchmark supports `--runtime=/absolute/path/to/index.js`, `--Limit=...`,
`--Mod=...`, `--expect=...`, and frozen `--variant=...` sources from the raw data.
The original program can also run on the changed compiler for a program-level
control. Reproducing the compiler control requires the parent runtime.

Verification includes the full default golden answer in every full benchmark,
a separate C++ implementation using exact uint64 arithmetic and an independent
sieve, and 78 small-input comparisons against a Python oracle in both engines.
The Python oracle enumerates actual subsets up to ten primes, then uses
unbounded counts with reduction only at the end. Cases include empty prime
inputs, moduli 1/2/3, odd/even residues, negative and huge moduli, and both sides
of the safe-bound eligibility cutoff. Modulus-zero errors were checked in both
engines. The fixture retains all three original assertions and adds wrapped
counts and fallback coverage. Four compiler regression tests cover a private
array above the copy budget, empty/repeated array traversals, exact overflow
replay, and error location/call trace preservation.

The accompanying raw data contains build/check/test logs and the recorded
observations: `benchmarks/baselines/2026-10-28-euler249.json`.

Build, semantic/application-form checks and both CLI checks passed. The dedicated
function-prefix suite passed **22/22** tests; the scoped fixture type/differential
run passed **2/2** checks. The ordinary interpreter run passed **9,226** tests with
**five existing failures** across `diagnostics.test.ts`, `io-programs.test.ts`,
and `explicit-plan-demos.test.ts`. Restoring the unchanged parent `fast-paths.ts`
and rerunning those three suites reproduced the same five failures (262 passed).
They concern incomplete-function error wording, the `option`/`argument` names,
and a packed digit-word expectation in another demo. This is not a clean full
suite result; those failures were not repaired as part of Euler 249.
