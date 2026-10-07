# Type-stability contracts

This describes runtime contracts and the static facts supported by them. It is
not a soundness proof. The wider documentation task is tracked in
[#61](https://github.com/kmmbvnr/rank/issues/61); ordinary array contracts were
added in [#147](https://github.com/kmmbvnr/rank/issues/147).

## Record bindings

An ordinary record binding retains its field names and recursive field types
and ranks. Values, field order, and array lengths may change:

```rank
State = record
  .count = 1
  .items = array 10 20
end
State = record
  .items = array 30 40 50
  .count = 2
end
```

Rebinding `State` to a record with `.name` instead of these fields is an error.
Use a different name for a different structure. Replacing an entire record uses
the same structural compatibility as replacing a nested record: a different
established array element type is a different schema. Empty array fields without a concrete fill leave
their cell domain open; a later nonempty field assignment or compatible record
replacement settles it. Empty replacements and a temporary `.NA` do not erase
an established contract.

Contracts belong to binding lifetimes. Parameters and locals start fresh on each
function invocation; a captured binding keeps its contract in the enclosing
frame. Loop-body assignments to an existing name keep that name's contract.
Forgetting a notebook binding or ending its scope removes the contract.

Assignment still shares record identity. Replacing a name does not retarget its
old aliases. Refinement of an empty field through an alias is observed by the
binding, and a replacement record inherits the binding's established field
contracts before it is installed. Rejected replacements leave the old binding.

A heterogeneous traversal should process each record in a fresh function call:

```rank
fun visit Node
  return Node .value
end
```

Call `visit` for each node instead of repeatedly assigning differently shaped
records to one loop-local name. The autograd demo uses this pattern for its
leaf, binary, and ReLU nodes, preserving their shared gradient updates.

Record-field construction and validation retain their existing eager behavior;
this step does not introduce a new lazy record-field contract.

## Array bindings

A binding retains its outer type, array rank, and recursive element domain.
Lengths can change independently on every axis. Text remains rank 1.

```rank
A = array 1 2
A = array 3 4 5       rem Allowed: new length.
A 0 = "text"         rem Element-type error.
```

Ordinary arrays are homogeneous. Every nonmissing cell has the same recursive
type and rank. `array 1 "x"` and `array 1 2.0` are errors. Use a tuple for
positional values with different types, or convert numeric values explicitly.

Nested arrays keep their ranks and recursive domains. Different lengths are
allowed at every depth. Record cells keep their field names and recursive field
contracts; records in one array domain must have compatible schemas, as they do
in array-valued record fields. Other mutable values, such as objects and indices,
retain their own payload rules.

An explicit `fill` establishes the recursive cell type even at length zero:
`array shape 0 fill 0` has integer cells, `fill 0.0` real cells, and `fill ""`
text cells. This type survives copies, compatible assignments, and returns.
A nested array, tuple, or record fill supplies its recursive type and rank.

Plain empty arrays and `fill .NA` establish rank but no concrete cell domain.
Missing cells do not establish a domain and fit any established domain. Replacing an entire binding with `.NA`
does not erase its array contract. A first nonmissing batch of cell writes can
settle an otherwise missing-only array.

Integer and real are separate domains. Infinity is a numeric sentinel; an
infinity-only array defers its finite numeric domain:

```rank
use numbers
Dist = array shape 3 fill infinity
Dist 0 = 0            rem Settles finite cells to integer.
Dist 1 = 12           rem Exact integer distance.
Dist 2 = infinity     rem The sentinel remains allowed.
Dist 1 = 12.5         rem Rejected: finite real in integer domain.
```

A first finite real instead settles the numeric seed to real. Both positive and
negative infinity are sentinels; `NaN` is a real value. The runtime representation
and `type` of infinity remain real, so static facts about a possibly infinite
cell must still allow real values. Either numeric array domain admits infinity;
a later finite cell must still match the established integer or real domain.

When an algorithm changes numeric domains, give the converted value a new name.
Initialize real-valued accumulators with `0.0`; integer initialization fixes an
integer domain. For example:

```rank
Pixels = array 0 128 255
Normalized = (Pixels real rank 0) / 255.0
```

## Establishment and validation

Write `C ⊢ V` for “value V satisfies contract C.” A contract contains a value's
outer type, an array's rank, an optional homogeneous element contract, tuple positions, and record fields.
It contains no array lengths or scalar values.

- An absent element contract is unresolved. The first concrete observation
  establishes it; empty arrays without a concrete fill and missing cells leave it unresolved.
- Every concrete cell must match the same contract, recursively.
- A successful write retains established types and newly settled nested domains.
  A failed eager batch publishes none of its replacement cells.

Already stored cells are inspected without calling host getters or lazy readers.
Typed numeric buffers use their storage information where sufficient. Recursive
checking costs work proportional to the inspected structure; repeated scalar
summaries use revision-aware caches. Deep array traversal and contract merging
use explicit stacks.

Unread lazy cells stay lazy. A checked view validates each demanded cell against
any established contract. Its first concrete observed cell settles its element
type. Nested lazy arrays settle their own types as cells are demanded. Later
reads of a retained lazy value must satisfy the established contract.

Missing-cell exceptions retain their usual behavior: a whole-array read can
represent absence as `.NA`, while a direct missing-cell read still raises.

Lazy validation can therefore fail after assignment, when a consumer reads a
cell. The rejected cell is not returned, but the binding already holds the lazy
value. There is no rollback to a previous binding at that later point. Cached
cells cannot bypass a subsequently refined contract. Compact record storage
retains its native layout checks and value-copy reads.

## Writes, aliases, and scope

Whole-array assignments, compound assignments, scalar selections, slices,
gathers, and masks pass the contract. Selection replacements are evaluated and
checked as a batch before cells are changed. A lazy whole-array arithmetic result
can instead fail on observation, as described above.

The RHS and selectors may already have run callbacks or other effects before a
write fails. Those effects are not rolled back. A failed eager assignment keeps
the previous binding value; a failed eager selection batch keeps its cells.
Record-field mutation continues to use the existing record-field checks.

Arrays retain value semantics: writing one ordinary array name does not change
another name's stored cells. Each new name establishes its own contract from the
value it receives. Records inside arrays keep their existing shared
identity. Retained lazy values also retain their deferred validation obligations,
including when reached through another name.

Parameters get contracts for the current call. Captured names use the enclosing
frame's contracts. A fresh invocation or a name leaving its block ends that
binding's contract. A top-level function's assignment still creates a local name
rather than rebinding a global. Stateful callbacks remain allowed.

## Contract comparison

| Context | Outer type | Array rank | Axis lengths | Recursive cells / record schema | Lifetime / checks |
| --- | --- | --- | --- | --- | --- |
| Ordinary scalar name | Fixed, with missing and infinity-seed rules | Text stays rank 1 | Text length may change | Not applicable | Binding lifetime; assignment |
| Ordinary record name | Fixed | Field ranks fixed | May change | Recursive field names and structural field contracts | Binding lifetime; checked replacement, aliases keep identity |
| Ordinary array name | Fixed | Fixed | May change | One recursive element type | Binding lifetime; eager validation or deferred lazy reads |
| Parameter / captured array | Same as ordinary array | Fixed | May change | Same recursive contract | Invocation / enclosing frame |
| Record field | Fixed | Fixed | May change | Recursive, including field names; homogeneous array fields | Record identity; eager field validation can read lazy cells |
| Mutable collection | First insertion establishes element type | Array element rank fixed | May change | Array cells recursive; plain record elements retain identity semantics | Collection identity, including after removal to empty; insertion checks |
| Index / object payload | May vary | Not fixed by payload storage | May change | Heterogeneous payloads | Existing structure rules |
| Function return | Fixed per specialization | Fixed | May change | Recursive arrays, tuple positions, and record fields | Closure and specialization; eager or deferred result checks |

## Tuples and tables

`tuple A B` constructs a fixed positional product. `(tuple)` is empty. A tuple
binding and a function's result specialization keep the same number of positions
and the same recursive type/rank at each position. Array lengths inside a tuple
may vary. A tuple is rank 0; text remains rank 1.

```rank
fun items Flag
  if Flag
    return tuple 1 "yes"
  end
  return tuple 2 "no"
end
unpack X Y = true items
unpack X Y = false items
```

Tuples support integer indexing, `len`, structural equality, and both forms of
`unpack`. Positions cannot be assigned. Embedded arrays retain value semantics;
embedded records retain reference semantics. Tuples do not broadcast like arrays.
An array of tuples requires the same tuple schema in every cell.

Array and tuple returns now reuse the recursive binding contract. This replaces
the separate direct-element-set return checker. Empty and lazy data settle using
the same rules as bindings, without reading lazy arguments to choose a specialization.

Tables retain one type per column; different columns may have different types.
Named matrix projections preserve this column distinction. Selecting a row with
different column types returns a tuple; homogeneous rows remain arrays. Ordinary array results
of table operations must be homogeneous. Convert columns explicitly before an
operation that combines integer and real cells into one ordinary array.

Mixed JSON arrays and mixed `parse` captures become tuples; homogeneous results
remain arrays. `eigh` returns a tuple of eigenvalues and eigenvectors. Weighted
graph edge pairs and SQL parameter bundles are tuples. JSON `.flat` keeps `.value`
as text so that its column is homogeneous; filter `.kind` and convert explicitly
before numeric operations.

## Lazy call specialization

Laziness and materialization are evaluation/storage properties, not language
types. Call specialization uses stable element-type information separately
from the cell cache:

```rank
use sequences
fun twice Values
  return Values * 2
end
Source = array 1 2
Lazy = Source * 2
A = Lazy twice
Material = Lazy copy
B = Material twice
```

`Source`, `Lazy`, `Material`, `A`, and `B` have the same integer-array
specialization. Reading cells, or calling `copy`, does not create another
specialization. Multiplication propagates its result type using the same scalar
operator rules as the analyzer; it does not execute a cell to discover its type.
For matrices, transpose displays `array[n, m]<a> → array[m, n]<a>`.
Its generic array alternative remains available for other ranks. Known
input axes appear reversed in the result, including zero-length axes.

Slices, transpose, reshape, binding wrappers, and preview copies preserve the
available element information. Tuples carry it at each position.

A lazy value whose type is genuinely unknown retains an unresolved element
domain, including after materialization and copying. Unresolved arguments use
an unresolved specialization; runtime return checks still apply. A cache of
observed cells is not a declaration that authorizes a new specialization.
Explicit fills provide type evidence even for empty arrays. External-data
validation remains in #33/#116. An already typed binding keeps its domain through empty
or all-missing replacements. This change preserves existing specialization granularity:
array argument keys describe direct element kinds, while recursive binding and
return contracts validate nested structure.

Calling `twice` with unread cells leaves them unread, including at sizes eligible
for dense kernels. Those kernels only borrow cells already stored. A demanded
cell still runs its callback and raises its errors at that point. Known type
information does not imply purity, permit callback reordering, or suppress
validation of the actual result.

## Static analysis

Whole-program analysis reports provable assignment violations and retains
established element bounds across compatible writes, loop widening, and suitable
callback invalidation. It can check nested ranks and record fields when their
facts are known. Empty arrays, unread lazy arrays, unknown alternatives, and
unvalidated external data can leave domains unresolved. A lack of diagnostics
is not proof that a program will satisfy every runtime contract.

Record assignments reuse the analyzer's existing recursive field comparison.
The binding retains schema facts separately from its current value, including
through missing values and conservative callback invalidation. Private record
names retain their known field schema across callbacks; lengths, values and
read-safety proofs are discarded. Analysis can still miss recursive array-cell
conflicts or refinements performed through aliases; runtime validation remains
required.

Values, axis lengths, eager-read guarantees, and callback effects are separate
facts. Keeping a type contract does not preserve those facts or permit evaluation
reordering. #69's backward requirements remain a separate diagnostics channel;
#33/#116's external-data expectations do not establish runtime contracts.

Implementation evidence:

- [Binding enforcement](../../packages/interpreter/src/array-binding-contract.ts),
  [frame lifetime](../../packages/interpreter/src/frame.ts), and
  [selection writes](../../packages/interpreter/src/eval/assignments.ts).
- [Runtime regression tests](../../packages/interpreter/test/array-binding-contracts.test.ts),
  [static regression tests](../../packages/language/test/array-binding-contracts.test.ts),
  and [record contracts](../../packages/interpreter/test/record-contracts.test.ts).


## Inference boundaries and explicit fills

No new annotation syntax is required by #153. A fill is evaluated once, even
when its resulting array has zero cells. Its type provides construction evidence;
this does not authorize evaluating unread nested lazy cells to discover a type.
`fill infinity` remains a numeric sentinel that can settle to integer or real.
`fill .NA` and plain empty arrays leave the concrete domain unresolved.

To migrate an old placeholder, use the intended type:

```rank
Numbers = array shape 0 fill 0
Names = array shape 0 fill ""
Undecided = array shape 0 fill .NA
```

Recursive functions with no provable returning type remain unknown under bounded
inference and retain runtime checks. Unknown is not a proof of termination or a
permission to change an established result contract.

For external JSON, CSV, and XML, backward requirements describe how the program
uses input. They become established facts only after boundary validation. The
validation design is tracked in #33 and #116; it is not part of #153.

## Function body signatures

Type previews use `number` for an `integer | real` family, including inside
collections. A known `integer` or `real` keeps its concrete name. Separate
input/result alternatives remain separate: `integer → integer ; real → real`
preserves a relationship that `number → number` would hide.

`?` means unknown information. Repeated letters such as `a → a` denote an
established relationship; unrelated unknowns display as `? → ?`.
`array[#, #]<real>` has exactly two axes of unspecified size, while
`array<real>` has unspecified rank. A `[rank 2]` annotation describes the
processed cell rank, independently of the whole array's rank.

Numeric-preserving contracts use a shared type variable with a finite domain:
`a a → a ; a: number` requires the same concrete integer or real type in both
operands. A known call substitutes that type into the result. `abs` uses
`a → a ; a: number`, with a separate missing-value alternative. These shared
contracts supply nominal result types; they do not prove callback safety,
values, or array dimensions. Unknown inputs do not establish a concrete type.


An uncalled single-return function can expose conditional input/result
alternatives from the fixed contracts of built-in operators. For example,
`return X + 1` shows `integer → integer`, whereas
`return X / 2` shows `integer → real`. A real argument requires a real
constant or an explicit conversion. These are related
alternatives, not independent unions of inputs and outputs. Supported helper
calls carry the intermediate types through the same analysis.

The notebook displays up to two scalar and two collection alternatives.
Matching array and sequence alternatives share a container variable: for
`return X + 1`, the collection signature is
`c<integer> → c<integer> ; c: array | sequence`.
Array rank remains generic. Adding a scalar preserves the numeric
collection's shape; two collections still follow broadcasting rules.
`…` marks a partial display and unresolved domains. Duration, missing values
and SQL expressions remain in the structured alternatives; SQL dispatch
precedes missing propagation. Empty or untyped lazy collections cannot
establish an element requirement from an unevaluated cell.

Analysis has a fixed work budget. `… (inference limit)` keeps an unresolved
remainder when it is exhausted, including when no supported alternative
was found. Unsupported bodies and unknown record
fields retain the existing conservative signature. This inspection never
executes a function, reads cells or consumes a sequence. A conditional
signature does not prove termination, shape compatibility, callback safety
or absence of value-dependent errors, and is not an optimization fact.
Concrete calls and examples retain their observed signatures; notebook
function previews cache the general contract rather than an example's
specialization.

Generator previews also infer scalar alternatives through local assignments,
compound assignments, branches and condition loops. An established variable
keeps its binding type across loop iterations: assigning `X / 2` to an integer
local is a type conflict, not promotion to real. Branch joins track uncertainty
without allowing a write to violate any of the possible binding contracts.
For example, the trial-division generator `facts`
shows `integer → sequence<integer>` for its integer input alternative. Sequence
length and termination remain unknown. Locals defined only inside a possibly
empty loop or only on one continuing branch do not establish a cell type.

This generator analysis is for display only. Captures, helper calls, nested or
ranked generators and unsupported statements keep their element domains unresolved;
an ordinary generator can still display `a → sequence`. It shares a fixed work
budget across candidate inputs and nested loops and retains the explicit
unresolved remainder. It neither runs the body nor changes runtime type checks.

### Finite container variables in signatures

`c<a> → c<a> ; c: array | sequence` abbreviates two concrete rows:
`array<a> → array<a>` and `sequence<a> → sequence<a>`. Matching expands
these alternatives and keeps each input/result relationship together. Known
arguments select their concrete kind; unresolved kinds stay compact when all
alternatives retain the same element relationship. The accepted set is always
explicit. Repeated `c` means the same kind; separate `c` and `d` may be the same
or different kinds. Type variables `a`, `b` and container variables `c`, `d`,
`e`, `f` have separate names and are local to one signature.

A concrete result remains concrete: `reverse` accepts a queue, stack, deque or
finite sequence through `c<a>`, but returns `array<a>`. Collection writes to a
set, counter or multiset preserve their input kind. Scalar mapping operations
that already support arrays and sequences use the same finite notation.
These display and matching contracts do not establish shape relationships,
callback safety or compiler eligibility.

### Array shape references in signatures

An array signature can describe its axes: `array[n, m]`, a square
`array[n, n]`, known sizes `array[3, 3]`, or anonymous sizes `array[#, #]`.
These are exact axis lists. `array[…s, n, n]` accepts zero or more leading
frame axes and two trailing square axes. A `[rank 2]` annotation separately
states the default processed cell rank. A queue or sequence does not acquire
array axes through a container-kind variable.

Matching reuses the existing shape contracts. Known incompatible sizes reject
a row; unresolved sizes retain runtime checks. Existing symbolic dimension
identities can be retained without adding arithmetic inference. Shared frames
can be concatenated in a result; an input still allows at most one frame
sequence. A result relationship describes successful calls and does not prove
that an inverse exists or that a lazy array can be read without callbacks.

`diag` keeps vector creation and matrix extraction separate. A square main
diagonal retains its shared length; a rectangular diagonal uses `#` when the
length is unknown. `matmul` retains last-left/first-right contraction, including
vector dot products and higher-rank outputs. Known empty product shapes display
a scalar result. Array facts with unresolved element types display `<?>`;
unknown function results display `?` instead of a fresh type variable.

### Symbolic function previews

For supported scalar arithmetic, ordered comparisons and boolean expressions,
function previews compose the operator contracts instead of enumerating every
parameter-domain combination. For example, `((A + B) + C) + D` has the numeric
branch `a a a a → a ; a: number`. Integer constants remain integer: `X + 1`
does not acquire a real branch. Independent numeric groups keep separate
variables, and proven helper calls carry their relationships into the caller.

SQL, missing values, text and other declared scalar overloads retain separate
alternatives. Scalar/cell alternatives exclude SQL columns so missing
propagation cannot take precedence over column dispatch. The established
single-frame numeric alternatives remain conditional; multiple frames, empty
or unknown cells and unsupported domains remain in the explicit remainder.

Unsupported expressions use the bounded enumeration fallback. Both paths keep
an inference-limit marker when their budget is exhausted. General previews
remain partial contracts; they do not prove callback safety or compiler
eligibility. Concrete-call analysis still instantiates relationships from the
actual argument facts through its existing separate path.
