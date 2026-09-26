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

`A` remains `1 2 3` and `B` is `99 2 3`. The same rule covers functions: a
function cannot change the data its caller passed in. To hand a changed value
back, return it.

```rank
fun bump V
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
for I in 0 until 1000
  A I = I * I
end
```

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
Seen = set
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

A derived array such as `A * 2` computes its cells when they are demanded. A
name freezes what it reports: writing to a source afterwards builds a new value
for that source and leaves the named result alone.

```rank
use sequences
A = array 1 2
B = A * 2
A 0 = 5
```

`B` remains `2 4` while `A` becomes `5 2`. This holds through a chain of lazy
readers: naming the last one freezes every source it reads through. To compute
a result from current values, write the expression again.

`copy` remains the way to force storage for a lazy result, and is no longer
needed to protect one name from another's writes.

## General form

```rank
A i
A i j
Data .Age
index Key
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

For an operation supporting several arities, an exact argument count wins.
Otherwise Rank tries larger supported arities first. `min` and `max` are
ordinary postfix calls: `A B max` calls the current `max` with arguments `A`
and `B`, and `A B max 5 min` chains from the left. The infix form `A max B` is
an error that suggests `A B max`. These names are not reserved; a local
function or parameter shadows the builtin.

Builtins and aliases use the same argument rules: `Matrix i max` and
`Op = max` followed by `Matrix i Op` both pass two arguments. To reduce one
addressed row, write `(Matrix i) max`. Two scalar arguments work the same
way: `3 4 max` is `4`.
A following function starts another step: `Values max sqrt` takes the square
root of the maximum.

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
M3 = N % 3 equal 0
M5 = N % 5 equal 0

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

Numeric ranges are first-class sequences. Their compact form does not use
`from`:

```rank
1 to 10
1 until 10
for i in 1 to 10
  i print
end
```

`to` includes the endpoint.

```text
1 to 3
=> 1 2 3
```

`until` excludes the endpoint.

```text
1 until 3
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

10 until 0 by -2
=> 10 8 6 4 2
```

With `to`, the endpoint is included only
when the range lands on it exactly; `1 to 6 by 2` therefore produces
`1 3 5`. With `until`, the endpoint is always excluded. `by` applies only
to numeric ranges; bounding a known sequence such as `fibonacci to 100` does
not accept a step.

Equal bounds produce one value with `to` and no values with `until`,
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

`from` appears only after a selected value and introduces a contiguous slice:

```rank
Closed = Text from L to R
Open = Text from L until R
```

`to` includes the final position; `until` excludes it. Slice bounds are
zero-based, nonnegative and ascending. An exclusive end may equal the axis size;
an inclusive end must be inside the axis. Equal exclusive bounds produce an
empty slice.

For tensors, `axis` chooses the sliced axis. Other axes are preserved:

```rank
Rows = M axis 0 from 1 until 4
Columns = M axis 1 from 2 to 5
```

Multiple axes can be sliced through ordinary assignments without adding a
special multidimensional delimiter:

```rank
Block = M axis 0 from 1 until 4
Block = Block axis 1 from 2 until 5
```

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

## Missing-value defaults

`default` provides a value when data is absent:

```rank
X = A i default 0
Last = index Key default -1
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
