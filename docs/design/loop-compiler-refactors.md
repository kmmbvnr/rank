# Loop compiler: deferred refactors

Issue #338 added real registers to compiled loops. Before that fix, three small
refactors went in: one arithmetic lowering shared by expressions and compound
assignments, a table of inline numeric builtins, and one value-type mapping for
entry guards and cell scans. The items below were left out to keep that change
small. They are listed roughly by value.

## Split `buildTypedLoop` by backend

`integer-loop.ts` builds both backends from one function of about 800 lines.
A `numberMode` flag selects the safe-Number backend and appears in 27 places:
literals, overflow guards, dirty-slot tracking, cell reads, traversal headers,
and many early `if (numberMode) return undefined` rejections.

Proposal:

- Separate analysis (slots, local types, required inputs, arrays, writers) from
  lowering. Analysis runs once; each backend lowers the same plan.
- Give each backend a small object for the parts that differ: literal spelling,
  integer overflow guard, cell read, scalar write.
- Replace the scattered Number-mode rejections with one eligibility check over
  the plan, next to the checks already in `prepareNumberLoop`.

This also removes the second analysis pass that `compileIntegerLoop` runs for
the fast path today.

## Rename `integer-loop`

The loop compiler now handles integer, real, boolean, text and bytes registers.
`integer-loop.ts`, `integer-loop-plan.ts`, `integer-loop-runtime.ts`,
`compileIntegerLoop`, `IntegerLoopPlan` and the `integerLoop` operator field all
say "integer". A rename to `scalar-loop` is mechanical, but the public options
`integerLoopCompilation`, `onIntegerLoopCompiled` and `onIntegerLoopExecuted`
need aliases or a deliberate break. Do it together with the backend split, not
separately.

## Real values in more loop forms

These still fall back to the interpreter with a `loop:` diagnostic:

- calls to compiled user functions that take or return reals. The loop rejects
  real arguments and `unsupported-type:real` results, although the scalar
  function backend already proves real parameters;
- compound writes to real array cells, such as `Xs I += 0.5`;
- iteration over a real array, `for X in Xs`, whose binder is typed integer;
- real `//`, `mod` and `**`;
- an integer binding that becomes real, such as `S = 0` before `S += 0.5`. The
  interpreter retypes `S`; the loop keeps one type per binding.

## Real values in the Number backend

The exact backend stores reals as plain JS numbers, so they are already fast.
The remaining cost in Euler 247 is the integer bookkeeping: `Top` and `Step`
are BigInts, and each cell index is converted with `Number`. The Number backend
would remove that, but it rejects any loop that writes array cells. Supporting
`Float64Array` cells and array writes there is the next step for this shape of
loop, and it needs the same publish-on-success contract as integer writes.

## One scalar lowering for loops and scalar functions

`scalar-function-kernel.ts` has its own `binary()` with the same rules: mixed
integer/real equality, `Number` coercion, floor division and remainder. The
loop's `arithmetic()` now holds the loop copy. Both could use one module that
takes operand types and returns code, so a semantic fix lands once.

## Builtins in loops from the catalogue

Loops reach builtins in two ways: the inline table in `integer-loop.ts` (`abs`,
`even`, `odd`, `sqrt`, `floor`, `ceil`) and catalogue `compiledCall` signatures
called through `calls[]`. The inline list could move to the operation catalogue
in the language package, next to `compiledCall`, so one place describes which
builtins each backend lowers.

## Type selection by variant

A real input selects a real register from the value seen when the loop is first
compiled. If a later run passes an integer, the entry guard rejects the plan and
the loop is interpreted. Text inputs already use a small cache of plans keyed by
type; real inputs could use the same cache.
