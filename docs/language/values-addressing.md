# Values and addressing

Rank uses whitespace-based application and addressing.

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

When the final word resolves to a function, preceding values are its data. Thus
`A B` is addressing, while `A B gcd` calls `gcd` with `A` and `B`. Resolution
may use the arity and value roles registered by the imported vocabulary, but it
does not change the parsed source structure.

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

For an operation supporting several arities, an exact argument count wins.
Otherwise Rank tries larger supported arities first. This keeps a compact
binary call such as `A B max` binary.

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
Too many selectors, invalid indices and masks whose length differs from their
axis are errors. Outside tensor addressing, `#` is valid only as a discarded
`for` binding.

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

## Padding and defaults

`pad` provides a value when data is absent:

```rank
X = A i pad 0
Last = index Key pad -1
Age = Data .Age pad Median
```

The same concept covers:
- out-of-bounds array access;
- missing keyed values;
- missing table values.

`pad` is non-mutating. To store the result:

```rank
Data .Age = Data .Age pad Median
```

The left side is evaluated first. The fallback expression is evaluated only
when addressing finds no value. `pad` does not hide invalid negative indices,
type errors or failures such as division by zero.
