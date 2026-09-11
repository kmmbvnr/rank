# Interpreter execution

The TypeScript interpreter is the reference implementation for developing Rank.
Its execution helpers must preserve the language's observable behavior, including
error timing, lexical capture, fixed inferred types and file ownership.

## Architectural direction

[Tensor fusion](tensor-fusion.md) is a core execution direction: compatible
operations should share a plan and traversal, including across private named
intermediates. Coverage will grow incrementally without changing observable Rank
semantics. Compiling loop control flow is independent of tensor fusion.

## Function environments

`packages/interpreter/src/frame.ts` holds a function invocation's values and
inferred types together. Its parent is the environment captured when the function
was defined. Calling a function installs one frame reference and restores the
caller reference in `finally`; it does not copy the caller's scope stack.

Lookup follows lexical parents and then the module's global workspace. Assignment
updates an existing lexical binding, or creates a binding in the current frame.
Parameters belong to the new invocation. Separate calls create separate frames, while
closures from one call share their captured bindings. Suspended generators retain
their frame and install it only while advancing or closing the generator.

Uncaptured local values use numbered slots. A function shares only its name-to-slot
layout across calls; values and inferred types remain per invocation. Prepared name
reads cache a slot guarded by layout identity. An unassigned slot does not shadow
an outer or global binding, even if an earlier invocation assigned that name.

Accessing `captures()` materializes live maps used by closures and file ownership
traversal. The maps then become that frame's source of truth, and its old slot values
are released. Captured frames cannot be reused by tail calls.

## Prepared syntax

`prepared-function.ts` caches generator classification and direct local function
declarations by AST identity. Only syntax is shared: every invocation still creates
its own local functions and captures. A weak cache permits unused ASTs to be freed.

The interpreter also prepares expression handlers on first evaluation. A handler
remembers how to evaluate an expression, including recognized `rank`, `axis`,
`outer`, reduction and slice forms. It does not remember the expression's result.
Names are resolved in the active environment on every execution; arrays and input
sequences are allocated anew. Operands are evaluated in their original order.
Preparation of child expressions remains lazy, preserving errors and side effects
in expressions that have not yet been reached.

Statements also receive a cached handler when execution first reaches them.
Assignments, returns and expression statements whose expressions contain no
applications can use synchronous handlers. Other commands have execution-task
handlers. Loop bindings and compound-assignment operators are prepared once.
Loop sources, conditions, values and assignment targets remain runtime work.

Each stream invocation supplies its own execution context: test assertions, loop,
finally and generator flags. Those flags are never captured from the first call.
Nested bodies are prepared lazily, so an unreached command does not fail early.
The shared stream schedules these handlers and retains one implementation of
`try`, `catch`, `finally`, loops and control transfer. A bytecode VM is not implemented.

## Immediate evaluation

An evaluation returns either a completed value or a suspended execution task.
Blocks execute completed commands in a synchronous loop, preparing each command
only when reached. The first suspension creates a continuation for the remaining
commands. Simple applications can finish native calls and indexing immediately;
the function value is still resolved on each execution. A function with a single
direct return expression also uses a synchronous path, retaining argument checks,
its lexical frame, the call-depth budget and resource ownership.

All calls that can directly recurse still return tasks. No evaluation is replayed
when switching paths. Generator commands remain deferred until iteration starts,
even when those commands could otherwise complete immediately. Fast conditions
and branches retain each invocation's loop, finally, generator and test context.

Simple one- and two-argument postfix calls with directly evaluated operands skip
the general application scan when the target's arity matches. Dynamic targets,
argument evaluation order, rank dispatch and resource ownership are still checked.
Other forms use the general application path without reevaluating operands.

Standard function objects are cached per interpreter, both for calls and for reads
as values. Variable lookup and module selection still happen first. Repeated reads
of the same standard function return the same object; separate interpreters keep
separate objects and host contexts. Non-function factory results are not cached.

## Function call stack

### Memoized calls

`memo` shares the function AST and placement rules with `fun`. Each
`defineFunction` call creates a separate cache captured by that function's
execution closure. Neither prepared syntax nor an interpreter-wide registry
owns the cache. Escaping functions retain their caches; unreachable local
functions and their captured frames can be garbage-collected together.

The wrapper uses `mapResult` to store successful scalar results after the
ordinary call finishes. Suspended calls still run through `ExecutionStack`.
Memoized targets are not registered for direct tail-frame replacement, which
would bypass the cache writer. Ordinary functions retain their existing paths.
Scalar-only results keep mutable aliases and file ownership out of the cache.

`test/memo.test.ts` checks Fibonacci body counts, explicitly passed index
caches, closure isolation and escape, scalar key types, failures, tail-position
calls and recursion through 100,000 active calls.

Run `node benchmarks/memo.mjs` after building. It measures 1,000 Fibonacci
calls per sample: a fresh explicit index, a fresh local memoized function,
and a populated memo cache. Parsing is excluded; cold-cache samples create
a new cache on every outer call. All samples verify the result.

### Scheduling


`execution.ts` drives suspended execution tasks with an explicit stack. A child
expression or function call suspends its caller through `resume`; the driver
starts the child and later supplies its result or throws its error into the
caller. JavaScript generator delegation is only used for the small suspension
helper, so ordinary Rank recursion does not accumulate JavaScript call frames.
Non-tail recursion retains intermediate results and resumes them after return.
Eligible tail calls replace the current invocation instead of retaining its caller.

Frames still keep their lexical environments and resource scopes. Exceptions
unwind the execution stack through the same handlers as normal execution.
Closing a Rank generator unwinds all suspended tasks and completes its finally
blocks, including calls and yields during cleanup; cleanup yields are discarded.

The default limit is 200,000 active value-returning function calls per interpreter.
Hosts can set `InterpreterOptions.maxCallDepth` to a positive safe integer; imported
modules inherit the setting. Exceeding it raises the catchable `.RecursionLimit`
error and unwinds normally. Memory use remains proportional to the suspended
work, so the call limit is not a memory guarantee.

The synchronous host interfaces for lazy tensor cells and sequence iteration
remain a boundary: recursively forcing another lazy callback can still exhaust
the JavaScript stack. That failure is translated into `.RecursionLimit`. This
differs from ordinary Rank calls, including non-tail and mutual recursion, which
use the explicit execution stack. Scalar and whole-value `rank` calls also use it.

Regression tests cover a 100,000-level non-tail call and DFS on a chain of 100,000
vertices, operand ordering, mutual recursion, closures, imported functions,
generator resumption and cancellation, errors, and resource cleanup.

The initial explicit-stack change increased the runtime benchmark's median from
31.0 to 70.4 ms for `tree` and from 8.9 to 13.1 ms for `total`. Immediate evaluation
removes scheduling for completed work; compare it against the pre-stack runtime
using the same benchmark source and an optional interpreter module path.

## Resource scopes

Every function call still establishes a resource scope, including arithmetic
functions. Nested calls can transfer files into that scope. Empty scopes returning
scalar values skip the container traversal used to find escaping files; containers,
closures and sequences retain the full ownership traversal.

## Tail calls

A return whose final ordinary postfix application calls a value-returning Rank
function in the same interpreter can replace the current invocation. Parentheses,
mutual recursion and dynamically selected functions are supported. A self-tail call
can reuse an uncaptured frame with the same lexical parent, clearing its values and
inferred types before binding the new arguments. Other replacements get a fresh
frame, so closures keep the bindings from their original call. A directly evaluated
tail return avoids creating a suspended return task; complex expressions still
resume through the execution stack.
The call-depth budget counts active invocations, not tail replacements: a regression
test makes one million accumulator calls with `maxCallDepth: 1`.

Calls inside `try`, `catch`, `finally`, or iteration-bound `for ... in ...` bodies
retain their callers, preserving error handling and iterator cleanup order. Calls
also retain their callers while the current resource scope owns files. Conditional
loops and calls after a completed protected block can use tail replacement.
Native functions, generator targets, cross-interpreter calls and special application
forms such as `rank` keep their existing execution paths. Non-tail expressions such
as `return (N - 1) down + 1` still need a suspended caller.

## Verification and measurement

Run from the repository root:

```sh
npm test
npm run rank -- test demos
npm run build
node benchmarks/runtime.mjs
```

Build before running the benchmark. It covers non-tail and tail recursion, counted and conditional
loops, direct user-function calls, native calls, and array addressing. It parses
the functions once, warms them up, checks their results and reports the median of five runs.
Parsing and process startup are excluded. Timing is diagnostic, not a test
threshold.

To compare a separately built checkout with the same benchmark:

```sh
node benchmarks/runtime.mjs /path/to/checkout/packages/interpreter/out/index.js
```

Local medians in milliseconds, comparing the pre-stack commit `7fb9070` with
immediate evaluation on the same machine:

| Benchmark | Pre-stack | Immediate evaluation |
|---|---:|---:|
| `tree` | 31.5 | 37.9 |
| `total` | 9.1 | 7.9 |
| `calls` | 44.1 | 16.3 |
| `nativecalls` | 15.0 | 13.4 |
| `conditional` | 19.0 | 11.5 |
| `addressing` | 18.9 | 14.5 |

These measurements cover the named workloads, not every non-recursive program.

### Tail-call comparison, 2026-09-11

The same seven-scenario benchmark was run against baseline `ae2b235` and the
tail-call implementation on macOS arm64, Node v24.15.0 (V8 13.6.233.17-node.48).
Each number is a median of five runs in milliseconds, after warmup. Parsing and
process startup are excluded. The final comparison ran the tail-call version first;
an earlier comparison in the opposite order showed the same tail-call speedup.

| Benchmark | Before tail calls | Tail calls |
|---|---:|---:|
| `tree` | 38.1 | 37.9 |
| `total` | 8.1 | 8.1 |
| `calls` | 17.1 | 17.3 |
| `nativecalls` | 13.6 | 13.5 |
| `conditional` | 11.8 | 11.6 |
| `addressing` | 15.3 | 14.9 |
| `tail` (50,000 calls) | 92.5 | 51.1 |

The tail scenario was about 1.8 times faster. The other medians differed by less
than 3%, with overlapping run ranges; these checks found no measurable slowdown
in those workloads. This is a local comparison, not a guarantee for all programs.

### Call and local-slot comparison, 2026-09-11

Baseline `bfd28f0` and the call/local-slot changes ran the same expanded benchmark
on macOS arm64, Node v24.15.0 (V8 13.6.233.17-node.48). These are medians of five
runs in milliseconds after two warmups, with baseline first and no concurrent
test run. Earlier checks in reverse order showed the same direction of change.

| Benchmark | Baseline | Call/local-slot changes |
|---|---:|---:|
| `tree` | 38.1 | 35.2 |
| `total` | 8.0 | 7.7 |
| `calls` | 16.3 | 14.9 |
| `nativecalls` | 13.2 | 11.7 |
| `conditional` | 11.6 | 10.0 |
| `addressing` | 15.0 | 13.8 |
| `tail` | 51.0 | 22.2 |
| `dyadiccalls` | 20.5 | 17.6 |
| `tailacc` | 55.2 | 24.9 |

The two tail scenarios took about 2.2–2.3 times less time. Other improvements were
smaller; the counted summation was close to its baseline. The unchanged CSES Grid
Paths test file passed with both interpreters and took 4.44 versus 4.38 seconds in
single CLI runs including startup. That difference does not establish an improvement
for this real-world workload. Timings are diagnostic, not CI failure thresholds.

### Stable standard-function identity, 2026-09-11

The identity change replaces the call-only cache from `61695fc` with a per-interpreter
cache for every read of a standard-library function. This deliberately changes
`abs equal abs` from false to true. User-function and closure equality is unchanged.

The same nine benchmarks ran against separate builds on the same macOS arm64 /
Node v24.15.0 environment, baseline first, after the test runs had finished.
Medians of five runs in milliseconds:

| Benchmark | `61695fc` | Stable identity |
|---|---:|---:|
| `tree` | 35.5 | 36.3 |
| `total` | 7.7 | 7.7 |
| `calls` | 15.2 | 15.1 |
| `nativecalls` | 11.6 | 11.6 |
| `conditional` | 9.8 | 10.0 |
| `addressing` | 13.7 | 13.6 |
| `tail` | 21.3 | 21.8 |
| `dyadiccalls` | 17.8 | 18.1 |
| `tailacc` | 24.2 | 24.1 |

All median differences were below 2.5%, with overlapping sample ranges. This check
found no measurable slowdown in the named workloads. The full suite passed 250
tests, and all 102 demo test files passed.

### Memo functions and named indices: 2026-09-11

Compared with `53909b9` on darwin arm64, Node v24.15.0 and V8
13.6.233.17-node.48. These are medians of five samples in milliseconds:

| Benchmark | Before | Memo support |
|---|---:|---:|
| `tree` | 34.5 | 35.1 |
| `total` | 7.9 | 7.7 |
| `calls` | 15.0 | 14.8 |
| `nativecalls` | 12.0 | 11.5 |
| `conditional` | 10.0 | 9.9 |
| `addressing` | 13.6 | 13.4 |
| `tail` | 20.8 | 21.6 |
| `dyadiccalls` | 18.0 | 17.7 |
| `tailacc` | 23.8 | 24.1 |
| `indexwork` | 52.9 | 52.6 |

Repeating the ordinary-function comparison in both orders did not show a
consistent slowdown. The small differences are not a guarantee for other
workloads. `indexwork` adds 50,000 implicit index writes and reads to the
permanent runtime benchmark. Index tuple encoding now preserves boundaries
even when text keys contain separator-like strings.

The separate memo benchmark measured 1,000 `fib(30)` calls at 116.7 ms with
fresh explicit caches, 75.6 ms with fresh local memo functions, and about
0.1 ms with a populated memo cache. Fresh memoization was about 1.5 times
faster than the manual cache in this example; the populated-cache result
measures lookup, not Fibonacci calculation.

Validation passed 270 unit tests and all 103 demo test files. Body-count
tests assert 31 evaluated states for `fib(30)` with either cache mechanism,
so correctness does not depend on a timing threshold.

### Earlier measurements

On the development machine during this refactor, the recursive benchmark changed
from approximately 85 ms to 35 ms. The official sample for CSES Introductory
Problems 024 (`intro/024_gridpath`) returned 201 in approximately 5.2 seconds,
compared with 10.2 seconds before the refactor; the baseline was rechecked without
CPU profiling. These are local measurements, not performance guarantees. The
all-wildcard Grid Paths case did not complete within a 55-second check and remains
separate unfinished performance work.

The subsequent prepared-statement change reduced the recursive benchmark from
36 to 31 ms and the 50,000-iteration summation from 24.6 to 9.4 ms. All five
`intro/024_gridpath` tests, including the official sample, completed in
approximately 2.7 seconds.
These measurements use the same example algorithm; this change does not establish
completion or judge-time performance for the all-wildcard input.

Sparse index reads directly under `pad` return a private absence marker instead
of constructing a `MissingValueError`. The pad handler evaluates its fallback
only after that read reports absence. Other missing-value paths retain exception
handling, and errors in keys or fallback expressions keep their existing behavior.
The unchanged AoC 2015 day 6 test file, including its million-cell case, took
14.02 seconds before and 2.85 seconds after this change in local CLI measurements.

A subsequent timing audit of all 69 demo test files found MD5 mining, the light
grid, CSES grid paths and repeated look-and-say transformations to be the largest
costs. MD5's two official examples took about 4.7 seconds together. Compact byte
storage and table-based hexadecimal formatting reduced that to about 3.1 seconds.
The full demo timings summed to 15.9 seconds before and 13.3 seconds after; these
single-run totals include runtime variation and are not a performance guarantee.

`bytes.ts` shares compact binary storage between crypto and I/O. Scalar addressing
reads individual integer atoms; requesting `items` materializes and caches the
Rank array. Byte tensors cannot contain file handles, so ownership traversal skips
them. Binary formatting and writing continue to use the original byte buffer.
The test inputs and iteration counts remain unchanged.

## Compiled scalar expressions

`scalar-compiler.ts` emits JavaScript for compound arithmetic expressions with at
least two supported operations. It currently handles `+`, `-`, `*`, integer floor
division/modulo, integer comparisons and unary signs/not. Number arithmetic keeps
JavaScript/Rank floating-point order; mixed types and non-scalars delegate to the
reference operator with operands already evaluated. There is no retry of an
expression after partial execution, and no reassociation or common-subexpression
elimination of name reads.

Factories are weakly cached by AST identity. Local declarations bind new readers
and environments to the shared code, so separate closures never share values.
Literals and user names are not interpolated into generated JavaScript. Unsupported
syntax retains prepared handlers; browser CSP rejection also retains that path.

This stage compiles expression evaluation inside assignments, returns and loop
conditions. It does not compile loop control flow, calls, suspension or resource
ownership. `scalarCompilation: false` selects the old expression path, independently
of `tensorFusion`. `onScalarCompiled` reports generated code and `onScalarExecuted`
counts entries into compiled expressions, including entries that delegate operators.

See [compiler progress](compiler-progress.md) for measurements and current limits.

## Compiled command blocks

`block-compiler.ts` generates straight-line command dispatch with explicit command
positions. A completed command falls through to the next case. A fused tensor
group can jump over its eliminated assignments, and a suspended command returns
to the existing execution stack. Resumption re-enters the generated block at the
following command, retaining its result and execution context.

Each command handler is prepared lazily and retained in its own block slot.
Errors are attributed to the current command position. Return/break/continue
signals, finally handling, iterator cleanup and file ownership remain in the
existing execution machinery. Tests compare output, errors, suspension and file
closure with the original dispatcher. The generated template contains positions
only; command handlers and environments are bound per interpreter/block.

The initial implementation covers blocks of 2–64 commands; other block sizes and
CSP rejection retain the reference dispatcher. Scalar and tensor compilers are
independent options. `blockCompilation: false` selects reference block dispatch.
`onBlockExecuted` counts entries and resumptions; it should be disabled in timing
runs, since heavily suspending programs may enter millions of blocks.

This compiles block dispatch, including loop bodies. The `for` iterator and loop
control handler itself are not yet lowered into the generated block.
