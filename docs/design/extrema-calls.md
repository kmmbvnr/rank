# min/max calls and shadowing

The measurements below describe the September 11 implementation. The
[September 13 grouping change](expression-grouping-review.md) moves infix
normalization into the language package and removes the remaining builtin-only
postfix addressing rule. Write `(Matrix i) max` to reduce a selected row.

## Why the review was right

The old interpreter recognized the names before resolving their bindings.
Simple infix expressions bypassed function calls entirely. The resumable path
also dispatched infix extrema as numeric operators, and postfix calls enforced
builtin reduction rules before looking up a user function.

Tests covered operand changes and shadowed unary reductions, but not shadowed
binary infix or postfix calls. The direct-path test required that the expression
compiler never run. That checked one implementation, not whether the name was
resolved correctly.

## Refactoring

- Infix syntax supplies arguments to the ordinary application compiler.
  Each step evaluates left, right, then the function binding. Chains associate
  from the left. Calls may suspend or recurse like any other Rank call.
- Builtin binary broadcasting belongs to the numbers module, so an alias has
  the same behavior. Numeric ties preserve the left operand, matching the
  existing builtin rather than the old infix shortcut's right-operand choice.
- At the time of this review, the remaining contextual rule was builtin postfix addressing:
  `Matrix i max` reduces a row. It applies only after function identity is
  checked. Shadowing functions use ordinary argument selection.
- Parentheses and completed application operands do not allocate a suspended
  wrapper. The shared small-call path avoids per-call `map`/`some` callbacks.

The runtime changes remove about 40 net lines. No new binding cache or
min/max execution engine remains. A trial builtin-name cache did not remove
the measured cost convincingly and was removed.

## Verification and performance cost

The parser's 43 tests and interpreter's 461 tests pass, as do all 206 demo test
files at baseline `6b8ed2e`. New tests cover imported and unimported shadowing,
local and parameter bindings, rebinding between calls and inside the right
operand, 10,000 recursive calls, lazy aliases, queues and numeric ties.
The execution-path test now checks synchronous completion of builtin chains.
All six judge-scale cases pass at 200,000 items: restaurant 2,439 ms, rooms
1,722 ms, playlist 490 ms, books 185 ms, bounded-sum 657 ms and sum 177 ms.
These are single cold runs for the time gate, not paired speedup estimates.

The [seven-sample comparison](../../benchmarks/baselines/2026-09-11-extrema-shadowing.json)
uses independent installations in candidate and baseline worktrees. Both start
from `6b8ed2e`. On Apple M5 / Node 24.15.0:

| Workload | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Infix max, 1 million iterations | 170 ms | 222 ms | +30% |
| Infix min, 1 million iterations | 171 ms | 233 ms | +36% |
| Alias max, 1 million iterations | 216 ms | 193 ms | -11% |
| Alias min, 1 million iterations | 224 ms | 189 ms | -15% |
| Playlist, 200,000 items, cold CLI | 466 ms | 482 ms | +3.4% |

Arithmetic and conditional controls differ by about -3% and 0%. The existing
25% baseline-regression gate fails on scalar infix calls. Its threshold was
not changed. This branch is a correctness/simplicity tradeoff, not a
performance-neutral change, and is not automatically approved for main.

The [first isolated run](../../benchmarks/baselines/2026-09-11-extrema-shadowing-noisy.json)
had large timing outliers and is retained for transparency, not used to claim
a demo speedup. Earlier exploratory CLI measurements shared main's package
links and are excluded. Dependencies were installed independently before the
full demo suite and saved comparisons.

Reproduce after building each checkout:

```sh
node benchmarks/extrema.mjs --baseline=/path/to/built/baseline --samples=7
node benchmarks/judge-scale.mjs
```

Before merging, either accept the measured cost of ordinary binding resolution
or find a smaller common-call improvement that passes the unchanged gate.
Do not restore a syntax-only builtin shortcut: any shortcut must preserve
shadowing, operand order and resumable calls.
