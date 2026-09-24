# Diagnostics and optimization plan

Status: proposed implementation sequence, based on the implementation on
2026-09-23. This plan does not introduce syntax or change runtime semantics.

Stages 0–1 are complete for the supported array-value diagnostic scope: fresh
bindings, direct aliases, rebinding, branch joins and proven indexed writes.
Unknown calls, nested references and host-owned storage still fall back to
unknown facts. This is not an ownership proof for the compiler.

Stage 2 has started with return-origin summaries. They distinguish an input-free
result from a returned parameter or capture, including straight-line local
aliases and supported helper returns. Branches join conservatively. Helper
captures and unsupported indirection remain unknown. A path that reaches the
end without `return` throws and adds no result type. The diagnostic pass stops
after a direct call to a non-generator function with no `return` outside
`try/catch`. Its effect summary remains unknown in other contexts, including
conditional calls. Generator calls have a sequence result; literal
`yield` expressions, stable parameters and straight-line local literal or
parameter aliases can supply possible element types.
The REPL now infers a direct top-level call's result from eager value arguments
before invalidating caller facts for the call. It does not snapshot arguments
that themselves call functions, or do this inside another call analysis.
Loop analysis no longer scans the entire `for` as a call before walking its
body: the loop variable was mistaken for an unknown function and erased input
facts. With a literal integer array, the unchanged CSES `max_subarray` function
now has an integer result, and the REPL reports an incompatible later `+`.
Unknown calls inside the loop still invalidate facts. This is a diagnostic
gain, not an effect summary or compiler optimization for that function.
The analyzer reports proven mixed yielded types, including at a call where
argument types settle the question. It does not add a runtime type check.
An unknown yielded value leaves the element type unknown. The effect summary
now tracks direct numeric indexed reads through
resolved helpers and private eager literal arrays. Diagnostics retain unrelated
facts across those reads only when array cells cannot invoke lazy code; lazy or
unknown arrays keep the conservative boundary. Runtime borrowing does not
consume these summaries yet.
The summary also treats a direct write to a private literal array created in
the function's initial straight-line assignment prefix as local. If the written
value may contain an argument or capture, the returned array's origin remains
unknown. A resolved helper's indexed write is also local when its argument is
such a private array and the helper does not read that parameter. Known cell
types are dropped after the call. Input aliases and captured writes through
helpers still need separate proofs. Direct single-cell
replacements with scalar literals also retain the eager-reader fact for a later indexed
read of that private array.
The summary also distinguishes captured value reads from indexed reads and
marks direct and transitive `stdin` and catalogued I/O operations. Because
host callbacks may re-enter Rank, diagnostics still invalidate value facts
across those calls. Direct operations marked as I/O, random or mutating also
invalidate unrelated facts unless a narrower rule proves them safe.
Top-level captured reads and indexed writes now retain their global binding
through a helper call even when its caller has an equally named parameter.
A direct nested helper can also map an indexed read or write of its parent's
unrebound parameter back to that parameter. Indexed reads of parameters
rebound before a helper call, and captures without a stable lexical path
still fall back to unknown. Reader chains through
two nested frames can use a parent's private eager scalar-literal array when
that binding is neither replaced nor written.
A direct nested helper can also replace its parent's parameter or a local
binding created in the parent's initial straight-line assignment prefix. This
is separate from an indexed array write. Diagnostics discard that binding's
old value facts while retaining unrelated shapes; return-origin analysis no
longer trusts the old local value. Conditional or later enclosing assignments
remain unknown.
A grandchild helper can pass a binding replacement through one straight-line
intermediate function when the outer binding was created in that prefix and
the intermediate function cannot bind the same name. Shadowing or control flow
in the intermediate function still makes this effect unknown.
Functions with repeated parameter names keep unknown effect and borrow proofs.

Stage 3 has a first, separate flat-array borrow candidate check. It accepts
direct numeric reads, parameter-indexed reads guarded by bigint arguments,
bigint arithmetic (`+`, `-`, `*`, `//`, `%`) in selectors and chains of resolved reader helpers
that pass those guards through. A straight-line local assignment can carry a
bigint selector proof to a later read, or hold a proven non-escaping read
expression for a later return or scalar expression. This includes results of
resolved reader helpers. A discarded scalar cell read is also accepted.
An `if` whose condition is a boolean parameter can also join read-only
branches. The call checks that parameter's type, including when a resolved
helper forwards it.
Assignments to local scalar results or selectors inside those branches are
accepted when every path proves the value needed after the `if`. Selector
parameter guards from all paths are combined. A path with an escaping array
value fails the proof. A counted `for I in Start until End` can also borrow
when both bounds are proven integers and the body only reads scalar cells or
updates proven scalar locals. The loop's possible zero-iteration path is joined
with its body facts. Dynamic iteration, array writes, escaping values and
callbacks still use ordinary CoW binding.
Returns, aliases, writes, callbacks and unsupported statements fail the check.
The interpreter now uses this result when the argument is an owned, stable,
one-dimensional scalar array and every helper still resolves to the same
lexical frame. Other calls use ordinary CoW binding.

Both direct and helper borrowing now use the same conservative check. A bare
array used in arithmetic, such as `return X * 2`, is not a borrow candidate:
its result may depend on `X` after the call. The current demo profile is in
[CoW demo results](../../benchmarks/cow-demos-results.md). Gradient descent
and Adam have no measured CoW copies at the sampled sizes; K-means has one.
These observations do not establish an elapsed-time improvement.
The K-means copy begins on the second iteration and an isolated copy costs
far less than the full call. Do not extend liveness analysis for this case
without a workload where copies account for meaningful time. CPU samples
point to derived-array allocation and garbage collection in K-means, but to
per-cell reader paths in gradient descent and Adam. Treat these as separate
leads; neither justifies a representation change without a before/after demo
measurement.

A first stage-5 compiler use now keeps a cached tensor reader across calls to
functions already proved scalar-only by `scalarFunctionResult`, and across
synchronous builtins registered in `loopBuiltins`. Callable identity and module
availability are checked at region entry; external MD5 additionally needs its
explicit pure-host contract. Unknown calls still disable this reader path.
On Apple M5 / Node v24.15.0, `node benchmarks/tensor-read-helper.mjs scalar`
measured 5.76 ms with read hoisting off and 3.64 ms with it on; the `builtin`
mode measured 5.87 ms and 3.35 ms. Each result is the median of nine
alternating warm calls over 100,000 iterations. The runtime recorded one
hoisted reader only with hoisting on.
This is a targeted microbenchmark, not a measured improvement in an existing
demo. Broader compiler use and the stage-5 differential gate remain open.

A guarded range-reader trial removed per-cell bounds checks for `A I` inside
`for I in 0 until N` when entry guards proved `N <= A shape 0`. It passed
compiled/interpreted result, error-order and partial-write tests. An isolated
warm comparison on Apple M5 / Node v24.15.0 used parentheses around `I` to
disable only the draft range proof. At 200,000 cells the medians were 6.43 ms
with the proof and 6.37 ms with checked reads. Across three runs of one million
cells, the proof measured 33.48, 33.28 and 33.28 ms; checked reads measured
33.70, 33.55 and 33.34 ms. Each run used nine alternating samples. The
improvement was too small to justify the guard and its semantic risk, so the
range-reader code was removed. Bounds checks remain in the compiler.

Compiled loops now reuse a successful input-cell type check when the same
array has a tracked, unchanged storage revision. A changed revision forces a
new scan. Host-owned arrays without a revision use the interpreted path:
scanning their cells at region entry could invoke a getter for a cell the loop
would never read.

Fused reductions and tensor kernels also decline host-owned arrays before
inspecting their cells. A JavaScript Proxy can make such reads observable.
Tracked Rank arrays still use these paths; tests cover both cases.

`node benchmarks/loop-element-guard.mjs 200000 200` measured 1.51 ms for 200
warm calls reading one cell from the same owned array, with one cell-type scan
across 203 calls including warmups. Before this cache, a separate run of the
same case took 184.33 ms and scanned at every entry. These are separate runs,
not an alternating comparison. The result applies to repeated calls on stable
large arrays. On the unchanged CSES Maximum Subarray Sum demo,
`node benchmarks/loop-guard-demo.mjs 20000 100` measured 49.42 ms per batch
when 100 calls reused one input array, and 58.84 ms when each call received
a different prebuilt array (medians of nine alternating batches, Apple M5 /
Node v24.15.0). The first case made no element-type scans during timed
batches; the second made 100 per batch. Input identity and storage locality
also differ, so this is a scenario comparison, not an isolated speedup
attributable to the cache.

A compiled loop with a shared array destination used to copy that array at
region entry even when the loop had no iterations. The entry check now sends
a proven empty numeric range or empty array iteration to the interpreter
before that copy. It also sends a proven zero range step back, preserving the
error without copying. Existing nonempty shared-array loops still compile.
This does not defer CoW until the first actual write: a nonempty loop whose
conditional body skips every write can still make an unnecessary copy.
The entry path now checks storage and cell types for every destination before
copying any shared destination. If a later destination fails its guard, the
interpreter resumes with no speculative CoW copy. Tests cover one and two
destinations with a skipped write; this is a fallback-correctness change, not
a measured speedup.

## Goal and rules

Give the REPL useful type and shape errors before execution. Reuse the analysis
in execution only when a transformation has all the proofs it needs.

- A binding's accepted types differ from the type of its current value.
- An array binding keeps its rank; axis lengths may change.
- Element types, dimensions, numeric ranges and storage representation are
  separate facts. A known integer type does not prove machine-integer bounds.
- Arrays have value semantics with copy-on-write (CoW). Shared backing storage
  does not imply that writing one Rank variable changes another variable.
- Tests provide examples, not universal function contracts. They never justify
  removing a check and never execute as part of editing.
- Unknown facts mean “keep the runtime check,” not “reject the program.”
- Editing must not execute functions, force lazy cells or perform user I/O.
- Preserve errors, their order and locations, prior visible writes, resource
  lifetime, integer precision and floating-point evaluation order.

## What exists today

| Component | Implemented scope | Boundary |
| --- | --- | --- |
| Language value facts and diagnostics | Types, element types, rank, partial shapes, selected operations, call-site inference, branch joins and simple loops; safe single-cell writes retain possible element types | Unsupported paths remain unknown; not a whole-program proof |
| Shared REPL diagnostics | Metadata snapshots, edit invalidation, same-file and host-loaded `_test.ra` examples | No test execution or array-cell inspection; browser companion loading needs a host |
| Diagnostic function effects | Possible indexed writes, numeric reads, captured value reads and catalogued I/O through supported helper calls | Reader facts require proven eager scalar cells; no escape analysis |
| Integer-loop compiler | Uses `expressionFacts` for specialization hints and checks inputs on entry; unchanged tracked array storage reuses its element-type check; scalar-only callees and guarded synchronous builtins keep cached tensor readers stable | Untracked host arrays use the interpreter; does not consume the new diagnostic effect summary as a safety proof |
| Runtime parameter borrowing | Direct readers and guarded flat-array helper chains, including bigint selector parameters | Aliases, nested values and unknown calls use ordinary CoW binding |
| Flat-array borrow candidates | Direct numeric or guarded parameter reads through resolved helpers, including scalar locals joined across read-only `if` branches and counted reader loops | Runtime checks flat scalar storage, selector types and current helper identities before use |
| Array ownership/storage | CoW, conservative shared flags, revisions and guarded reader/writer paths | Shared flags are not exact live reference counts |
| Host purity | `pureHostFunction` marks an exact implementation with a trusted contract | No inferred guarantee for arbitrary external handlers |

Implementation references:
[value diagnostics](value-diagnostics.md),
[prepared functions](../../packages/interpreter/src/prepared-function.ts),
[flat-array borrow candidates](../../packages/language/src/analysis/flat-array-borrow.ts),
[integer loops](../../packages/interpreter/src/integer-loop.ts),
[array storage](../../packages/interpreter/src/array-storage.ts),
[host effects](../../packages/interpreter/src/host-effects.ts).
The accepted [borrow/in-place ADR](../adr/implementation/0004-perceus-borrow-inference-and-compile-time-in-place.md)
states the direction; it is not evidence that every lowering it describes exists.

## What remains

This is the working backlog, not a claim that the accepted ADRs are fully
implemented. Type and rank diagnostics already run before execution in the
REPL and editor. Array bindings keep their rank while axis lengths may change.
Unknown cases still need runtime checks. The stages below extend that baseline:

1. **Complete function result and effect summaries (stage 2).** Return origins
   and some parameter/capture writes are known. Distinguish local writes from
   captured or reachable writes, reads of mutable captures, I/O and transitive
   helper effects. Map summaries to the actual call and binding; recursion,
   dynamic callbacks and unsupported calls remain conservative.
2. **Prove non-escape and broaden inferred borrowing (stages 3–4).** The current
   runtime borrows only guarded flat scalar arrays read directly or through a
   narrow helper chain. Cover more reader patterns only after proving no write
   and no escape through a return, closure, generator or retained container.
   Test repeated arguments and helper replacement. Keep ordinary CoW binding
   whenever the proof fails. Measure copy savings and elapsed time separately;
   the current demo profile does not justify broad liveness work for CoW alone.
3. **Use stable proofs in compiled regions (stage 5).** Remove repeated type or
   element checks and generic array dispatch only where guards and effect
   boundaries make that safe. Bounds-check removal needs its own index-range and
   stable-shape proof. Differential tests must preserve error order and writes.
4. **Extend edit-time diagnostics (stage 6).** Add supported `is` narrowing,
   loop fixed points, reachable `break`/`continue`/return paths, result-shape
   relationships and missing operation rules. Function tests remain examples,
   never universal type contracts or compiler proofs.
5. **Consider buffer reuse and in-place lowering only for measured bottlenecks
   (stage 7).** Prove last use and absence of observers before reusing storage;
   retain CoW as the fallback. The Roc/Koka/Perceus-style implementation idea
   does not add Rust-style ownership annotations or move errors to Rank.

The [proposed step-mode CoW display](repl-input.md#proposed-cow-display-during-stepping)
is a separate observability task. Runtime copy counters exist, but `Ctrl-R`
does not yet show the copies made by each committed step. An edit-time CoW hint
would be a prediction, not the same thing as this runtime measurement.

## Shared analysis, separate consumers

Keep facts and transfer rules in the language package. The REPL supplies copied
runtime metadata; the interpreter supplies execution guards and storage details.
Do not make the language analyzer depend on interpreter objects.

For each retained fact, the design must account for its source and lifetime:

- Source proof: valid for a resolved binding and supported paths in this source
  revision. Replacing a definition invalidates its dependent summaries.
- Runtime observation: valid at an execution boundary, with binding identity
  and relevant storage revisions. Editing or mutation can invalidate it.
- Test example: expected behavior for particular arguments, shown separately.
- Unknown: insufficient information, unsupported syntax or exhausted budget.

These are proposed distinctions, not a requirement to create one large public
fact object. Add fields when a consumer needs them. Cache by resolved definition,
relevant input facts and dependencies, not by function spelling alone.

The diagnostic consumer reports a proven incompatibility at a known execution
point. A possible failure on an uncertain branch must not become a definite
error. The compiler consumer additionally proves supported operations, effect
boundaries and guard placement. Successful diagnostic analysis alone is never
a compiler permission.

## Delivery sequence

Stages are small deliveries with tests. Optimization can start at stage 4;
it does not wait for complete language coverage in stage 6.

### 0. Lock down the semantic baseline

Status: complete for the paired value-semantics cases used by diagnostics.
The interpreter tests distinguish array aliases, parameter writes, captured
bindings, nested reference values and retained lazy readers. Unsupported host
effects remain an unknown boundary in the diagnostic pass.

Audit the current effect pass against value semantics before extending it.
Add paired analysis/runtime cases for assignment, parameter passing, returned
arrays, captured writes, nested values, lazy snapshots and host-written storage.
Record where a write changes a binding, where CoW separates storage and where a
reference-like value can still expose a change.

For example, `B = A` can share a buffer initially, but `B 0 = 9` must preserve
`A`. A function writing its array parameter must preserve the caller's array.
A write to a captured binding is a different case. Do not build an alias pass
on the assumption that all three propagate writes alike.

Done when these distinctions have executable tests and the new diagnostic
effect pass agrees with them. No optimization change in this stage.

### 1. Track value provenance and selective invalidation

Status: complete for the supported array-value diagnostic scope. The analyzer
keeps facts per binding, so a direct alias can share storage at runtime without
sharing later writes as a logical value. It joins facts after branches and
discards exact element values after a write; a known rank-1 single-cell scalar
replacement retains the union of possible element types. There is no static
reference count or general object-graph provenance map. Unknown calls, nested
references and host-owned values keep conservative invalidation. Language,
REPL and runtime tests cover aliases, rebinding, branch writes, lazy snapshots,
unsupported effects and edits to earlier source.

Start with fresh array construction, direct assignments, rebinding and direct
indexed writes in straight-line code. Distinguish binding identity, logical
array value and possible shared storage. At branch joins, retain only facts
supported by every reachable path; differing dimensions become unknown. The
pass does not retain a set of physical storage origins.

Classify what a write can invalidate: element facts, dimensions, the current
value or an entire unknown reachable region. Preserve accepted binding contracts.
An element write need not erase a proven rank or unrelated array facts. CoW
separation must follow the runtime rule, not an invented static sharing rule.

Treat nested references, external storage and unknown container paths
conservatively until their behavior is covered. This stage does not promise
full object-graph alias analysis.

Done when REPL tests retain facts about untouched arrays, update the written
value correctly and never retain stale facts through an unsupported write.
Check edits and retained execution as well as fresh programs.

### 2. Describe function results and effects

Corpus check (2026-09-23): `node benchmarks/analysis-coverage.mjs` parsed
459 unchanged demo files. It found known effect summaries for 25 of 568
top-level functions. None of the 356 functions containing a `for` has a
known summary. In Deep-ML, the count is 3 of 75 functions; `linear_regression`,
`k_means` and `adam_optimizer` are all unknown. A useful broadening step needs
control-flow joins for effects and return origins across loop entry, body,
back edge and exit. It must treat zero iterations, `break`, `continue`,
and writes to captured bindings without assuming a loop runs once. Count
newly covered unchanged demo functions after each change; a new isolated
example alone is not evidence that this stage helps ordinary programs.
A separate pass over companion `_test.ra` files found 1,197 function examples;
424 have a nonempty inferred result type. This counts inferred facts, not
correctness against the expected results and not effect proofs. All four
examples of the unchanged CSES `008_maxsubarray` have an inferred integer
result. Keep this metric separate from the 25 known effect summaries.
Call-site effect analysis now uses proven eager-array and scalar facts for a
counted numeric reader loop. It joins local facts with the zero-iteration
path and repeats until stable; unsupported exits and branches retain the
unknown fallback. `len` over a proven eager array and binary `max` over
proven scalar numbers have narrow no-callback contracts. On unchanged CSES
`008_maxsubarray`, this retains an unrelated caller type after a call on an
eager literal array. At that point, shaped fill arrays had no eager-cell proof,
so they invalidated that type. The corpus pass found 31 of 1,197 test-example calls
with known effect summaries, including all four `008_maxsubarray` examples.
That count includes other already-supported
functions; it is not an elapsed-time gain or a function-wide proof. The 25
unconditional summaries among 568 functions have not increased.
A corpus expectation check now compares known result types and ranks with
the examples in `_test.ra`. It found 16 incompatible examples before the
collection-result fixes and zero afterward, among the same 424 inferred
results. The fixes preserve array shape through scalar-cell operations,
`sum axis`, `outer`, `transpose` and `matmul`; the unchanged Cody
`pair_distances` demo has a paired runtime matrix test. The check treats
integer and real expectations as compatible because Rank equality can compare
them numerically. Expected values are examples, not type contracts, so zero
conflicts is a regression check rather than proof of analyzer soundness.
A shared REPL test uses the unchanged `max_subarray` definition in an
unexecuted draft. It reports both the integer result mismatch and an
unrelated caller mismatch on an eager literal input. At that point, editing
the input to a shaped fill array withdrew both diagnostics. Redefining its `max` helper
with an unknown call also withdraws the retained caller diagnostic.
The effect pass now joins call-site value facts across `if` branches. The
operation catalogue gives `odd`, `even` and `binomialmod` an explicit
no-callback contract only for proven scalar integer operands. On the
unchanged CSES `017_brackets1` function, a call with integer input now keeps
an unrelated caller type and reports a later bad addition before execution.
An unknown or array input does not get that proof. After rebuilding the
language package, the corpus has 40 of 1,197 test-example calls with known
effects, up from 31. Unconditional summaries remain 25 of 568, and no loop
function has an unconditional summary. This is a diagnostic gain; no runtime
speedup was measured for this demo.
The call-site pass also handles a condition-controlled `for` loop when its
condition and body have known effects, its body has no unsupported exit, and
local facts settle after joining the zero-iteration path with the back edge.
On the unchanged LeetCode `009_palnum` demo, all ten integer test calls now
have known effects. A REPL test retains an unrelated caller type after the
call and withdraws that diagnostic when an unknown call is inserted into the
loop. The corpus count is now 50 of 1,197 test-example calls. Unconditional
loop summaries remain at zero; this change did not measure execution speed.
The pass now also includes `return` paths inside a supported loop. It checks
the return expression's effects and records its possible origin, while a
binding assigned in the loop has unknown origin on a later iteration. This
adds all eight integer examples from the unchanged LeetCode `007_revint`
demo and two examples from AtCoder `010_otoshidama`. The corpus count is now
60 of 1,197 test-example calls. A REPL test retains an unrelated caller type
after `reverse` and withdraws that diagnostic when the loop contains an
unknown call. `break`, `continue`, `yield` and `try` still make this loop rule
unknown. Unconditional loop summaries remain at zero.
Proven scalar integer `+=`, `-=`, `*=`, `//=`, and `%=` assignments now keep
their integer facts. A `for` loop can also traverse a proven text parameter
without a callback. The caller accepts text reads as safe because Rank text
is immutable; it still requires eager scalar cells for array reads. On the
unchanged AtCoder `003_marbles` demo, this retains an unrelated caller type
and reports a later bad addition before execution. The corpus now has 118
of 1,197 example calls with known effects and 427 with inferred result types,
up from 60 and 424. These counts are analysis coverage, not elapsed-time gains.
The result pass now collects `return` values inside supported `for` loops. It
widens bindings assigned in the loop before inspecting its body, retains the
zero-iteration path and leaves `break` and `continue` unknown. On the unchanged
LeetCode `007_revint` and AtCoder `010_otoshidama` demos, all ten companion
examples now have inferred result types and ranks. The REPL reports a result
type or rank mismatch after either call before running the draft. The corpus
has 462 of 1,197 examples with inferred results, up from 427, and no conflicts
with the checked example expectations. Known call-site effects remain at 118.
These counts do not establish execution speed or complete loop coverage.
The numeric operation catalogue now gives scalar integer `gcd`, `isqrt` and
`powmod` calls a no-callback contract. Their scalar results keep rank zero, so
one proved `powmod` result can feed another. The unchanged CSES exponentiation
and exponentiation-II demos now retain unrelated caller facts for integer
inputs; unknown inputs and shadowed operation names do not get this proof.
Known call-site effects rise from 118 to 142 of 1,197 examples, with zero
result-expectation conflicts. Both demo test files pass. This is a diagnostic
coverage change; execution speed has not been measured.
The same catalogue mechanism now has a scalar-numeric no-callback contract
for `exp` and `round`. It is checked only when every operand has a proven
numeric scalar value. Unary signs retain that scalar fact. Four scalar
examples in the unchanged Deep-ML `022_sigmoid` demo gain known call-site
effects; its array example remains unknown. The corpus count is 146 of 1,197,
with zero result-expectation conflicts. A new Rank function can gain an
inferred summary from its supported body without changing the analyzer. A
new host builtin can select the `scalarNoCallback` operand domain in the
catalogue without changing the analyzer, if that contract fits its behavior.
Other host behavior needs a separate proof rule backed by its implementation;
the absence of an `effects` flag is not such a contract.
The analysis now distinguishes eager scalar cells from lazy derived cells
whose reads cannot call Rank code. Supported scalar comparisons and boolean
operators carry the second fact through array results, and `count` consumes
it. A direct label `raise` does not invalidate caller facts during speculative
result analysis; computed raise arguments remain unknown. On the unchanged
Deep-ML `052_recall` demo, all six normal examples now have known call-site
effects. Its seven runtime tests pass, including the dimension-error case.
The checked corpus has 158 of 1,197 example calls with known effects and
466 with inferred result types, with zero expectation conflicts. No whole-demo
speedup was measured.
Numeric arithmetic now carries the callback-free scalar-cell fact through
supported array results. The catalogue gives unary `sum`, `min`, `max`, `count`,
`all` and `any` a shared reduction contract, applied only to an array with
eager or proved callback-free scalar cells of the required numeric or boolean
type. The unchanged CSES `missing` and
`minimum_reading_time` examples now have known call-site effects. The REPL
retains an unrelated caller fact after `minimum_reading_time` on an eager
literal input; at that point, shaped fill inputs still had unknown effects. The corpus has
169 of 1,197 example calls with known effects, 466 with inferred result types,
and zero expectation conflicts. Both CSES demo test files pass. The Deep-ML
`linear_regression` function remains unknown: its `matmul` calls and array
compound update still lack a suitable proof.
Unary numeric array mapping is now declared in the operation catalogue. The
analyzer no longer keeps a separate list of names such as `exp`; shape
preservation for `round` also uses catalogue metadata. On the unchanged
Deep-ML `023_softmax` demo, all three companion examples have known call-site
effects for eager numeric inputs, and the REPL can attribute rounded array
assertions to `softmax`. The test extractor now rejects assertions that belong
to other functions or unimported builtins. That correction changes the corpus
denominator: the current pass finds 172 of 1,087 examples with known effects,
469 inferred results and zero expectation conflicts. These counts cannot be
compared directly with the earlier 1,197-example pass. No runtime speedup was
measured.
The catalogue now describes callback-free numeric array reads for `transpose`,
`matmul`, `solve` and `round` when every input array has proven eager or
callback-free numeric cells. Explicit shaped literals with scalar items carry
the eager-cell fact. On unchanged Deep-ML `014_linreg`, the REPL retains an
unrelated caller type and infers the result rank from the right operand of
`solve`. At that point, shaped fill inputs had no eager-cell proof. All four demo tests
pass. The current corpus has 179 of 1,087 example calls with known effects,
up from 172; all seven added calls are in Deep-ML. Known function-wide effects
remain 25 of 573, and no loop function has a known summary. This is a
diagnostic gain, with no measured execution-speed change.
Scalar `fill` now gives a shaped array an eager-cell fact: runtime builds an
owned array of the evaluated integer, real or boolean value. A fill with an
unknown value still has no such proof. REPL tests now retain unrelated caller
facts after filled-array calls to unchanged CSES `max_subarray` and
`minimum_reading_time`, and Deep-ML `recall`, `softmax` and `014_linreg`.
The current corpus count stays at 179 of 1,087 because its extracted examples
did not add these filled-array calls. A fresh CoW profile at 256 elements
still records 0, 1 and 0 copies for gradient descent, K-means and Adam.
The K-means copy follows a lazy mask of `Labels`; a broader borrow proof
does not remove that retained reader. No runtime optimization was made.
The `shape` and `len` catalogue entries now have a guarded array-header
contract. A shape result is an eager integer array, so its indexed reads do
not call Rank code. The analysis also retains the left operand of a dyadic
operation in a chain such as `X transpose Error matmul`, and joins eager and
callback-free arrays across loop iterations. A local numeric array compound
update can keep that proof when both arrays have compatible shapes and safe
cells. These rules cover all three normal examples of unchanged Deep-ML
`015_gd`; the REPL reports a later bad addition before the call runs. Unknown
input cells and a shadowed `transpose` still withdraw the proof. The corpus
has 182 of 1,087 example calls with known effects, up from 179, and zero
expectation conflicts. All four `015_gd` runtime tests pass. Unconditional
function summaries remain 25 of 573, with no known loop summary. No speedup
was measured.
A trial that added numeric-range loop traversal alone raised known summaries
from 25 to 26 of 568 functions. It was removed. The remaining functions also
use operations such as `len`, `max` and `matmul`; their catalogue entries do
not prove that evaluating them cannot call back into Rank through lazy or
host-owned values. The next analysis must combine control-flow joins with
operation contracts and input facts. Do not infer a no-callback contract from
the absence of an `effects` flag.

The CSES `008_maxsubarray` and Deep-ML `015_gd` call-site diagnostic gates now
pass for proved inputs. Deep-ML `017_kmeans` and `049_adam` are the next gates.
`k_means` has nested loops, a `break`, indexed array writes and `sum`/`mean`
on derived arrays. `adam_optimizer` calls the passed `Gradient` function inside
a loop and updates `X`. Their effects and value origins remain unknown.
Recount the corpus after each general rule and require a changed diagnostic
or guarded runtime decision on an unchanged demo. A count alone is not enough.

Extend the current possible-write summary as needed to distinguish:

- parameter-local writes from writes to captured bindings or reachable state;
- a fresh return value from a returned parameter/capture or an unknown origin;
- reads of mutable captured state, I/O and unsupported calls;
- direct effects from transitive effects through resolved helper calls.

Map summaries to actual arguments and lexical binding identities at a call
site. Begin with supported nonrecursive functions. Unknown callbacks, imports
without summaries and recursive groups keep a conservative boundary. A later
bounded fixed-point pass may cover recursion; budget exhaustion is not purity.

Do not collapse these facts into a single `pure` flag. “Does not write its
parameter” does not prove that a call returns independent data, cannot throw,
does not read changing state, or is safe to move outside a loop.

Done when helper chains and returned-array cases preserve the right facts,
while shadowing, redefinition and captured writes invalidate the right ones.
Tests in the same file and `_test.ra` remain examples only.

### 3. Prove non-escape and extend borrowing

The same corpus check found four syntactic borrow candidates among 568
functions and none in Deep-ML. This count does not establish that any
runtime-owned flat array avoids a copy. The current Deep-ML CoW profile at
256 elements remains 0, 1 and 0 copies for gradient descent, K-means and
Adam. Do not present more borrow-proof cases as a demo speedup without a
before/after run of an unchanged program that actually takes the path.
With guarded core `len`, `min` and `max`, the corpus has nine syntactic
candidates, including the unchanged CSES `max_subarray` and AtCoder
`best_score`. This count assumes the builtins keep their identities. Runtime
checks those identities and requires owned, flat scalar arrays for each
borrowed parameter and every other parameter whose indexed read the proof
uses. The proof rejects an escaping return or an unknown call. A redefined
builtin, host-owned or non-flat argument, and unsupported syntax use ordinary
CoW binding. These new guards do not make the Deep-ML functions candidates.

Source inspection accounts for all nine candidates. Four are text readers in
AoC IPv7 and Euler poker, so their string inputs fail the flat-array guard.
AoC `cookiescore` reads an arithmetic result, and `wins` reads such a result
alongside the boss array; both require flat-array arguments that those call
sites do not supply. The remaining three are `max_subarray`, `best_score` and
`expected_inversions`. Their source programs do not write the input after the
reader call. This is a call-site audit, not a runtime profile of all nine
programs. It gives no evidence of a whole-demo speedup from broader borrowing.

Track whether an argument or something reachable from it can leave the call:
through a return, yield, retained container, closure, captured binding or unknown
callee. Begin with flat arrays and supported readers. Keep nested values and
callbacks on the ordinary ownership path until proved safe.

A borrow candidate needs no writes that violate the borrowing convention and
no escape, including indirect paths and collisions with other arguments.
Read-only alone is insufficient. Calls must refer to the implementation for
which the summary was proved.

Diagnostics gain better retention across reader helpers. Expose effect or
copy-cost explanations only where useful; wording and warning policy remain
open. Do not add mandatory ownership annotations or move errors to Rank.

Done when negative tests cover returned aliases, closure capture, generators,
container retention, helper replacement and the same value in two parameters.
Language proof tests reject the escaping cases. Runtime tests confirm the
ordinary CoW path for returned aliases, closures, generators and containers;
they also check helper replacement and repeated arguments. This closes that
negative-test gate for owned flat scalar arrays. It does not prove non-escape
for nested values or arbitrary callbacks.

### 4. First runtime use: broader inferred borrowing

Use stage 3 proofs to extend the existing `prepared-function.ts` borrowing
decision. Prefer reusing shared rules over maintaining two independent effect
classifiers. Keep the current conservative path for every unsupported case.

The guarded flat-array reader-helper subset already avoids marking its caller's
array shared. Extend that benefit only where a broader non-escape proof supports
it; a later write can then avoid an unnecessary CoW copy.

`node benchmarks/demo-reader-write.mjs 2048 16` compared this borrowing on
and off in one runtime on Apple M5 / Node v24.15.0. It used the unchanged
`max_subarray` and `best_score` functions, 16 fresh owned inputs per sample,
two warmups and nine alternating samples per mode. Input creation was outside
the timer. The read-then-write case timed each call and one later write to
each input. The control disabled runtime borrow candidates only; both
functions have no prepared static borrow proof. Median batch times changed
from 2.18 to 1.00 ms for `max_subarray` and from 6.90 to 3.24 ms for
`best_score`. CoW copies fell from 16
and 48 per batch to zero, with equal result checksums in every sample. This
measures a reader-then-write workload, not a speedup of either demo's
original whole program. Tests cover compiled and interpreted loops,
redefined builtins, a non-flat cross-argument guard, repeated arguments and
a returned alias.

The same benchmark also measures calls without the later write. Both modes
made zero copies. Median batch times were 1.00 ms without inferred borrowing
and 0.97 ms with it for `max_subarray`, and 3.38 ms versus 3.31 ms for
`best_score`. These small differences do not establish a speedup for the
original demos. The borrowing benefit depends on an input being written after
the reader call; neither original demo does that. Do not extend this proof
solely to increase candidate counts. Find a measured end-to-end workload
before broadening it further.

Gate: interpreted and optimized results/errors agree; deterministic ownership
or copy-path tests prove that a copy is avoided; repeated benchmarks show the
cost on reader-then-write workloads and unchanged controls. Report allocation
savings separately from elapsed time. Drop the optimization if proof overhead
outweighs the measured benefit.

### 5. Compiler use: retain proofs across calls and loops

Feed supported summaries into region planning. Check actual input types,
storage eligibility and callable identities at entry. Retain a proof across
a call only if its dependencies cannot change during that call.

First targets are repeated type/element checks and generic array dispatch in
regions that already compile. Add explicit invalidation points for rebinding,
captured writes, callbacks and lazy readers. A representation guard is still
needed even when the source-level element type is known.

Bounds-check removal is a separate substage: prove selector ranges, stable
dimensions and iteration behavior. Rank alone never proves an index valid.
For zero iterations, do not introduce checks or errors that execution would
never reach. Moving a check must preserve its order relative to other errors
and already-performed writes.

Fallback must happen before observable work, or resume from a precise execution
point. Never replay a partly executed effectful region from its beginning.

Gate: compiler-on/off differential tests, negative guard tests and execution-path
counters, followed by benchmarks. Test failed guards after REPL edits and
function redefinition. Retain runtime checks wherever proof is incomplete.

### 6. Broaden diagnostics and reusable function inference

Deliver this coverage incrementally alongside stages 3–5:

- Narrow unions under supported `is` tests and merge facts after branches.
- Analyze loop-carried facts to a bounded fixed point; widen changing lengths
  and numeric ranges instead of treating the first iteration as a contract.
- Handle `break`, `continue`, returns and exception paths without inventing
  facts on paths that do not reach the next statement.
- Express supported result relationships, such as preserving rank or shape,
  from actual argument facts. A function remains usable with different types
  and ranks on different calls; tests do not freeze a signature.
- Add operation rules for further selectors, bytes, records and containers
  after checking their runtime semantics and existing rule coverage.

Each addition needs positive, negative and unknown cases. It becomes eligible
for compiler use through stage 5's proof gate, not automatically on release.

### 7. Liveness, buffer reuse and fusion

After a measured workload needs it, combine provenance with last-use and escape
information. A buffer can be reused only when no live observer needs its old
contents. Include closures, containers, named lazy results, REPL retained values
and resource lifetime in that decision.

Candidates include mutate-and-return calls, private temporary buffers and
additional named-intermediate fusion. CoW remains the fallback. Borrowing a
reader and consuming a dead temporary are different proofs.

An omitted CoW check does not authorize omitting bounds or type checks. Reuse
must preserve the public value semantics even when the caller still has a name
for the input. No new user-visible move semantics are planned here.

Gate: old values remain observable and correct in all control tests; counters
prove fewer copies/allocations; unchanged workloads show a repeatable benefit.
This stage is conditional, not a commitment to a general ownership framework.

## When each fact can improve execution

| Fact/proof | Diagnostic use | Earliest planned execution use |
| --- | --- | --- |
| Type, rank and partial shape | Early operation/assignment errors | Already selects guarded compiler specializations |
| Value provenance and CoW behavior | Preserve unaffected facts | Input to later effect/ownership proofs; no speed claim alone |
| No write plus no escape | Retain facts across reader calls | Stage 4: extend existing borrowing and avoid false sharing |
| Stable dependencies across a region | Keep facts after supported calls | Stage 5: fewer repeated checks and dispatches |
| Index range plus stable shape | Diagnose proven invalid indexing | Stage 5 substage: remove only proved redundant bounds checks |
| Last use plus no observers | Optional copy-cost explanation | Stage 7: reuse buffers or extend fusion |
| Compact storage eligibility | Explain representation constraints | Separate storage project; this plan does not add numeric formats |

## Verification and rollout

For every diagnostic stage, run language and shared REPL tests. Add terminal
and browser scenarios when transport, edit invalidation or display changes.
Use the interpreter corpus as an oracle: successful programs must have no false
diagnostics, and inferred facts must agree with runtime values.

Measure edit latency on short drafts and large files, including incomplete
syntax and deep helper chains. Record median and tail latency, cache hits and
budget fallbacks before choosing a numeric latency target. Cache invalidation
must be tested independently of a clean restart.

For execution changes, run interpreter and demo tests with the relevant
optimization off/on. Benchmark cold total time, warm execution and allocations
separately. Include numerical loops, bytes/text processing, helper-heavy code,
containers, reused arrays and lazy values. MD5 is one workload, not the design
target. Record environment, sample count, result checks and execution coverage.

Each optimization needs a measured bottleneck and an isolated comparison.
Fewer checks or copies are evidence of changed work, not by themselves evidence
of faster execution. Keep failed experiments documented and out of the runtime.

## Immediate next delivery

Choose one unchanged demo with a measured bottleneck before extending the
analysis again. Name the diagnostic or runtime decision that the new fact
would change, then compare that decision and whole-workload cost with the
current analyzer. If the new rule only increases candidate counts, stop that
line of work. Add paired analysis and runtime regressions before changing the
borrowing convention again. The current CoW measurements do not show that
broader escape analysis would make the original demos faster.

Related plans: [performance](performance-roadmap.md),
[value semantics](value-semantics.md), [tensor fusion](tensor-fusion-plan.md),
[compact storage](array-element-types.md).
