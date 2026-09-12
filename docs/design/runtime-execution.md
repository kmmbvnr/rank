# Interpreter execution

The TypeScript interpreter is the reference implementation for developing Rank.
Its execution helpers must preserve the language's observable behavior, including
error timing, lexical capture, fixed inferred types and file ownership.

## Architectural direction

[Tensor fusion](tensor-fusion.md) is a core execution direction: compatible
operations should share a plan and traversal, including across private named
intermediates. Coverage will grow incrementally without changing observable Rank
semantics. Compiling loop control flow is independent of tensor fusion.

[Array revisions](array-revisions.md) describes demand-driven cache validation,
resource metadata and the measured tradeoff between reuse and write overhead.
[Runtime diagnostics](runtime-diagnostics.md) documents optional counters and
validated tensor readers in compiled loops.

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

## Preparing repeated loop-body execution

On the first actual iteration, a loop may bind its compiled body and an execution
context once, then reuse them for subsequent iterations. This removes a block-cache
lookup and context allocation per iteration. The binding belongs to a loop
invocation, not to the function AST, so recursive calls and suspended generators
retain separate contexts. Zero-iteration loops do not prepare their body.

Iterable loops continue to disable tail-call transfer from their body: the callee
must finish before the iterator closes. Conditional loops retain their surrounding
tail-call policy. Break/continue, condition evaluation, bindings and iteration still
use the existing loop handler. This is preparation of repeated body execution,
not full lowering of loop control. `loopPreparation: false` disables the reuse.

## Whole integer loops

`integer-loop.ts` lowers conditional, inline numeric-range and stored integer-vector
loops into JavaScript regions when the conditions and bodies are supported.
Inputs are guarded before execution; unsupported types or syntax retain the
reference loop. Register variables hold integer values between operations and
iterations. Scalar assignments commit immediately, retaining fixed-type checks,
lexical binding behavior and partial state if a later operation fails. The
invocation-bound writer optimization below avoids repeating known type checks. Errors carry the original body-command or loop-condition location.

The scope includes conditional and `to`/`until` range loops with at most 32 commands (including nested branches and loops),
integer arithmetic `+ - * // %`, powers with a nonnegative integer literal exponent,
comparisons and boolean conditions. Power preserves sign precedence and exact
bigint arithmetic. Guarded array reads/writes, containers and vector iteration are
described below. Dynamic or negative exponents, unsupported calls/selectors,
floating-point operations and other iterable loops retain the reference path.
Modifier spellings such as `scan` must not be mistaken for integer operands.
CSP rejection retains reference execution. `integerLoopCompilation: false`
disables this pass; compilation/execution callbacks support diagnostics.

Typed writes remain runtime calls; invocation-bound integer writers specialize
the checks as described below.

Numeric range lowering supports `by`, descending steps, an optional index binding
and `#` discard bindings. Start, end and step are evaluated once; progression uses
an internal cursor, independent of assignments to the visible loop variable.
Empty ranges do not bind variables. Zero-step and binding-type errors preserve
reference timing and locations. Unused ordinal counters are omitted. Named range
values and other sequence plans are not yet lowered by this pass.


Integer-loop lowering also supports `if`/`elif`/`else`, including nested branches.
Only selected conditions and bodies execute. Definite assignments after a branch
are the intersection of all outgoing paths; other reads require an initial
integer guard or decline compilation. Branch-local writes still use checked
writers, and errors point to the original nested statement. An empty selected
branch retains the reference result (`undefined`). General calls and suspension remain on the reference path.


### Guarded containers in integer loops

The loop compiler accepts stable named `RankDeque` receivers (queue, deque or
stack) for `push`, `len` and `pop`, and stable named indexes for integer-key
membership and plain integer-value indexed assignment, including multiple keys.
Mutations call the existing container methods and resource-aware index map;
queue/stack order, empty-pop errors and partial mutations retain runtime behavior.

Before execution, receiver kinds are checked. Any deque used by `pop` must
contain only integers, verified by one read-only traversal per loop invocation.
The compiled region can only push integers, so this property survives aliases
between its deque receivers. Mixed containers fall back before any pop or write.
Container rebinding anywhere in the region, even in just one branch, declines.

`even`/`odd`, deque `len` and `pop` require their actual standard-library bindings.
Shadowing or reassignment of those names prevents specialization. Missing modules
retain reference execution and its error timing. Index reads, compound index
writes, other receiver classes and arbitrary calls are not yet lowered.


## Compiled function completion

For nongenerator functions ending in a value-returning `return`, the runtime can
compile a 1–64-command function body using the resumable block compiler. Its
terminal return hands a value to the existing function-call frame directly,
avoiding a `ReturnSignal` throw/catch on ordinary completion. Early returns and
other control signals still use their existing paths. Unsupported body shapes
or unavailable code generation keep reference execution.

Preparation stays lazy, and suspended expressions resume at the same command
position. A terminal application retains tail-call handling. Tensor groups that
span the terminal return, or start at that return itself, retain their kernels.
Those kernels may still use the existing return signal. Single direct arithmetic
returns retain their earlier direct-call path.

Lexical frames, call-depth accounting, memoization and resource cleanup remain
owned by the existing call machinery. This stage does not yet compile whole
function arithmetic into one typed kernel or hoist integer-loop entry guards.
It removes a function-completion cost shared by many programs.

`functionBodyCompilation: false` disables this stage independently of ordinary
block compilation. `onFunctionBodyCompiled` exposes generated dispatch source;
`onFunctionBodyExecuted` counts block entries, including continuation re-entry,
not necessarily one event per function call. Options propagate to loaded modules
and test interpreters.


## Direct scalar iteration

Plain scalar iteration now enters `iterationValues` directly instead of wrapping
each value in a `ForEntry` object and allocating an index array. Binding validation
and type declarations run once through a shared preparation method. A private
ordinal is maintained only when an index binding is actually used, including
when the visible index variable is reassigned by the body.

This covers ordinary arrays of rank zero/one, text, sequences and supported
scalar collections. It preserves their existing iterators and mutation semantics.
The `for...of` boundary still closes an iterator on break, return or error, and a
return callee finishes before that close. Unicode iteration retains code-point
semantics. Explicit `axis`/`rank`, matrix row iteration and object-key iteration
retain `forEntries`; this change does not redefine tensor traversal or force new
materialization behavior.

`directIteration: false` keeps the wrapper path for comparison. The option
propagates to imported modules and test interpreters. This removes runtime
iteration overhead beneath compiled blocks; it is not whole-loop arithmetic
compilation.


## Compiled tensor cell copying

For array-valued cells in tensor iteration, `tensor-cell-compiler.ts` specializes
the coordinate decoder and linear offset expression for the source rank and
cell axes. It does not specialize dimensions, element types or values. Kernels
are shared by rank/axis routing; each cell still receives a new items array.
Frame order, shared cell-shape behavior and ordinary binding checks are unchanged.

Storage and source shape are read in the same order for every atom. A changed
coordinate rank declines before touching storage. A shared cell shape resized
during copying uses the ordinary dynamic coordinate path inside the kernel,
without replaying reads. Host getter failures retain their location and timing.
Ranks above 16 and unavailable code generation retain the reference copy loop.

Scalar `rank 0` cells keep the reference path: the isolated copy call did not
improve their benchmark. Their next optimization should include the surrounding
traversal and body rather than adding a kernel boundary around a single read.
`tensorCellCompilation: false` disables cell-copy compilation; the option
propagates to loaded modules and test interpreters.


## Compiled loop-control edges

The integer-loop compiler lowers `break` and `continue` to JavaScript control
edges, including within `if`/`elif`/`else`. Bare `for` loops can also compile.
The body result is committed only after an iteration completes: a break or
continue retains the preceding completed iteration's result while preserving all
writes already made by the interrupted body. Range cursors and ordinals advance
normally on continue and stop on break.

Definite-assignment merging considers only branches that reach the next command.
Commands following unconditional control are not prepared. The compiler can also
handle a loop without any register variables. Control inside `finally` declines
before execution so the ordinary path retains its validation and exact diagnostic.
Nested numeric loops can compile as one region with shared integer registers.
Each range captures its bounds and stride on entry and maintains an independent
cursor. Break and continue target the nearest loop; each loop retains its own
last completed result. Assignments made only inside a possibly empty inner loop
are not considered definite after it. Unsupported inner constructs retain the
reference outer loop, with eligible inner loops compiled independently.
`nestedLoopCompilation: false` disables only region nesting for comparisons.

## Array reads inside compiled numeric loops

The integer compiler can read a stable named integer array with a complete scalar
address, including matrix and higher-dimensional coordinates. Parenthesized index
expressions remain separate operands. It calls the existing checked array reader,
so negative and out-of-bounds indices retain their diagnostics and source locations.

Entry guards accept only already materialized integer atoms and the exact number
of indices for the receiver rank. They do not force lazy readers. Partial addresses,
unsupported cell types and unsupported receiver rebindings retain ordinary execution. Full-address writes and integer compound assignments are supported as described
below. `arrayLoopCompilation: false` disables these
reads while leaving the preceding integer compiler enabled.

The current type guard scans the materialized atoms on each region entry. This
cost can dominate a short loop over a large array. Future storage type summaries
must track mutation correctly before this scan can be safely cached or hoisted.


## Array writes inside compiled numeric loops

`A I = Value` and integer compound assignments can join a region, including full matrix
addresses. The receiver is guarded as a stored integer array with matching rank;
unsupported rebindings, lazy destinations and partial or collection selectors retain
ordinary execution. The existing indexed-container path remains available through the same
statement syntax, selected by receiver kind.

The compiler evaluates coordinates and validates the array selection before the
right operand, then writes immediately. Full scalar addresses use the checked offset helper described below, retaining
tensor selection's bounds diagnostics. Aliases see earlier writes, including on a later error or
break. An array assignment contributes its right operand to the statement result;
an index assignment still contributes no result. `arrayWriteCompilation: false`
disables array writes while retaining array reads and existing index writes.

## Compiled iteration over stored vectors

`for Value i in A` can join a numeric region when A is a stable named,
already-materialized integer vector. The optional ordinal and `#` discards retain
their existing meaning. The compiler uses the normal loop-type declaration before
iteration, including checking the ordinal's type for an empty vector.

A native for-of loop advances independently of assignments to the visible binder.
It reads the live items, so writes to later cells through aliases remain visible.
Array and numeric-range loops can nest in the same region. Matrix-row iteration,
heterogeneous or unevaluated lazy inputs, and unsupported receiver rebindings retain
reference execution. `arrayIterationCompilation: false` disables this lowering while keeping
preceding numeric-range and array read/write optimizations enabled.


## Compiled compound array writes

Stored integer arrays support `+=`, `-=`, `*=`, `//=` and `%=` in compiled regions.
The compiler validates coordinates first, evaluates the right operand once, reads
the current element and then writes the result. The statement result remains the
right operand, as in ordinary Rank execution. Signed floor division and modulo
preserve their existing rules; division by zero keeps all prior writes and reports
the original statement. Aliased reads observe mutations immediately.

Compound index updates, partial selectors and other element types retain ordinary
execution. `compoundArrayCompilation: false` disables only compound array writes;
plain writes, array iteration and reads remain available.

## Integer extrema inside compiled loops

Builtin `min` and `max` with integer operands lower to comparisons within a region.
The compiler reuses the ordinary infix-chain normalization, including parentheses
and addressed operands, and supports binary postfix calls and scalar unary extrema.
Guards require the original numbers-module function identity on every region entry;
shadowed functions or other operand types retain ordinary execution.

Malformed chains decline compilation so skipped bodies keep their error timing.
The compiler evaluates operands in order, retains exact BigInt values and uses the
left operand on ties. `extremaLoopCompilation: false` disables only this lowering.


## Scalar write-address lowering

Compiled full-cell writes compute their row-major offset directly in
`scalarArrayWriteOffset`. The region guards already establish the receiver rank
and integer coordinates. The helper checks each axis in order, comparing bounds
in BigInt space, and computes the offset without selector objects, closures or an
output-shape plan. Validation still happens before the right operand.

General slices keep tensor selection. `scalarAddressCompilation: false` routes
compiled writes through the prior tensor-selection helper for differential tests
and benchmarks; the same numeric region still compiles in both modes.


## Invocation-bound integer writers

Synchronous integer regions prepare temporary writers for their scalar assignments
and loop bindings. Each site's first actual write uses the ordinary checked writer.
Only after that succeeds does the site bind a direct store to the owning frame slot
or mapped capture; global writes retain the resource-aware variable map. Skipped
assignments are not checked early, and later failures keep earlier mutations.

These writers exist only for one region invocation. They never cache a previous
call's frame in the compiled AST, and they are recreated for recursion or another
function call. Captured frames retain their mapped-value representation. This relies
on the region's integer guards and absence of arbitrary user calls or suspension;
it is not an unchecked writer for general execution. `boundIntegerWrites: false`
keeps the original per-assignment checks for comparisons.


## Boolean locals in numeric regions

Numeric regions can store known boolean values from literals and comparisons,
combine them with `and=`, `or=` and `xor=`, and use them in conditions or boolean
equality tests. Incoming named conditions receive boolean guards. Local register
types remain consistent throughout the region; conflicting types decline compilation
and retain ordinary error timing. Checked first writes still establish Rank's fixed
variable type before bound stores can specialize later writes.

Operands retain ordinary evaluation order, including eager evaluation of boolean
compound-assignment operands. Known boolean array cells are supported as described below; general inference
for unknown input aliases remains future work.
`booleanLoopCompilation: false` disables boolean local lowering while retaining
existing integer operations and literal/comparison conditions.


## Boolean array cells in numeric regions

Array plans can require boolean cells, inferred from conditions, known array uses,
boolean assignment operands and `and=`/`or=`/`xor=`. The same scalar address and
immediate-write machinery handles homogeneous stored boolean arrays. Entry guards
check the expected element type for every read and write view, so incompatible
alias expectations or mixed cells decline before execution.

Full matrix addresses, alias-visible writes, bounds errors and eager boolean RHS
evaluation retain ordinary semantics. Lazy inputs still do not get forced by the
guards. Vector-loop binding remains integer-only; boolean vector iteration and
unknown input-alias inference need further compiler work. Plain scalar index writes
can also carry boolean results; compound index updates still retain the reference
path. `booleanArrayCompilation: false` disables boolean-cell lowering only.


## Array allocation and rebinding in numeric regions

`array shape ... pad ...` with integer dimensions and integer/boolean fill can be
created inside a compiled region. Each execution allocates a fresh array. Dimensions
are evaluated and checked in order using the same helper as ordinary execution;
then the fill is evaluated, storage allocated and the assignment committed.
Known array aliases and rebinding to these arrays preserve reference identity.

The compiler keeps rank and cell type consistent for each array binding; dimensions
may vary. Definite assignment distinguishes local arrays from guarded inputs, so a
conditionally created array cannot be read without the ordinary checks. Full-cell
writes must still match the known rank. Partial selections and rank/type changes
retain reference execution.

Write requirements propagate backward through alias edges to input guards. Thus a
cached lazy source cannot become writable by assigning it to another name. Array
assignments use checked first writes, and temporary bound stores do not retain old
invocation frames. General array expressions, unknown aliases and unsupported
allocation forms still fall back. `arrayLocalCompilation: false` disables these
array definitions and aliases while retaining earlier compiler stages.

## Return from compiled loops

A supported scalar expression or known array binding can be returned directly from
inside a compiled loop, including nested loops. Generated code raises the existing
ReturnSignal after evaluating the value. Ordinary function completion and enclosing
finally/resource handling therefore remain in charge. Unreachable commands after
an unconditional return are not compiled, and assignment merging considers only
branches that continue.

Top-level returns, returns inside finally, generator returns and valueless returns
retain reference validation before evaluating the expression. Unsupported function
calls in return expressions still fall back, retaining tail-call behavior.
`loopReturnCompilation: false` disables this control edge only.


### Reusing proven iteration types

Compiled integer vector loops reuse the element type established by region entry
validation or a typed local allocation. The ordinary loop driver still validates
binding names and fixed variable types, but does not traverse the vector again to
collect a type set. Empty vectors contribute no element type; their ordinal binding
still has integer type. The original iterator and live array semantics are retained.
This proof is local to a synchronous compiled region with typed writes, not a cache
of arbitrary mutable arrays. `provenIterationTypes: false` restores type collection
for differential benchmarks; ordinary interpreted loops are unchanged.


### Integer absolute values inside regions

The compiler lowers the standard numeric `abs` applied to a proven integer into
an exact BigInt sign test. Operands are evaluated once, including destructive
container reads. Entry guards verify the standard function identity and input
types before any writes. Shadowed functions, missing imports and noninteger
inputs retain reference execution. `absoluteLoopCompilation: false` disables
this lowering independently for benchmarks.

### Text loop specialization

Named text inputs can now specialize a loop region alongside integer and boolean
locals and numeric arrays. The existing text iterator supplies Unicode code points
and ordinal indices; empty text still declares text/integer binding types. Text
literals, assignment, equality/inequality and returns are supported in these
regions. Concatenation, text indexing and arbitrary text function calls are not
yet lowered by this pass. Text-vector iteration is described below.

The numeric plan remains the first path. If its guards decline before execution,
the dispatcher observes which named iterable inputs are strings and builds a
variant for that signature. At most eight variants (including declined signatures)
are cached per loop. Only generated plans and type signatures are retained, never
input values or invocation frames. Each plan guards required input types before
executing and uses checked writes. Unsupported signatures use reference execution.
A string source assigned only inside the region may still lack an entry-time type
proof and fall back. `textLoopCompilation: false` disables this stage independently.


### Text vectors feeding nested character loops

A materialized one-dimensional array of strings can now supply text bindings to
nested compiled loops. Signature selection inspects the first element only to
choose a candidate; the region guard checks every element before execution.
Unknown lazy readers are not forced. The proven element type passes into ordinary
binding validation, avoiding a second type scan. Nested loops can use text types
inferred from an enclosing binding, rather than requiring an entry-time variable.

Mixed arrays decline before writes. Empty vectors retain ordinary behavior when
no element type can be inferred. Text-array mutation and creation are not yet
lowered. `textArrayLoopCompilation: false` disables the text-vector specialization
while keeping scalar text loops available.

### Direct text iteration in compiled regions

Compiled text loops can use JavaScript's string iterator directly after the usual
binding checks. Both it and the previous code-point array preserve Unicode code
points (including lone surrogates); immutable strings preserve the source when its
variable is reassigned. An early exit no longer needs to allocate an array for the
unvisited suffix. Interpreted loops keep their existing iterator path.
`directTextIteration: false` restores code-point array construction for comparison.

### Scalar text conversion and length

The compiler can lower standard `text` on a proven integer and standard `len` on
known text or array values. Native identity guards preserve shadowing and missing
imports. Integer rendering uses exact decimal BigInt text. Its expression carries
an ASCII proof, so a following `len` can read the string length without creating a
code-point array. Arbitrary text retains Unicode code-point counting; local aliases
currently do not propagate the ASCII proof. Known array length reads the current
first shape dimension, including after a local reallocation. Unknown collection
receivers keep their previous guarded or reference paths.
`scalarTextCompilation: false` disables these lowerings for comparison.

### Text digits inside tensor expression plans

Tensor plans can now include standard integer-to-text conversion and standard
`integer rank 0` applied to digit text. The binder verifies native identities and
ASCII digits, then presents the string as a one-dimensional integer source. The
emitter reads each digit directly while applying maps and reduction, without
materializing the converted or mapped vectors. Literal and named text inputs are
supported; exact BigInt rendering preserves integers above the Number safe range.
Empty text preserves empty-reduction behavior. Signs, whitespace (including a
trailing newline), non-ASCII input, overrides and escaping intermediates retain
the reference path and its errors. `tensorTextDigits: false` disables this stage.

The surrounding user-function call still uses the existing function machinery;
this extends the composable tensor IR rather than compiling arbitrary calls inside
numeric loop regions.

### Proven scalar user calls from loop regions

A compiled loop may call a user function whose body is one return expression
containing only integer parameters, integer/boolean literals, supported arithmetic,
comparisons and boolean operators. A syntax proof establishes an integer or boolean
result and excludes effects on caller state. Arguments must be proven integers.
External names, nested calls, memo/generator functions and other bodies decline.
This is a conservative proof, not the language's complete purity analysis.

Entry binding checks the active function definition against the proved AST and
retains the actual closure only for that region invocation. Cached plans retain
AST metadata, not invocation frames. Calls continue through the ordinary function
machinery, preserving lexical/resource scopes, fixed parameter types, diagnostics
and call-depth limits. No inlining is performed. A changed definition falls back
before any region writes. `scalarCallCompilation: false` disables this stage.

### Scalar function blocks and closure-write guards

The scalar-call proof also accepts local assignments (including supported compound
updates), parameter updates, if/elif/else branches and early returns. Reads must be
defined on every continuing path, assigned names must keep one type, and all return
paths must agree on integer or boolean output. Loops, nested calls and other syntax
still decline. Unreachable trailing syntax is rejected as well, because local
function declarations can be hoisted before execution.

A name written by a nested helper is not automatically private: Rank may resolve it
to an existing closure binding. Entry guards therefore reject an existing captured
assignment target. The compiler also rejects conflicts with names the enclosing
region can write, even if those names have no value at entry yet. Global functions
without a closure context may reuse caller-local names; the context kind is guarded
on entry too. Function execution remains on the ordinary call path. The
`scalarBlockCalls: false` switch retains the preceding single-return proof only.

### Tail position across compiled loops

A returned proven user call now receives the same tail-call context as reference
execution. Conditional loops preserve it; entering an iterable loop disables it,
and enclosing handlers/finally can disable it through the execution context.
Arithmetic or another operation after the call is not tail position. Eligible calls
to functions owned by the same interpreter throw the ordinary TailCallSignal so the
function driver transfers control without adding a call-depth level. Cross-interpreter
calls keep ordinary invocation. Prior writes and source locations are preserved.

This fixes a compiler discrepancy: with maxCallDepth 1, a function returning a
helper call from a conditional loop previously failed while reference execution
succeeded. It is a correctness requirement, independent of performance on short
loops that exit on their first iteration.

### Generated bodies for proven scalar functions

Ordinary calls from compiled regions can now execute a generated body for functions
accepted by the scalar-call proof. The emitter uses private JavaScript slots for
parameters and locals, exact BigInt operations, eager boolean operands, branches
and explicit returns. Duplicate parameter names retain the existing last-binding
behavior. Generated code has no access to the lexical environment.

The existing definition/context/collision and argument-type guards still apply.
The owning interpreter checks and restores logical call depth, and errors are
located at the original callee statements, including imported modules. No separate
Rank frame or resource scope is needed for this proved subset: it cannot access
external state, call other functions, receive files or return non-scalar resources.
The code cache retains AST metadata only. CSP failure retains ordinary execution.

Eligible tail calls still use TailCallSignal and the ordinary function driver.
The signal can carry the proven scalar body, which the driver runs at its current
logical depth without constructing a callee frame. The caller's resource scope
remains active during the calculation and finishes after its result or error.
Cross-interpreter calls retain ordinary invocation semantics.

`compiledScalarTailCalls: false` keeps tail transfers on the preceding path.
`scalarFunctionCompilation: false` disables generated bodies for both normal and
tail calls. `onScalarFunctionExecuted` counts actual generated callee executions
independently of compiled outer-loop entries.

### Scalar compilation at ordinary function entry

The same proven scalar bodies are now available through ordinary function calls,
including callbacks used by rank application. At declaration time the interpreter
prepares a candidate; every invocation checks exact arity, BigInt arguments and
absence of captured bindings for assigned local names. Closure checks repeat on
every call because an enclosing scope can create such a binding after declaration.
Rejected guards use the existing function path, without executing/replaying effects.

The memo wrapper remains outside dispatch, so cache hits do not execute a kernel.
Generators keep their existing path. The owning interpreter still manages call
depth and callee error locations; proof restrictions exclude resource operations.
Zero-parameter and duplicate-parameter behavior is preserved. Non-integer calls,
including array broadcasting, retain ordinary evaluation. Tail-frame replacement
continues through its dedicated driver; ordinary entry does not intercept it.

`scalarEntryCompilation: false` disables this entry dispatch while keeping earlier
compiled-loop calls available. `scalarFunctionCompilation: false` disables the
underlying scalar bodies for both entry and compiled-loop dispatch.
