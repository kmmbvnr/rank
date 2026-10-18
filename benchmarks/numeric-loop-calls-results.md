# Integer numeric loop calls (#309)

Measured on Apple M5, Node 24.15.0. Baseline: main `98514025`.
The candidate adds guarded scalar integer profiles and extracts native argument
lowering from `emitInput`. Numeric algorithms are unchanged.

Build both checkouts, then run:

```sh
node benchmarks/numeric-loop-calls.mjs \
  --baseline=/absolute/path/to/baseline/packages/interpreter/out/index.js
```

Each of three samples starts a fresh process. Execute time includes parsing,
compilation, allocation and the complete program; cold time also includes Node
startup and module imports. Diagnostics use an additional untimed process.
All runs verify the exact answer. No peak heap/allocation measurements were made.
The [raw samples](baselines/2026-10-18-numeric-loop-calls.jsonl) include diagnostics.

## Coprime search

The issue's full 3000 × 3000 search returns **5472375** in every run.
Both compiled variants execute one outer region.

| Runtime/source | Median execute | Median cold |
| --- | ---: | ---: |
| Baseline, `gcd` call | 12.330 s | 12.681 s |
| Candidate, `gcd` call | 1.576 s | 1.892 s |
| Candidate, inline Euclid | 4.851 s | 5.172 s |

The call is about 7.8× faster than the interpreted baseline and 3.1× faster than
inline Euclid on this machine. The acceptance threshold is call time no more
than twice inline time, not a fixed absolute duration. The benchmark asserts
that comparison and verifies compilation in its separate diagnostic run.

## Demo rewrites

The frozen inline fixtures are the demo sources from `98514025`. Both source
variants below run on the candidate runtime, isolating the source rewrite.

| Demo/input | Inline execute / cold | Builtin execute / cold | Answer |
| --- | ---: | ---: | ---: |
| 141, Limit 10^12 | 1.591 / 1.920 s | 1.139 / 1.477 s | 878454337159 |
| 155, Count 15 | 1.880 / 2.206 s | 1.659 / 1.988 s | 241519 |
| 170, Low 0 | 15.474 / 15.817 s | 13.582 / 13.930 s | 9857164023 |

141 uses `gcd` and `isqrt`; its residue filters remain. 155 and 170 replace only
their manual Euclid sections with `gcd`. These measurements do not establish the
cost of 155's larger default Count 18.

127 already uses array-based `gcd` and keeps its source unchanged. At default
Limit 120000 it returns **18407904**. Median execute/cold times were
17.880 / 18.518 s on the baseline and 16.103 / 16.522 s on the candidate. The
spread and sequential sampling do not justify claiming a speedup for this
unchanged array algorithm; this is a correctness and regression check.

## Verification and limits

Numeric parity tests cover signed/zero operands, integers beyond Number/Int64,
root boundaries, invalid arguments, formatted errors and partial assignments,
short-circuiting, empty loops, function error frames, and interruption inside
long gcd/powmod/binomial calls. User-defined functions with builtin spellings
keep compiling when `numbers` is not imported. Cached loops also recover their
native compilation after a missing-import error followed by `use numbers`.
The existing identity/module binding checks remain in place.

The final binding-selection changes followed the main timing samples. Generated
JS and results were checked identical before/after those changes for imported
numeric calls and all three rewritten demos at reduced inputs; a final full-size
coprime timing repeat is [recorded separately](baselines/2026-10-18-numeric-loop-calls-final.jsonl):
call 1.565 s execute / 1.892 s cold, inline 4.859 s execute / 5.176 s cold
(three samples each, same exact result and one compiled outer region).
Timing is wall-clock and varies
with machine load. These results do not add real-valued loop support, broaden
array/ranked call contracts, or claim that numeric calls cannot throw.
