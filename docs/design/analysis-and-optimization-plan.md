# Diagnostics and optimization plan

Status: proposed implementation sequence, based on the implementation on
2026-09-23. This plan does not introduce syntax or change runtime semantics.

The first delivery covers direct array replacements with proven integer or
whole-axis selectors and supported function writes under array value semantics.
Other provenance cases in stage 1 remain open.

Stage 2 has started with return-origin summaries. They distinguish an input-free
result from a returned parameter or capture, including straight-line local
aliases and supported helper returns. Branches join conservatively. Helper
captures, unsupported indirection and paths that may fall through remain
unknown. Runtime borrowing does not consume these summaries yet.

Stage 3 has a first, separate flat-array borrow candidate check. It accepts
direct numeric reads and a chain of resolved one-argument reader helpers.
Returns, aliases, writes, callbacks and unsupported statements fail the check.
The interpreter does not use the new helper-chain result yet; call identity and
argument kind still need runtime guards.

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
| Language value facts and diagnostics | Types, element types, rank, partial shapes, selected operations, call-site inference, branch joins and simple loops | Unsupported paths remain unknown; not a whole-program proof |
| Shared REPL diagnostics | Metadata snapshots, edit invalidation, same-file and host-loaded `_test.ra` examples | No test execution or array-cell inspection; browser companion loading needs a host |
| Diagnostic function effects | Possible indexed writes to parameters/captures and supported helper calls | Preserves scalar facts for known array writes; conservatively drops reference facts; no escape analysis |
| Integer-loop compiler | Uses `expressionFacts` for specialization hints and checks inputs on entry | Does not consume the new diagnostic effect summary as a safety proof |
| Runtime parameter borrowing | `prepared-function.ts` recognizes a small syntactic read-only subset | General helpers, aliases and escaping results need stronger proof |
| Flat-array borrow candidates | Direct numeric reads and resolved single-argument reader helpers | Analysis only; not yet connected to runtime borrowing |
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

Start with fresh array construction, direct assignments, rebinding and direct
indexed writes in straight-line code. Distinguish binding identity, logical
array value and possible shared storage. Extend to branch joins next; differing
origins form a conservative set, with a budget that falls back to unknown.

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

### 4. First runtime use: broader inferred borrowing

Use stage 3 proofs to extend the existing `prepared-function.ts` borrowing
decision. Prefer reusing shared rules over maintaining two independent effect
classifiers. Keep the current conservative path for every unsupported case.

This is the first planned new execution optimization: a proven reader helper
does not unnecessarily mark its caller's array shared. A later write can avoid
a CoW copy. Existing simple reader borrowing remains the baseline.

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

Start with stage 0 and the straight-line subset of stage 1. Add value-semantics
regressions, then replace broad array-fact invalidation where the runtime rules
justify it. Do not change the compiler or borrowing convention in that delivery.
Review that result before adding escape summaries.

Related plans: [performance](performance-roadmap.md),
[value semantics](value-semantics.md), [tensor fusion](tensor-fusion-plan.md),
[compact storage](array-element-types.md).
