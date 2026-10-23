# Values and addressing

Rank uses whitespace-based application and addressing.

## Values and sharing

A name holds its own value. Assignment, argument passing, `yield` and storage
inside another structure each give the receiver a value, so a write through one
name is never visible through another:

```rank
use sequences
A = array 1 2 3
B = A
B 0 = 99
```

`A` remains `1 2 3` and `B` is `99 2 3`.

Records and mutable containers share identity across aliases. Once a deferred
binding (`Plan' = Expr`) or deferred parameter captures that state, writes
through any alias fail. This includes nested records and containers. Arrays
keep copy-on-write semantics. To change captured record fields, construct a
fresh record with `with`; to change a captured container, construct a new one.

The same array rule covers functions: a
function cannot change the data its caller passed in. To hand a changed value
back, return it.

```rank
fun V bump
  V 0 = 99
  return V
end
A = array 1 2 3
C = A bump
```

`A` remains `1 2 3` and `C` is `99 2 3`.

Copying is what the rule means, not what the runtime does. Storage is shared
until a write needs it, and only a write to a value that two names can reach
takes a copy. A name that alone owns its array writes into it, so building an
array cell by cell allocates once:

```rank
A = array shape 1000 fill 0
for I in 0 till 1000
  A I = I * I
end
```

Large arrays created by `array shape ... fill N` use four-byte signed integer
cells when the integer fill fits that range. Indexed writes widen the storage
when needed; reads and reductions still return exact Rank integers. Eligible
numeric loops update counters in private numeric storage and publish the result
in a batch. The ordinary value and sharing rules apply.

When the runtime proves that a function only reads scalar cells and cannot
retain its array parameter, the call can borrow flat scalar storage. Counted
loops, scalar comparisons and guarded built-ins such as `abs` can participate
in this proof. The call then does not force a copy on the caller's next write.
Returning the array, capturing it or passing it to an unknown callback keeps
the ordinary sharing rules.

For a proven last use of a private local array, the runtime can transfer its
storage to a function that writes it. This does not change value semantics:
if the caller reads the old value again, or another binding retains it, the
ordinary copy-on-write path applies. The initial optimization covers flat
scalar arrays passed directly from a function's straight-line body, after
construction, addressed writes and callback-free scalar expressions that read
cells, or an exclusively owned parameter passed onward under the same conditions.
The shared value and effect analysis must prove a scalar result and integer
selectors; this also covers computations such as `(A 0) + 1` and comparisons
in conditions. Unchanged parameters or local names bound once before a
straight-line read can supply selector values. The runtime checks that these
bindings belong to the caller and hold integers before transferring storage.
Mutable or captured indices, earlier whole-array uses and unclassified calls
keep the ordinary path. Captures, protected blocks, generators and
debugger inspection keep the ordinary path.

A generator that reuses one buffer therefore emits values, not its buffer:

```rank
use algo
fun walk
  Pos = array 1 1
  for # in 1 to 3
    Pos 0 += 1
    yield Pos
  end
end
Seen = new set
for P in walk
  Seen add P
end
```

`Seen` holds `2 1`, `3 1` and `4 1`. A collection keeps what it was given, so
its contents cannot change under it and a set keeps its distinct elements.

### Reference values

A few structures carry identity rather than contents. Assignment, argument
passing and storage share them, and a change through one name is visible
through every other:

- records, and the `object` values that JSON and table rows use;
- graphs and their disjoint-set structures;
- the `algo` structures `index`, `queue`, `deque`, `stack`, `heap`, `set`,
  `counter`, `multiset`, `orderedset`, `fenwick` and segment trees;
- open files, SQLite databases and other handles;
- generator sequences, which are single-pass.

These are the deliberate exception and the list is closed. Everything else —
numbers, text, symbols, dates, arrays and tensors — is a value.

### Naming a lazy result

`B = A * 2` completes the result and stores its cells. `Plan' = A * 2`
saves an expression that computes again when demanded:

```rank
A = array 1 2
B = A * 2
A 0 = 5
Plan' = A * 2
A = array 7 8
Saved = Plan
```

`B` holds `2 4`; `Plan` computes `10 4` from the captured value of `A`, and
`Saved` holds that completed result. Rebinding `A` does not retarget the plan.
Repeated reads of `Saved` use its stored cells; repeated demands of `Plan`
compute again, including any effects of its expression.

A name captured by an apostrophe binding is read-only for the rest of its
scope. A later indexed or field write through that name is rejected, while
rebinding remains allowed. Shared records and containers also reject writes
through aliases after capture. Array aliases keep copy-on-write value semantics.

Ordinary binding completes plans recursively inside tuples, records and
containers. A known infinite result is an error. Deferred binding preserves
single-pass resources without making them restartable. `copy` remains an array
copy operation; ordinary binding already provides a storage boundary.

## General form

```rank
A i
A i j
Data .Age
Cache Key
A sum
A B gcd
```

Conceptually, the value comes first and selectors follow.

When the final word names a function, preceding values are its data. Thus
`A B` is addressing, while `A B gcd` calls `gcd` with `A` and `B`.
The parser groups calls using vocabulary and binding signatures before
analysis and execution. A suffix function takes the accumulated arithmetic
formula or range; addressing within its operands remains tight.

Function arity also separates an addressed first argument from the remaining
arguments. The final `arity - 1` values are separate arguments; the entire
remaining left chain forms the first argument:

```rank
Result = T i j Limit above
rem above receives T i j, then Limit
```

Only the first argument may absorb a multi-part addressing chain. Use named
intermediate values when several arguments require addressing. If the left
chain cannot form one value, the call has too many arguments and is an error.

A field label reads its field before arguments are counted: when a label
names a field of the record or object just before it, the pair is one value.
`Model .weights matmul` therefore multiplies by the `.weights` field, and
`R .slots max` reduces the `.slots` field, without parentheses. A label that
is not a field of the value before it, such as an option like `.descending`,
and a column label after a table, stay separate arguments.

Inside an address, a field label addresses what it reads, so selectors can
follow it: `Rows 0 .attributes "Rate"` reads the `.attributes` object of the
first row, then its `"Rate"` entry. An object addressed by an array of text
keys returns the entries in the order listed.

A few operations declare a label written after their name as a modifier that
chooses the form of their result instead of a field of it: `Text json .flat`
and `Text xml .flat` return a table of nodes, as `Values sort .descending`
reverses the order.

For ordinary postfix calls supporting several arities, an exact argument
count wins; otherwise Rank tries larger arities first. `min` keeps this rule:
`A B min` compares two operands. Functions with two required left operands,
such as `A B matmul`, keep both operands separate.

`max` takes one operand on the left and an optional operand on the right.
`A max` reduces A; `A max B` compares A and B elementwise. Addressing stays
inside each operand: `Matrix i max` reduces the selected row, `Matrix # 0 max`
reduces a column, and `A max B 0` compares A with the selected element of B.
A known function or a `rank`/`axis` modifier ends the right operand.

Direct aliases retain these operand sides: after `op = max`, `Matrix i op`
reduces the selected row and `A op B` compares two values. A following function
starts another step: `Values max sqrt` takes the square root of the maximum.
To pass another independent left operand to a later postfix function, group
the completed call: `(A max B) 5 min`. Core names cannot be redefined by a
local function or parameter.

The fundamental selection model is:

```text
value + selector -> value
```

## Sequence indexing

An integer selector addresses a sequence by its zero-based position:

```rank
First = Sequence 0
SixthPrime = primes 5
```

Indices must be nonnegative. Addressing past the end of a finite sequence is an
error.

Addressing stays lazy. A sequence source may calculate or seek to an element
through its own plan. Otherwise the general implementation iterates only far
enough to reach the requested position.

Text uses the same rule. Its positions are Unicode code points rather than
UTF-16 code units or bytes:

```rank
Letter = "A😀Б" 1
rem 😀
```

## Iteration with value and index

```rank
for Value i in A
  Value print
  i print
end
```

The first name binds the current value and the optional second name binds its
zero-based index. The names are separate tokens: the whitespace is required.
With one name, `for Value in A` binds only the value.

Tensor iteration may bind one coordinate name for every frame axis:

```rank
for Line i j in T axis 0 1 rank 1
  Line print
end
```

`axis` precedes its numbers, so `T axis 0` cannot be mistaken for the ordinary
addressing expression `T 0`.

## Whole-axis tensor addressing

`#` means every position on one tensor axis. Selectors correspond to axes from
left to right, and omitted trailing axes are implicitly complete:

```rank
Row = A i
Column = A # j
Plane = T i
Line = T i # k
LastPlane = T # # k
```

An integer selector removes its axis. `#`, a range, an integer array or a
rank-1 boolean mask preserves its axis. For `T` with shape `2 3 4`, `T # 1`
therefore has shape `2 4`, while `T # # 1` has shape `2 3`.

Several collection selectors form a Cartesian selection rather than paired
coordinates:

```rank
Block = A Rows Columns
```

The result has one preserved axis for every collection selector and every `#`,
followed by all omitted trailing axes. Tensor selections are lazy and cached.

Integer addressing may continue into a nested selected value after consuming
all axes of the current tensor:

```rank
Rows = array "abc" "xyz"
Letter = Rows 1 2
rem z
```

For a true tensor, selectors first consume its axes together. Any remaining
integer selectors then address the resulting value from left to right. The
chain fails if that value is not addressable. Invalid indices and masks whose
length differs from their axis are errors. Outside tensor addressing, `#` is
valid only as a discarded `for` binding.

`axis` remains the explicit form when an operation consumes or selects a named
axis:

```rank
Means = A mean axis 0
Column = A axis 1 j
```

The first expression reduces axis 0. The second selects position `j` on axis 1
and is equivalent to `A # j`.

## Boolean addressing

Boolean masks are ordinary first-class values.

They can be stored:

```rank
Mask = A greater 0
```

and used as selectors:

```rank
Positive = A Mask
```

For tables:

```rank
Mask = Data .Age greater 18
Adults = Data Mask
```

Boolean addressing does not mutate the original value.

To explicitly replace it, use ordinary assignment:

```rank
Data = Data Mask
```

Masks can be composed before they are applied:

```rank
M3 = N mod 3 equal 0
M5 = N mod 5 equal 0

Selected = N (M3 or M5)
```

A named selector does not need parentheses:

```rank
Selected = N Mask
```

Parentheses are used when the selector itself is a compound expression:

```rank
Selected = N (M3 or M5)
```

Boolean masks may also be used for assignment:

```rank
Negative = Pred less 0
Pred Negative = 0
```

## Slices and ranges

Numeric ranges are first-class sequences:

```rank
1 to 10
1 till 10
for i in 1 to 10
  i print
end
```

`to` includes the endpoint.

```text
1 to 3
=> 1 2 3
```

`till` excludes the endpoint.

```text
1 till 3
=> 1 2
```

Numeric ranges use a step of `1` by default. `by` sets a nonzero integer
step: positive steps move up, negative steps move down. The bounds never
choose the direction. A range is empty when the step points away from its end:

```text
1 to 0
=> empty

1 to 5 by -1
=> empty
```

Use an explicit negative step for a descending range:

```text
1 to 9 by 2
=> 1 3 5 7 9

10 till 0 by -2
=> 10 8 6 4 2
```

With `to`, the endpoint is included only
when the range lands on it exactly; `1 to 6 by 2` therefore produces
`1 3 5`. With `till`, the endpoint is always excluded. After values rather
than a number, the same words bound them: `fibonacci to 100` keeps the items
at most 100 (see [Bounds](sequences-arrays.md#bounds)).

Equal bounds produce one value with `to` and no values with `till`,
regardless of the step's sign. A zero step is an error even for empty ranges.

```rank
N = 0
for i in 1 to N
  i print
end
rem No output.

for i in 3 to 1 by -1
  i print
end
rem Prints 3, 2, 1.
```

A range used as a selector takes a contiguous slice:

```rank
Closed = Text (L to R)
Open = Text (L till R)
```

`to` includes the final position; `till` excludes it. Positions are
zero-based, and every selected position must exist. Equal exclusive bounds
produce an empty slice. Text is sliced by Unicode code point.

For tensors, each selector addresses the next axis, and `#` keeps a whole axis.
Other axes are preserved:

```rank
Rows = M (1 till 4)
Columns = M # (2 to 5)
Block = M (1 till 4) (2 till 5)
```

On a SQLite view a range selector becomes `LIMIT` and `OFFSET`, and on a SQLite
text expression it becomes `substr`, so neither reads rows early.

## Arrays of indices

An integer array is a selector for arbitrary positions. Inline `array` remains
unambiguous because it consumes the rest of the expression:

```rank
Letters = Text array 0 2 6
Rows = M axis 0 array 2 0 2
```

A selector can also be named and reused:

```rank
Order = array 2 0 2
Rows = M axis 0 Order
```

Positions are returned in selector order and may repeat. An integer selector
removes its axis; a range, integer-array or boolean-array selector preserves the
axis. The selected axis gets the selector's length. Without an explicit `axis`,
a collection selector applies to the leading axis; a full-shape boolean mask
continues to select matching atoms as a rank-1 result.

Text uses the same rules over Unicode code points. Selection returns text rather
than an array of one-character text values.

## Writable operations

An imported operation may declare a separate write capability. Its normal
postfix call reads a value; the operation followed by its address arguments on
the left of `=` writes to the resource:

```rank
use cli
Host = "HOST" env default "localhost"
env "HOST" = "example.org"
Name = "HOST"
env Name = .NA
```

For `env`, text sets a value and `.NA` removes it. This deletion convention
belongs to `env`, not to every writable operation. An alias preserves the
capability: `e = env` also permits `e Name = Value`. Operations without a write
handler reject addressed assignment. Compound writes are currently rejected.

The operation is resolved first, address arguments are evaluated once in source
order, and the address is validated before the right-hand side is evaluated
once. A failing RHS leaves the destination unchanged. Writes have their own
signatures and effects, separate from the read call.

Resolution precedes function-binding preparation. Available builtins cannot be
redefined, so `env Name = Value` is a write after `use cli`. Without that import,
the unopened name remains available for an ordinary function binding. There is
no new assignment keyword, public port type or user-defined setter syntax.

## Missing-value defaults

`default` provides a value when data is absent:

```rank
X = A i default 0
Last = Cache Key default -1
Age = Data .Age default Median
```

The same concept covers:
- out-of-bounds array access;
- missing keyed values;
- missing table values.

`default` is non-mutating. To store the result:

```rank
Data .Age = Data .Age default Median
```

The left side is evaluated first. The fallback expression is evaluated only
when addressing finds no value. `default` does not hide invalid negative indices,
type errors or failures such as division by zero.
