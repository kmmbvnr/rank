# Type and shape diagnostics during editing

This page describes non-executing diagnostics for the REPL and editor.
The checker does not change Rank's runtime rules.

The proposed [diagnostics and optimization plan](analysis-and-optimization-plan.md)
sets out the delivery order, value-semantics checks and proof gates for runtime
use. It distinguishes the current implementation below from future work.

## Contract

- Report proven incompatible assignments and operations before execution.
- Check known ranks, axes, selector counts and incompatible dimensions.
- Preserve unknown facts at external data boundaries. Keep runtime checks.
- Use current REPL value metadata without reading array cells, consuming a
  sequence, executing a function, or performing I/O.
- Discard runtime-derived facts when earlier source changes. Never report an
  error using stale dimensions.
- Suppress semantic diagnostics for an incomplete parse.
- Reuse one language-level analysis in the REPL and language validator.
- Keep function examples and expected results from tests distinct from proofs
  about every possible return path. Test files must not execute during editing.

## Current implementation

`analysis/value-facts.ts` represents runtime type names, element types, rank,
known dimensions and small literal shape vectors. `analysis/value-diagnostics.ts`
checks these facts without evaluating Rank code. The existing type-name pass
remains available to its current consumers.

The shared notebook screen displays diagnostics separately from execution
previews. A diagnostic does not mark a line as executed, move the evaluation
cursor, or run the draft. Both CLI and web workers send copied value metadata.
The language validator consumes the same analysis.

The implementation currently covers basic literals, ranges, materialization,
explicit array dimensions, arithmetic broadcasting, reshape element counts,
finite one-dimensional windows, scalar/whole-axis addressing and rank bounds.
Assignments and return branches in function bodies can be analyzed at a call
site; recursive and unsupported control flow remains unknown.

Call-site facts survive functions with plain local assignments, arithmetic,
array literals and calls to other supported functions. This lets the checker
report incompatible variable arguments and infer result types and ranks through
helper chains. Messages identify the called function. Unknown argument facts do
not produce an error, and tests do not restrict a function to the types in its
examples.

`analysis/function-effects.ts` summarizes possible indexed writes to parameters
and captured objects. Calls to supported helpers map written parameters back to
the caller's parameters. Conditional effects include all branches. The pass
uses current function binding identities and a budget of 100 definitions.

Known indexed writes to array targets preserve unrelated immutable scalar facts.
Unknown target types and other indexed structures retain full invalidation,
since their writes may invoke callbacks. Reference
values still lose their facts because aliases can cross arguments, containers
and REPL snapshots. A parameter marked read-only does not prove that its object
cannot be changed through another argument. This pass does not yet track alias
provenance or preserve separate, unaliased arrays across a write.

Recursive calls, dynamic function arguments, compound assignments, writes
through local aliases or rebound parameters, loops, functions without returns,
and unsupported expressions including I/O remain unknown. Unknown effects
keep the previous full invalidation behavior. The summary is for diagnostics,
not a public purity annotation or permission for the compiler to remove guards.

Conditional analysis joins bindings from each reachable branch, including new
locals assigned in every branch. A shared array rank survives different axis
lengths; differing lengths become unknown. Literal boolean conditions select
reachable `if` and `elif` branches in order. Errors within a branch are suppressed
when its execution is uncertain, while facts after the conditional describe all
surviving paths.

Simple loops check existing binding types and array ranks. Assigned bindings
lose their exact dimensions before the body is inspected, so the first
iteration cannot fix the lengths used in later iterations. Body diagnostics
require a provably nonempty one-dimensional collection; empty loops are skipped.
Unknown iteration counts retain runtime checks. Loops with mutation statements,
destructuring or `break`, `continue` and `return` remain conservative. No loop
executes during this analysis.

When preparing a file-backed CLI notebook, the host reads the adjacent
`<name>_test.ra` if it exists. Direct calls and assigned call results compared
with `equal` supply example argument facts and expected result facts. Aliased
imports are supported. At a function declaration the notebook displays the test
file and line, its expected type, and the type inferred from the current body
for those arguments. The expectation never overrides the body analysis.
Missing or unparsable tests clear the examples. Preparing or reopening the
notebook refreshes the file; typing does not run tests or poll the filesystem.
The browser currently has no local-file loading host, so automatic companion
discovery is available only where the host supplies file reading.

Top-level `test` blocks in the same file also supply examples for local
functions, without an import. These examples come from the current notebook
text and refresh after edits, including in the browser. Local and companion
examples are combined. Local tests with unaliased imports are skipped because
an imported name may shadow the local function. No tests execute during this
analysis.

Text has runtime rank one but is an atom in arithmetic and array construction.
`reduce rank R` permits R equal to the input rank. Array bindings keep the number
of axes established by their first array value. Reassignment may change axis
lengths, including growing arrays inside loops. A known rank change reports
`DimensionMismatch` before execution; the runtime checks unknown results too.
Function parameters establish their array rank separately for each call.

## Conservative boundaries

Unsupported loop bodies, recursion and unknown calls do not establish result
contracts. Possible writes invalidate earlier dimensions. The function analysis
has a budget of 100 call expansions per pass. Unchanged notebook source and
runtime metadata reuse the previous diagnostic result.

The current value type and the binding's accepted assignment types are separate:
a loop variable whose last value is text may still accept integers. Runtime
snapshots include that contract. Integer addressing can continue inside a text
array element; an extra integer selector is not rejected merely by counting the
outer array's dimensions.

An incomplete cell produces no semantic diagnostics until parsing succeeds.
Companion examples cover direct calls and assigned call results in top-level
test blocks, not arbitrary test control flow. Unknown results are shown as
unknown. There are no latency or whole-program type-coverage guarantees.

## Verification

Language tests exercise facts, diagnostics, validator ranges, incomplete parses,
return unions, effects and companion examples. Common-layer tests cover edit
invalidation, retained union contracts, no-execution behavior and missing tests.
Worker tests cover transport of current array dimensions. A real PTY scenario
and `packages/web/test/value-diagnostics.playwright.js` check diagnostics before
Enter and their removal after correction.

The interpreter's existing demo-corpus type test also checks the new analysis:
successful runs must have no false diagnostics, and every reported type, array
rank and known dimension must agree with the produced value. Programs requiring
an unavailable host are excluded from that runtime oracle.

The integer-loop compiler uses `expressionFacts` to select text, boolean and
byte specializations, including parenthesized expressions and nested byte
construction. These are planning hints: emission must still prove the supported
operation, and entry guards recheck current bindings and exact builtin identity.
Test expectations never enter this path. A diagnostic fact is not by itself
permission to remove runtime guards or assume that a host call is pure.
