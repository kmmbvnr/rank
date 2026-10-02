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
the same structural compatibility as replacing a nested record: a narrower
established array-field union is a different schema. Empty array fields leave
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

A deliberate mixture establishes a union. Later arrays and selection writes may
use any subset of that union, including an empty array. The union does not shrink
when one of its alternatives is absent from a replacement.

```rank
A = array 1 "x"
A = array 2 3
A 0 = "y"            rem Still allowed.
A 1 = true           rem Boolean was not in the union.
```

Nested arrays keep their ranks and recursive domains. Different lengths are
allowed at every depth. Record cells keep their field names and recursive field
contracts; records in one array domain must have compatible schemas, as they do
in array-valued record fields. Other mutable values, such as objects and indices,
retain their own payload rules.

Empty arrays establish rank but no cell domain. Missing cells do not establish a
domain and fit any established domain. Replacing an entire binding with `.NA`
does not erase its array contract. A first nonmissing batch of cell writes can
settle an otherwise missing-only array.

Integer and real are separate domains. A deliberately mixed finite integer/real
array admits both. Infinity seeds have an unresolved numeric domain:

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
cell must still allow real values. This rule extends scalar seed settlement to
array cells. It does not change collection or return contracts. An established
integer array that was never seeded with infinity does not acquire this extra
sentinel alternative merely by receiving it later.

When an algorithm changes numeric domains, give the converted value a new name.
Initialize real-valued accumulators with `0.0`; integer initialization fixes an
integer domain. For example:

```rank
Pixels = array 0 128 255
Normalized = Pixels / 255.0
```

## Establishment and validation

Write `C ⊢ V` for “value V satisfies contract C.” A contract contains a value's
outer type, an array's rank, an optional element union, and any record fields.
It contains no array lengths or scalar values.

- An absent element union is unresolved. A complete, nonmissing set of cells
  establishes it. An empty or missing-only observation leaves it unresolved.
- A replacement satisfies an established union when every concrete cell matches
  an alternative, recursively. Numeric infinity seeds use the refinement above.
- A successful write retains the established union and any newly settled nested
  domains. A failed eager batch publishes none of its replacement cells.

Already stored cells are inspected without calling host getters or lazy readers.
Typed numeric buffers use their storage information where sufficient. Recursive
checking costs work proportional to the inspected structure; repeated scalar
summaries use revision-aware caches. Deep array traversal and contract merging
use explicit stacks.

Unread lazy cells stay lazy. A checked view validates each demanded cell against
any established contract. A lazy array with an unresolved domain settles its union
only after all its cells have been observed. Nested lazy arrays settle their own
unresolved domains in the same way. Until then, another complete assignment can
settle the binding, and later reads of a retained lazy value must satisfy it.
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
value it receives; it does not automatically inherit unused alternatives from
the source name's wider union. Records inside arrays keep their existing shared
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
| Ordinary array name | Fixed | Fixed | May change | Recursive arrays and record cells; established union accepts subsets | Binding lifetime; eager validation or deferred lazy reads |
| Parameter / captured array | Same as ordinary array | Fixed | May change | Same recursive contract | Invocation / enclosing frame |
| Record field | Fixed | Fixed | May change | Recursive, including field names; record-field array unions use existing structural matching | Record identity; eager field validation can read lazy cells |
| Mutable collection | First insertion establishes element type | Array element rank fixed | May change | Array cells recursive; plain record elements retain identity semantics | Collection identity, including after removal to empty; insertion checks |
| Index / object payload | May vary | Not fixed by payload storage | May change | Heterogeneous payloads | Existing structure rules |
| Function return | Fixed per specialization | Fixed | May change | Array returns currently check direct cell-type sets; record returns are recursive | Closure and specialization; eager or deferred result checks |

Return arrays still require their established direct type set, rather than the
subset rule of ordinary array bindings. Recursive binding validation does not
silently change that separate return contract.

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
