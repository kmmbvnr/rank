# Rank Wiki

**Current language snapshot — 2026-09-12**

Rank is a modern BASIC for small screens and big algorithms.

The language is designed for:
- phones, calculators, wearables and tiny computers;
- competitive programming and algorithms;
- tables and data analysis;
- arrays, tensors and ML;
- source code that remains readable on narrow screens.

This wiki contains only the current design. Deprecated experiments are omitted.

## Core principles

1. Keep source narrow: target about 40 characters per line.
2. Prefer letters, digits, spaces and easy keyboard symbols.
3. Avoid punctuation-heavy syntax.
4. Reuse a small set of general concepts across domains.
5. Do not add primitives that exist only to solve one puzzle.
6. The editor may help with quotes and blocks, but source is plain text.
7. Libraries may add vocabulary through `use`.
8. Arrays, tables and keyed data should share one addressing model.
9. Selection should reuse Rank's general addressing model.
10. Boolean masks are ordinary first-class values.
11. Boolean addressing is the fundamental selection primitive.
12. The `filter ... end` clause is concise source/query syntax, not mutation.
13. User-facing syntax should stay simple even if implementations use macros,
    compiler extensions or optimized execution plans internally.
14. Combine compatible tensor operations internally; readable temporary names
    should not inherently require intermediate arrays.

This is an accepted architectural direction; see
[Tensor fusion architecture](design/tensor-fusion.md). Optimizations must preserve
observable behavior, and their coverage will grow incrementally.

The conceptual selection model is:

```text
value + selector -> value
```

For example:

```rank
Mask = Data .Age greater 18
Adults = Data Mask
```

## Current sections

- [Lexical syntax](language/lexical-syntax.md)
- [Modules, programs and inputs](language/modules-programs.md)
- [Testing](language/testing.md)
- [Values and addressing](language/values-addressing.md)
- [Control flow and functions](language/control-functions.md)
- [Sequences and arrays](language/sequences-arrays.md)
- [Collections](language/collections.md)
- [Graphs](language/graphs.md)
- [Tables](language/tables.md)
- [Tensor model](language/tensors.md)
- [Standard library](stdlib/modules.md)
- [Project Euler examples](examples/project-euler.md)
- [LeetCode examples](examples/leetcode.md)
- [Kaggle examples](examples/kaggle.md)
- [TPC-H examples](examples/tpch.md)
- [Product decisions](design/product-decisions.md)
- [Open questions](design/open-questions.md)
- [Competitive-programming library roadmap](design/competitive-programming-library.md)

## Marketing

- [Landscape](marketing/landscape.md)
- [Positioning](marketing/positioning.md)
- [Languages to learn from](marketing/inspirations.md)

---

# Lexical syntax

## Naming

Standard language words are lowercase:

```rank
for
sum
queue
index
sqrt
round
```

Ordinary user variables are capitalized:

```rank
Data
Target
Result
Features
```

Loop and mathematical indices are lowercase:

```rank
i
j
k
```

## Indentation

Canonical Rank source uses two spaces for each level of nesting. Tabs are not
used. Every nested block adds exactly two spaces:

```rank
for i in 1 to 3
  if i odd
    Total += i
  end
end
```

Blocks are delimited by words such as `if`, `for`, `fun` and `end`, so
indentation is visual rather than semantic. Rank formatters and maintained
source files must emit the canonical two-space form.

## Parenthesized line continuation

A newline normally ends an expression. Inside parentheses, an infix expression
may continue across lines without a continuation character:

```rank
Value = (
  A + B
  * C
)

Ready = (
  Count greater 0
  and Count at most Limit
)
```

The usual precedence rules still apply. Blank lines are allowed after the
opening parenthesis, around infix operators, and before the closing parenthesis.
Canonical source indents continued content by two spaces and aligns the closing
parenthesis with the start of the expression. Parentheses do not make block
indentation semantic.

Whitespace application itself remains on one physical line. A long function
call uses named intermediate values or a parenthesized argument.

## Comments

Comments use classic BASIC `rem`:

```rank
rem Compute the answer
Sum = 0
```

`rem` is lexical core and does not require a module.

## Assignment

`=` is assignment:

```rank
Result = 10
Data .Age = Age
index Key = Value
```

Compound assignment updates an existing variable without repeating the left
side inside the expression:

```rank
Total += Value
Total -= Cost
Product *= Factor
Power **= Exponent
Index %= Size
Mask and= Active
Mask or= Fallback
Mask xor= Changed
```

The current compound assignment operators are `+=`, `-=`, `*=`, `**=`, `/=`,
`//=`, `%=`, `and=`, `or=` and `xor=`.

The same operators may update an addressed material-array selection:

```rank
Matrix # Column *= -1
Matrix Rows Columns += Delta
```

The right side is either a scalar applied to every selected cell or an array
with exactly the selection shape. All source values are captured before any
cell is changed, so overlapping selections have snapshot semantics.

## Inferred variable types

Rank infers a variable's type from its first value, similar to writing `auto`
for every local variable in C++. The type then belongs to that name and cannot
change through a later assignment:

```rank
Count = 1
Count = 2
rem Count = 2.0 is a type error
```

Function parameters are inferred when their workspace is created. A loop over
a finite heterogeneous collection infers one fixed union of its element types
for the value binding. The binding does not change type between iterations:

```rank
for Value in Data
  if Value is .integer
    Total += Value
  end
end
```

`is` narrows the current value inside a branch. Arrays and other structures
keep their outer type when their contents or shape change according to that
structure's own rules. Explicit type annotations may be added later; inference
is the only variable declaration mode today.

Compound assignment follows the same rule. For example, `/=` cannot store a
real quotient in a variable inferred as `integer`; use `//=` when floor division
is intended.

## Records

A `record` groups a fixed set of named fields:

```rank
Node = record
  .data = 2.0
  .grad = 0.0
  .op = .leaf
end
```

Every evaluation of a record expression creates a fresh first-class value.
Fields are read with a symbol after the record and use the ordinary assignment
operators for mutation:

```rank
Value = Node .data
Node .grad += 1.0
```

A record is closed when it is created. Field names cannot be repeated, and an
assignment cannot add an unknown field. Each field independently infers its type
from its initial value and keeps that type on later direct or compound
assignment. `Value type` returns `.record`, and `Value is .record` is its
type guard.

Records have reference semantics. Assignment, function arguments and storage
inside another structure preserve the same record identity, so mutation through
one alias is visible through the others. Addressing may continue through arrays,
queues and nested records:

```rank
Tape 0 .grad += Change
Node .parent .grad += Change
```

Equality is structural even though mutation is shared by reference. Two records
are equal when they contain the same field names and recursively equal values;
field declaration order does not matter. Records may therefore be used as set
elements. `print` includes their fields in declaration order so a result remains
useful to a person and to a line-oriented grader:

```rank
Node print
rem {.data = 2, .grad = 0, .op = .leaf}
```

Records differ from JSON `object` values and sparse `index` values. An
`object` is read by dynamic text keys, while a record declares its fields in
Rank source and accesses them with symbols. An `index` remains open to new
keys and may use tuple keys.

## Unpacking assignment

`unpack` assigns the items of a rank-1 array to the following names:

```rank
unpack Length Width Height = array 2 3 4
```

`#` discards an item while preserving its position, as it does in a `for`
binding:

```rank
unpack From To # = Edge
```

The number of names and items must match exactly. Unpacking supports only `=`;
compound assignment always has one target. Each target keeps the same
inferred-type rule as an ordinary assignment. The explicit keyword keeps a
multi-part target available for addressed assignment: `A i j = Value` changes
one cell, while `unpack A B = Values` assigns separate variables. This form is
especially useful with structured text parsing:

```rank
Pattern = "/integerx/integerx/integer"
unpack Length Width Height = Line Pattern parse
```

The same word before an expression expands a rank-1 array into adjacent
application arguments or address selectors:

```rank
Point = array X Y

Index unpack Point = 1
Value = Index unpack Point
Result = unpack Point distance
```

The expression is evaluated once and its items are inserted in order. Only one
level is expanded, and the source is not changed. An empty vector inserts no
arguments. A non-array raises `.TypeError`; an array whose rank is not one
raises `.DimensionMismatch`. After expansion, ordinary function arity and
addressing rules apply.

## Data-first application

Rank places data before the operation. A function follows the values it
consumes:

```rank
30 sin
A B gcd
Range lcm
Answer print
Model X predict
```

This is the canonical call order for standard-library and user-defined
functions. Nullary sources such as `fibonacci` and `primes` are values rather
than calls. Keywords such as `use`, `run`, `option` and `if` introduce their own
statements and do not follow the function-call rule.

An application may form an unambiguous left-to-right pipeline. Each function
consumes the values accumulated before it according to its declared arity, and
its result becomes the first value available to the next function:

```rank
Answer = Fib even sum
Text reverse print
A B matmul round 6
```

A function still cannot precede its data. Insufficient or excess arguments are
errors. Use named intermediate values when a pipeline becomes harder to read:

```rank
Text = N text
Back = Text reverse
```

Short pipelines are useful on a narrow screen; intermediate values remain the
preferred style when they give a result a meaningful name.

Leading unary `+`, `-` and `not` bind to their nearest value before postfix
application. Therefore the function in this expression receives `-121`:

```rank
Answer = -121 palindrome
```

Exponentiation is the arithmetic exception. `**` binds more tightly than a
unary sign on its left and less tightly than a unary sign on its right:

```rank
-2 ** 2
2 ** -2
rem -4, 0.25
```

`**` is right-associative, so `2 ** 3 ** 2` is `2 ** (3 ** 2)`.

Use parentheses or a named intermediate value when the unary operator must be
applied to the result of a call.

Conditions use words such as `equal` rather than `==`:

```rank
if X equal 0
  return true
end
```

Current comparison vocabulary includes:

```rank
equal
not equal
less
greater
at least
at most
is
```

`at least` means `>=`; `at most` means `<=`.

Ordering comparisons accept two scalars from one comparable family: numeric,
text, boolean, symbol, date or datetime. Integers and reals share the numeric
family. Text and symbols use a case-sensitive lexicographic order by Unicode
code point. A shared prefix sorts before its longer continuation. Booleans
order `false` before `true`. The same order is used by `sort`, heaps and ordered
multisets.
Different families and non-scalar values raise `.TypeError`. Dates and
datetimes order chronologically within their own type; they do not implicitly
compare with each other or with text.

Comparisons remain scalar operations and therefore apply elementwise to arrays
and sequences, using the ordinary broadcasting rules:

```rank
Earlier = "Ada" less "Grace"
Mask = Names at most "M"
```

`Value type` returns a symbol such as `.integer`, `.text`, `.array`, `.record`
or `.object`. `Value is .integer` is the short boolean type guard. Its right side
must be a known runtime type symbol.

`in` tests membership. With text on both sides it performs an exact,
case-sensitive substring search; the empty text occurs in every text value:

```rank
if "ab" in Text
  Found = true
end
```

For keyed collections, `X in index` tests whether the key exists and `X in
set` tests whether an equal value has been added.

`+` concatenates two text values, and `+=` appends text to a text variable:

```rank
Name = "Rank" + " language"
Name += "!"
```

Both operands must be text. Rank does not implicitly convert numbers or other
values during concatenation; use the explicit `text` operation first when
conversion is intended.

## Scalar types

Rank currently has seven scalar value types: `integer`, `real`, `boolean`, `text`,
`symbol`, `date` and `datetime`. Integers have arbitrary precision. `real` is
currently an IEEE 754 binary64 value, and decimal literals contain a decimal
point:

```rank
Count = 2
Ratio = 2.5
```

Mixed integer/real arithmetic promotes the result to `real`. `/` always performs
real division. `//` performs floor division as in Python; two integer operands
produce an integer, while an operation involving a real produces a real.

`**` raises its left operand to the power of its right operand. Integer operands
with a nonnegative exponent produce an arbitrary-precision `integer`. A negative
or real exponent produces a `real`. Zero to a negative power and results outside
the real number system are errors.

```rank
Half = 5 / 2
Page = 5 // 2
NegativePage = -5 // 2
rem 2.5, 2, -3
```

`infinity` and `-infinity` are real values provided by `use numbers`. They are
valid for comparisons and arithmetic, but decimal input declarations accept
only finite real values.

`round` from `use numbers` preserves the numeric type of every scalar it
rounds: an `integer` result remains an integer and a `real` result remains a
real. Its signed integer places argument counts decimal positions to the right
of zero when positive and to the left when negative. Halfway values round to
the nearest even result.

Future low-precision numeric formats used by ML, such as 4-bit or 8-bit floats,
must be requested explicitly. Type inference never silently selects a reduced
precision format. `path` is an input constraint represented by a `text` value,
rather than a separate runtime type.

## Symbols

A leading dot creates a literal symbol:

```rank
.Age
.Sex
.Pclass
.UserId
```

Symbols are first-class values, not text. APIs may use them as type names,
operation modes, error kinds or column labels:

```rank
Column = .Age
Values = Data Column
```

Use `text` when a textual representation is needed:

```rank
Name = .Age text
```

## Text

Text literals use quotes:

```rank
Text = "hello"
```

Text is a rank-1 sequence of Unicode code points. One code point is an atomic
`text` value, so ordinary zero-based addressing and `for` iteration work on
text. The editor should make quotes cheap to enter, but quotes remain ordinary
source syntax.

---

# Modules, programs and inputs

## Standard modules

A bare module name opens standard-library vocabulary in the current workspace:

```rank
use numbers
use random
use linalg
use bits
use ranges
```

Parsing does not depend on which modules were opened. `use` enables the
corresponding meanings, validators and execution rules after parsing.

## Source modules

A quoted name loads a Rank source module without executing its top-level lines:

```rank
use "my_module"
```

Without an alias, its public definitions are opened in the current workspace.
Conflicting names are an error.

A function keeps the module workspace in which it was declared. Its body can
use standard modules and source definitions imported by its own file without
requiring the caller to repeat those imports.

An alias keeps the module in a namespace:

```rank
use "my_module" as M

M.Limit = 10
M.run
Answer = M.Answer
```

An open import does not create an implicit namespace, so its file name need not
be a Rank identifier. To use prefixed access, provide a valid alias explicitly:

```rank
use "001_multiples" as E
E.run
```

Relative names are resolved from the importing file. The `.ra` suffix may be
omitted.

## Running programs

`use` makes code available. `run` executes its top-level lines.

```rank
use "worker"
run
```

A named run loads the file first when necessary:

```rank
run "worker"
```

This is equivalent to `use "worker"` followed by `run "worker"`. A bare `run`
uses the most recently opened source module. Execution starts at its first
top-level line, reaches the end of the file and then returns to the statement
after `run`.

Running a file from the host, as in `rank worker.ra`, performs an implicit run.
Rank does not require a `main` function.

## Program inputs

`option` declares an input parameter of a program. It is broader than a
terminal-only CLI option: a caller may bind it through the current workspace, a
command-line adapter, a browser host or another runner.

```rank
rem Upper boundary, excluded.
option Limit integer = 1000
```

Input resolution has one fixed precedence order:

```text
workspace -> args -> default
```

Therefore these calls provide the same logical input through different
adapters:

```rank
Limit = 10
run
```

```rank
args "--limit" "10"
run
```

The workspace value wins when both are present. Every selected value is checked
against the declared type before program statements execute.

Positional and boolean inputs use the same model:

```rank
argument Input path
argument Numbers integer many
flag Verbose
```

`many` collects the remaining or repeated values into a sequence. A declaration
without a default is required. Contiguous `rem` lines immediately above an input
declaration provide its help text.

## Modular language implementation

Language modules register vocabulary, semantic handlers, validation and planner
rules independently. The parser uses a stable combined grammar, because source
must be parsed before its `use` statements can be evaluated. Rare syntax
extensions are assembled as grammar fragments before parser construction;
ordinary modules use existing expression and statement extension points.

Host-dependent services are injected through runtime adapters. For example,
`use io` exposes the same Rank values and operations in every host while the CLI,
browser or embedded application supplies the actual file-system implementation.

---

# Testing

Rank tests live in separate files ending in `_test.ra` and run with:

```console
rank test path
```

A test block contains ordinary Rank statements. Its body uses two spaces of
indentation:

```rank
use testing

test "limit 10"
  use "001_multiples"
  Limit = 10
  run

  Answer equal 23
end
```

Each test receives a clean workspace. Source modules are loaded without running
their top-level lines, so the test may prepare values before transferring
control with `run`. Values created by the program remain available after it
returns.

Standalone boolean expression statements are assertions. A scalar assertion
must evaluate to `true`. An array or tensor of booleans is a single assertion
and passes only when every element is `true`, so an entire result can be checked
without addressing each element:

```rank
Answer equal array 7 0 8
```

`equal` remains elementwise. Arrays and tensors being compared must have the
same shape.

Arguments exercise the same input declarations through the host adapter:

```rank
test "argument input"
  use "001_multiples"
  args "--limit" "10"
  run

  Answer equal 23
end
```

An alias provides isolation when a test loads several programs:

```rank
test "aliased program"
  use "001_multiples" as E
  E.Limit = 10
  E.run

  E.Answer equal 23
end
```

Functions exposed by a loaded source module may be called as normal Rank code.
An open import uses their names directly; an aliased import uses names such as
`E.solve`.

---

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
Otherwise Rank tries larger supported arities first. `min` and `max` also
allow infix calls: `A max B` calls the current `max` with arguments `A` and
`B`. Chains associate from the left. These names are not reserved; a local
function or parameter shadows the builtin in both infix and postfix calls.

Builtin postfix extrema retain one addressing rule: `Matrix i max` reduces
the addressed row. This rule applies only when the resolved function is the
builtin. Otherwise postfix calls use ordinary arity selection. Two scalar
arguments are accepted too: `3 4 max` is `4`. Use infix `Matrix max i` for
elementwise broadcasting, or name the builtin (`Op = max; Matrix i Op`) to
use ordinary binary argument selection.

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

---

# Control flow and functions

## Conditionals

```rank
if X less 0
  return false
end
```

Alternative branches:

```rank
if X equal 0
  Result = 1
else
  Result = X
end
```

Multiple alternatives use `elif`. Conditions are evaluated from top to bottom;
only the first true branch runs. `else` remains optional:

```rank
if Score greater Best
  Kind = "record"
elif Score equal Best
  Kind = "tie"
else
  Kind = "lower"
end
```

## For

Rank uses one `for` statement for every kind of loop. Ranges and sequences are
ordinary iterable values:

```rank
for i in 1 to 10
  i print
end
```

The loop variable is an ordinary name in the current workspace. Each iteration
assigns the next value to it; after a nonempty loop it retains the last value,
following Rank's BASIC-like workspace model.

A condition after `for` is evaluated before every iteration:

```rank
for B not equal 0
  R = A % B
  A = B
  B = R
end
```

A bare `for` repeats without a condition until control leaves its body:

```rank
for
  Count += 1
  if Count equal 10
    break
  end
end
```

`break` immediately ends the nearest enclosing `for`. It is an error outside
a loop. Rank does not currently have labels or a multi-level form of `break`;
an outer loop must be ended by its own `break`, condition or `return`.

`continue` skips the rest of the current iteration of the nearest enclosing
`for`. An iterable loop advances to the next item; a conditional loop checks
its condition again; a bare `for` starts its next iteration.

```rank
use ranges
Sum = 0
for I in 1 to 5
  if I % 2 equal 0
    continue
  end
  Sum += I
end
rem Sum is 9
```

Like `break`, `continue` is an error outside a loop and cannot target a caller's
loop from inside a function. Pending `finally` blocks run before the next
iteration. A direct `continue` inside `finally` is an error, matching the rules
for `break` and `return`. `continue` does not close an iterable loop's iterator.

The unparenthesized form `for X in A` is always iteration. Parentheses make a
membership expression a loop condition when that distinction is needed:

```rank
for (X in index)
  ...
end
```

An optional second name explicitly receives the zero-based index:

```rank
for Value i in A
  Sum += Value
end
```

The names are ordinary bindings; the whitespace between them is required.
`for Value in A` binds only the value.

`#` in a binding position discards that value instead of creating or changing
a variable. It is useful for fixed repetition and for ignoring an index:

```rank
for # in 1 to N
  Item read
end

for Value # in A
  Value visit
end
```

For a tensor, ordinary iteration yields cells along its leading axis. Explicit
cell-rank and axis iteration are defined in [Tensors](tensors.md).

## Errors and exceptions

Runtime diagnostics identify the failing statement by file, line and column
(counted from one), followed by its source line and a caret:

```text
RankError [Runtime]: unknown name: abs; did you forget `use numbers`?
  at solution.ra:2:1
2 | -5 abs
    ^
```

An unknown standard-library name suggests the `use` statement needed to import
it. Local definitions still take precedence. The CLI writes diagnostics to
stderr and exits with status 1 for a failed file run, without a JavaScript
stack trace. `.Message` contains the error message; `.Trace` contains the
formatted Rank diagnostic. Errors inside functions retain their original
statement location when propagated or re-raised. This is an error location,
not a complete function-call stack.

Rank uses structured `try / catch / end` blocks for recoverable runtime errors:

```rank
try
  Value = Text integer
catch .InvalidNumber Error
  Value = 0
end
```

A `try` block has one or more `catch` clauses, a `finally` clause, or both.
Catch clauses are tested from top to bottom and the first matching clause runs.
A typed clause matches the case-sensitive error label; a clause with only a
variable catches any Rank runtime error:

```rank
try
  Value = Source load
catch .MissingFile Error
  Value = Default
catch Error
  Error raise
finally
  Resource close
end
```

The caught error is a first-class `error` value. Its standard fields use
ordinary label addressing:

```rank
Kind = Error .Kind
Message = Error .Message
Original = Error .Value pad Default
Cause = Error .Cause pad Default
Trace = Error .Trace
```

`.Kind` is a label, `.Message` and `.Trace` are text, `.Value` is the optional
value attached when the error was raised, and `.Cause` is an optional earlier
error. Addressing `.Value` or `.Cause` when it is absent produces `.Missing`,
so `pad` can provide a default. Error bindings follow the same inferred-type
and workspace rules as other names.

`raise` is a core data-first operation and does not require `use`. Error kinds
are ordinary labels and need no declaration:

```rank
.InvalidAge raise
.InvalidAge Age raise
.InvalidInput "age is required" raise
```

With no attached value, the default message is the error label. A text value
is also used as the message; another value is formatted with its label to make
the default message. Built-in operations currently use `.Runtime` as the
general kind, `.InvalidNumber` for invalid numeric text, and `.Missing` for
absent addressed values.

A caught error can be raised again:

```rank
catch Error
  Error raise
```

Raising the caught value preserves the original error and diagnostic trace.
An error raised while a handler is running propagates to the next enclosing
`try`; another clause of the same block does not catch it. If no clause
matches, the error continues outward. An uncaught error ends the current
program run.

`finally` runs exactly once after the `try` body and any selected `catch`,
before control leaves the whole construct. It runs after normal completion and
also before a pending error, `return`, `break` or `continue` continues outward. A
`try / finally / end` block without `catch` is valid and performs cleanup while
allowing the original error to propagate.

Direct `return`, `break` and `continue` statements inside `finally` are errors because they
would hide pending control flow. If cleanup raises an error while another Rank
error is pending, the cleanup error propagates and its `.Cause` contains the
original error. An error raised from `finally` cannot be handled by a `catch`
belonging to the same construct; an enclosing `try` may handle it.

`return`, `break` and `continue` are control flow rather than errors and are never caught.
Source syntax errors happen before execution begins and therefore cannot be
caught by a `try` inside that source.

Errors from lazy work occur when a value is demanded. A `try` around plan
construction does not catch an error that occurs later outside the block. Put
the terminal operation inside `try` when its errors must be handled:

```rank
try
  Plan = Data transform
  Result = Plan sum
catch Error
  ...
end
```

Rank does not currently have resumable errors, retries or continuations.

## Functions

Functions are documented with a short block of `rem` lines immediately before
`fun`. The block says what the function returns and explains only the
non-obvious idea or constraint:

```rank
rem Return the greatest common divisor.
rem Use the Euclidean algorithm.
fun gcd A B
  for B not equal 0
    R = A % B
    A = B
    B = R
  end

  return A
end
```

These are ordinary comments today. Future help and documentation tools may
associate the adjacent block with the function without adding another comment
syntax.

Top-level functions are registered after the whole file is parsed and before
its executable statements run. A function may therefore be called before its
textual definition, and helper functions may be placed at the end of a program:

```rank
Answer = 41 next

fun next X
  return X + 1
end
```

Loading a source file with `use` registers its top-level functions without
executing its ordinary top-level statements.

Calls use Rank's data-first order. Arguments come first and the function name
is the final word:

```rank
G = A B gcd
Result print
```

### Function equality

`equal` compares function identity. Two references to the same function are equal;
separately defined functions are distinct even when their source and results match.
Reading the same standard function repeatedly returns the same object within one
interpreter:

```rank
use numbers
F = abs
F equal abs rem true
abs equal abs rem true
abs equal sqrt rem false
```

Each call that creates a local function creates a distinct closure, even when the
captured values match. Copying a function reference preserves its identity. Defining
a function again creates a new object; saved references still refer to the old one.
Functions supplied by standard-library modules are distinct across interpreter
instances. User bindings can still shadow standard function names; caching does
not change lookup order.

## Memoized functions

`memo` declares a value-returning function with a cache:

```rank
memo fib N
  if N less 2
    return N
  end
  return ((N - 1) fib) + ((N - 2) fib)
end
```

Calls use the same syntax as `fun`. The complete, typed argument tuple is the
cache key. A cache hit returns the stored result without running the body.
Successful results are stored after the call completes, including its
`finally` blocks. Errors are not cached.

Arguments and results must be scalar integers, real numbers, booleans, text or
labels. Integer and real keys are distinct. Collections, functions, files and
sequences are rejected. A memoized function must not contain `yield`.
The programmer must ensure that the result stays valid for its arguments:
changes to captured data do not invalidate the cache, and side effects run
only on cache misses.

The cache belongs to the function object. Aliases share it; redefining the
function creates a new cache. Each call of an outer function creates fresh
local memoized functions:

```rank
fun solve N
  return N fib

  memo fib X
    if X less 2
      return X
    end
    return ((X - 1) fib) + ((X - 2) fib)
  end
end
```

Each `solve` call starts with an empty cache. Once its local function and
captured workspace are unreachable, the host garbage collector can reclaim
them and the cache. Returning or saving the local function keeps its cache
alive. There is no size limit, expiry or explicit clearing operation.

Recursive and mutual calls use the cache and the explicit Rank call stack.
Calls into memoized functions retain the continuation that stores the result;
they do not use the frame-replacing tail-call optimization. Ordinary `fun`
tail calls keep their existing behavior.

## Local functions and closures

A function may declare functions directly inside its body. Local functions are
registered when the enclosing call begins, so their definitions can stay after
the executable lines and even after the outer `return`:

```rank
fun make Base
  return add

  fun add Value
    return Base + Value
  end
end
```

The local function is visible throughout that invocation of `make`. It captures
the enclosing lexical workspace by reference, and a returned function keeps
that workspace alive. Separate calls create separate captured workspaces.
Assignment updates the nearest captured binding; every binding still keeps its
inferred type.

Name lookup follows one fixed order: the function's own workspace, its captured
outer workspaces from nearest to farthest, then the module workspace. A function
does not see local values belonging only to its caller. Top-level functions
therefore cannot accidentally depend on a caller's parameters.

A local function declaration must be a direct statement of another function.
It cannot be conditional or appear inside `if`, `for`, `try`, `catch` or
`finally`. Test blocks may declare test-local functions directly, as before.
Local functions may recurse and may contain further direct local functions.

Resources in a captured workspace move with an escaping function and remain
open for as long as the receiving resource scope owns that function.

## Generator functions

A function containing `yield` returns a lazy sequence. Calling it creates the
sequence without running the body; execution starts when an operation first
asks for an element:

```rank
rem Generate the Collatz values beginning with N.
fun weird N
  yield N

  for N not equal 1
    if N even
      N //= 2
    else
      N = 3 * N + 1
    end
    yield N
  end
end
```

`yield Value` emits exactly one sequence item and suspends the function. An
array or other collection is one item and is not flattened. Local variables
retain their values between yields. Errors in the body are raised only when
iteration reaches the failing statement.

User generators are single-pass because they may read input, use files or
perform other effects. A second attempt to consume the same generator sequence
raises `.ConsumedSequence`; call the function again to create a new sequence.
Their extent is unknown unless a future contract says otherwise.

A bare `return` ends a generator early. `return Value` is an error in a
generator, while a bare `return` is an error in an ordinary value-returning
function. `yield` is valid only in a generator function. A yielded value does
not become the function's return value.

Resources opened by a generator remain owned by its suspended execution. They
close when the generator finishes, raises an error, is abandoned by its
consumer, or its interpreter is disposed.

## Scoped resources

Resource values such as open files have deterministic lifetimes. A resource is
owned by the function, test or program execution that creates it and is released
when that scope exits normally, returns or raises an error. `if` and `for` do not
create separate ownership scopes because their variables follow Rank's
BASIC-like workspace rules.

Returning a resource moves it into the caller's ownership scope:

```rank
fun source Path
  File = Path open
  return File
end

File = "input.dat" source
Header = File 64 readbytes
```

The returned file remains open in the caller and closes when the caller exits.
Resources contained in a returned array or collection move with that value.
Explicit operations such as `File close` remain available for early release.
Rank does not currently have a general `defer` statement.

## Varargs

Current vararg syntax uses `*`:

```rank
fun lcm * Numbers
  ...
end
```

The call-site spelling for expanding a sequence into arguments is still open;
the former prefix sketch `lcm * Range` is not part of the current language.

## Division and remainder

`%` is floor modulo: a nonzero result has the divisor's sign. For integer
operands and a nonzero divisor, `A equal (A // B) * B + A % B` is always true.
For example, `-5 % 3` is `1`, `5 % -3` is `-1`, and `-5 % -3` is `-2`.
With a positive integer modulus `M`, `X % M` is already in `[0, M)`;
`(X % M + M) % M` is unnecessary.

Real and mixed operands use the same sign rule, subject to floating-point
rounding. A real zero result has the divisor's sign. Division or modulo by
zero raises a Rank error.

`/` always produces a real quotient. `//` is floor division and follows Python's
rounding direction for negative values:

```rank
Digit = X % 10
X = X // 10
Ratio = 5 / 2
Floor = -5 // 2
```

---

# Sequences and arrays

## Sequences

Ranges and algorithmic sources are sequences:

```rank
Range = 1 until 1000
Primes = primes
Fib = fibonacci to 4000000
```

Sequences are lazy by default. Constructing, transforming or filtering a
sequence builds a plan. A terminal operation such as `sum`, explicit
materialization, or iteration demands values from that plan. A terminal
operation that would consume an unbounded sequence is an error.

`fibonacci` starts with `1 2 3 5 8 ...`. Applied to an ordered algorithmic
source, `to` includes the boundary and `until` excludes it:

```rank
Fib = fibonacci to 100
```

`primes` starts with `2 3 5 7 11 ...`. It is infinite until bounded with `to`
or `until`, and supports ordinary zero-based sequence addressing:

```rank
BelowTwenty = primes until 20
SixthPrime = primes 5
```

`from` gives an ordered source an inclusive lower value bound:

```rank
Candidates = primes from 100
First = Candidates 0
rem First is 101
```

This is a source boundary rather than a positional slice. `primes` seeks to
the first candidate at least equal to the bound, and `fibonacci` advances its
recurrence to the first matching value. The result remains unbounded unless it
also receives `to` or `until`. A source that cannot interpret a lower value
bound reports an error.

The existing `A from Start until End` form remains positional slicing.

Sequence sources may accept bounds, filters and reductions in their own plan.
For example, applying an `even` mask to `fibonacci` allows the source to produce
only `2 8 34 ...`. A source that has no specialized implementation uses the
general lazy operation with the same observable result.

Sequence plans expose lower- and upper-bound hooks, so other ordered sources
can implement `from`, `to` and `until` without enumerating discarded prefixes.

## Explicit materialization

Postfix `array` consumes a sequence and stores its yielded items in a dense
rank-1 array:

```rank
Values = 3 weird array
```

Materialization is eager and preserves each yielded value as one array item;
it does not flatten yielded collections. An empty sequence produces an array
with shape `0`. A single-pass generator is consumed by this operation.

A sequence known to be infinite is rejected. A sequence whose finiteness is
unknown is evaluated until it ends, so materialization may raise a delayed
error or fail to terminate. No module import is required because `array` is the
core array constructor and conversion. A SQLite-backed table view also uses
postfix `array` to execute its query and produce a rank-1 array of object rows;
see [Tables](language/tables.md#sqlite).

Position disambiguates the three uses of `array`:

```rank
A = array 2 7 11       rem construct
Picked = A array 2 0   rem select
Copy = Source array    rem materialize
```

Values after `array` form a selector; postfix `array` at the end of the
expression materializes. A materialized value may continue through ordinary
postfix operations on the same line:

```rank
Count = Values array len
Values array len print
```

When `array` has following words, the evaluated receiver resolves the apparent
overlap: a sequence is materialized and the remaining words continue the
application chain, while an array uses `array` and its following values as a
selector. This keeps `A array 2 0` unchanged.

Postfix `copy` accepts a material or lazy array, eagerly evaluates all of its
cells and returns independent writable dense storage with the same shape:

```rank
use sequences
Writable = Source copy
```

Changing the copy does not change the source. `copy` does not accept a
sequence; postfix `array` remains the operation that materializes a finite
sequence into a rank-1 array.

## Sliding windows

`window` produces every overlapping, contiguous cell of a fixed size. The
source and size precede the operation:

```rank
Pairs = Text 2 window
Windows = Values Width window
```

Text windows are text values, so ordinary text comparison and addressing keep
working. Windows over a finite numeric vector form a rank-2 tensor whose first
axis selects the window and whose trailing axis contains the window cell. The
operation is lazy and does not copy all overlapping cells before they are
demanded. An unbounded sequence may likewise produce windows indefinitely.

For a tensor, a rank-1 integer array supplies one size per selected axis:

```rank
WindowShape = array 2 3
Blocks = M WindowShape window
```

Without `axis`, the size array must cover every tensor axis. If `M` has shape
`4 5`, the example has shape `3 3 2 3`: window-position axes come first and
window-cell axes are appended last.

`axis` selects and orders a subset of source axes:

```rank
Columns = M 3 window axis 1

WindowShape = array 2 3
Blocks = T WindowShape window axis 0 2
```

There must be one size for each selected axis. Axis numbers are zero-based and
unique. Source axes retain their original order in the position frame; appended
window axes follow the stated `axis` order. A scalar size without `axis` is
valid only for a rank-1 value.

`stride` moves by more than one position and `padding` adds symmetric zero
padding before positions are chosen:

```rank
Blocks = M WindowShape window stride 2
Blocks = M WindowShape window padding 1
Blocks = M WindowShape window stride 2 padding 1
```

Each value may instead be a rank-1 integer array with one item per selected
axis. `stride` comes before `padding`, and `axis` follows both when they are
combined. Strides must be positive and padding must be nonnegative. Their
defaults are one and zero. Nonzero padding is defined only for arrays and
inserts integer zero outside the source; text, queues and sequences still
support stride.

For source length `N`, window width `W`, stride `S` and padding `P`, the
position-axis length is `max(0, floor((N + 2*P - W) / S) + 1)`. Windows remain
lazy, read-only views of their source and the conceptual zero border.

## Shape and size

An atom has shape `[]`. A finite sequence has shape `[Size]`. A tensor stores a
flat sequence of atoms together with its rectangular shape `[D1, D2, ...]`.

A lazy sequence carries one of three size states:

- `exact`: its length is known;
- `unknown`: its length and possibly its finiteness are not known;
- `infinite`: it is proven to have no finite length.

Requesting the shape of an `unknown` sequence is a demand point and iterates it;
that request may not terminate. Requesting a finite shape from an `infinite`
sequence is an error.

`shape` from `sequences` returns every dimension as a rank-1 integer array:

```rank
Dims = A shape
unpack Rows Columns = A shape
```

Text, queues and finite lazy sequences have one dimension. `len` returns the
leading-axis length by default. An `axis` modifier selects another tensor axis:

```rank
Rows = A len
Columns = A len axis 1
```

Axis numbers are zero-based. Asking for a missing axis is an error. `axis` is a
general operation modifier; each operation defines what selecting axes means.

## Array construction

`array` is the common constructor for rectangular arrays of every rank. A
rank-1 array is a vector, a rank-2 array is a matrix, and arrays of rank 3 or
higher are tensors.

A vector is written on one line. Every value after `array` is an element, so
the constructor remains unambiguous beside Rank's whitespace-based addressing:

```rank
A = array 2 7 11 15
Pair = array J i
```

Multidimensional arrays use a block. `shape` is followed by the dimensions,
then the elements are supplied in row-major order:

```rank
M = array shape 2 3
  1 2 3
  4 5 6
end
```

The same form works for any number of dimensions:

```rank
T = array shape 2 2 2
  1 2 3 4
  5 6 7 8
end
```

Dimensions are nonnegative integers. The number of elements must equal the
product of the dimensions. Line breaks inside the block are formatting only;
they do not add an axis or change the declared shape.

`pad` fills every cell with one evaluated value and therefore needs no block:

```rank
Dist = array shape Rows Columns pad -1
```

The dimensions follow the same nonnegative-integer rule. A zero dimension
creates an empty material array with the declared shape.

`reshape` constructs a dense array dynamically from existing values:

```rank
Shape = array Rows Columns
M = Values Shape reshape
```

It is provided by `use sequences`. The shape must be a rank-1 array of
nonnegative integers. Values are consumed in row-major order, and their count
must exactly equal the product of the dimensions. Arrays, queues, finite
sequences and Unicode text can be reshaped. An unbounded sequence is an error.
An empty shape describes a scalar and therefore requires one value; a zero
dimension describes an empty array.

Array addressing uses one zero-based index per axis:

```rank
X = A i
Y = M i j
Z = T i j k
```

A material dense array can be changed through the same address:

```rank
M Row Column = Value
M # Column = Values
M # Column *= -1
M Row = 0
```

An incomplete address preserves its trailing axes, and `#` preserves the axis
at its position. A scalar right side fills the selected region. An array right
side must have exactly the selected shape or `.DimensionMismatch` is raised.
Negative and out-of-bounds indices are errors. Addressed assignment supports
`=` and every compound assignment operator. Assignment changes the existing
array object, so every alias of that array observes the new cells. The target,
selectors, previous cell values and right side are evaluated before any write.
This gives both ordinary and compound assignment snapshot semantics when
selections overlap.

Lazy arrays produced by operations such as `outer` and `window` are not
writable. Copy a finite result explicitly with postfix `copy` before changing
its cells.

Contiguous slices use `from` after the value. Arbitrary positions use an integer
array as the selector:

```rank
Part = A from 2 until 6
Picked = A array 4 1 1
Rows = M axis 0 from 1 to 3
```

Ranges and integer arrays preserve the selected axis. A scalar integer removes
its axis. The complete selector rules are defined in
[Values and addressing](values-addressing.md).

## Selection with boolean masks

Selection uses Rank's normal addressing model.

```rank
Mask = A greater 0
B = A Mask
```

The mask is an ordinary first-class value. It can be named, reused and combined
before it is applied.

```rank
Mask = N multiple by 3
Mask or= N multiple by 5

Selected = N Mask
```

Masks are demand-driven by default. Creating a mask builds a deferred boolean
plan; it does not require an immediate boolean array. Combining masks with
`and`, `or`, `xor` or `not` also remains deferred.

Applying a mask is a demand point, but it does not by itself require full
materialization. An implementation may stream the selected values, fuse the
mask with a following operation, or push predicates into a source such as a
table scan. It may also materialize a mask eagerly when that produces the same
observable result.

A lazy sequence mask retains its source and is itself a selected sequence when
used by a sequence operation. The explicit addressing form remains valid, and
the two examples below are equivalent:

```rank
Mask = Fib even
Answer = Fib Mask sum

Answer = Fib even sum
```

Iteration, indexing, reductions and transformations such as `window` consume
the matching source values. Boolean composition still combines the deferred
predicates. A materialized boolean array does not retain a source and therefore
still needs an explicit value on its left when used for selection.

Reusing a mask does not promise that its computed bits are cached. A mask
captures the logical values of its operands when it is created, rather than
looking up later assignments to their variable names. This snapshot rule does
not require copying the underlying storage.

Expressions deferred inside a mask must be pure. Operations with observable
side effects are not allowed there, so an implementation may change evaluation
order, fuse operations or recompute values without changing program meaning.

Addressing does not mutate `A` or `N`.

## Ordering and uniqueness

`sort`, `argsort` and `unique` have intrinsic rank 1. `sort` and `unique`
preserve text as text and a rank-1 array as a rank-1 array:

```rank
Letters = "caab" sort
Distinct = Letters unique
rem Letters is "aabc"; Distinct is "abc"
```

Text is ordered by Unicode code point. Arrays may contain one comparable
scalar type: numbers, text, booleans or symbols. Integers and real numbers form
one numeric ordering. `unique` preserves the first occurrence. It also accepts
queues, sets and lazy sequences; sequence filtering stays lazy.

`argsort` returns the stable, zero-based permutation that would sort each
rank-1 cell. Text produces an integer vector. An array produces an integer
array of the same shape:

```rank
Order = (array 30 10 20) argsort
rem Order is array 1 2 0

Rows = M argsort
Columns = M argsort axis 0
```

Without `axis`, intrinsic rank 1 means that a tensor is ordered independently
along its last axis. `axis N` instead orders every vector along axis `N` and
places the local source positions in the same tensor shape. The source is not
changed. A missing axis or mixed incomparable values in one vector is an
error.

`sort by` orders a finite rank-1 collection by a separate key. A sequence of
field symbols forms a lexicographic key for records:

```rank
Sorted = Events sort by .time .delta
```

A single unary function may compute the key instead:

```rank
Sorted = Values sort by magnitude
```

`argsort by` accepts the same sources and keys but returns their zero-based
source positions:

```rank
Order = Events argsort by .time .delta
Order = Values argsort by magnitude
```

Every key component must be a comparable scalar. Values at the same key keep
their source order, and a key function runs exactly once per value in source
order. The operation materializes a new rank-1 array and does not change its
source. It accepts rank-1 arrays, queues, sets, multisets and finite sequences;
an unbounded sequence is an error. Field sorting requires records and reports a
missing field as `.Missing`. A compound source expression must be parenthesized.

## Elementwise arithmetic

Arithmetic on compatible arrays is elementwise:

```rank
C = A + B
Squares = Range * Range
Powers = Bases ** Exponents
Pred = Pred - 1
```

Array operands use trailing-axis broadcasting. Shapes are aligned from the
right; corresponding dimensions are compatible when they are equal or either
dimension is `1`. Missing leading dimensions behave as dimensions of size `1`.
The result has the larger compatible size on every axis:

```rank
M = array shape 2 3 pad 1
Row = array 10 20 30
Result = M + Row
rem Result shape is 2 3
```

Broadcast results are lazy and cached. Incompatible shapes raise
`.DimensionMismatch`. Scalar broadcasting is the rank-0 case of the same rule.
Sequences retain their elementwise zip behavior and do not use tensor
broadcasting.

Because scalar `+` concatenates two text values, the same array rule provides
elementwise text concatenation and scalar broadcasting:

```rank
Labels = (array "A" "B") + "!"
rem A! B!
```

`**`, `%` and comparisons are also elementwise over compatible arrays:

```rank
M3 = N % 3 equal 0
```

## Operation modifiers

An operation may be followed by a word that changes how it is applied:

```rank
Total = A + reduce
Prefix = A + scan
Tree = A + segment
Products = A B * outer
Cells = A F rank 0
```

The trailing modifier binds the operation and its operands as one expression.
In `A B * outer`, `A B` is not evaluated first as addressing.
A completed modified operation can feed the next operation in the same chain:

```rank
Total = "1203" integer rank 0 sum
Total = A + scan sum
Total = A B * outer sum rank 1 sum
Total = M sum axis 0 sum
```

`rank` consumes its integer argument; `axis` consumes its axis numbers (and
an optional `rank R`). The following operation receives the modified result.
For example, `A + scan sum` means `(A + scan) sum`. `segment` constructs the
algorithmic collection described in [Collections](language/collections.md).
Operands are evaluated once. Parentheses remain available to make grouping
explicit.


## Each

`each` applies a scalar function to every atom while preserving shape:

```rank
Numbers = Text integer each
Flags = Values odd each
```

`each` is reserved as the friendly spelling of rank-0 application. Whether it
is an exact alias for `rank 0` in every value model, especially for text,
tables and nested values, remains open. The examples above are design sketches
until that equivalence is settled.

## Rank

General cell-wise application follows J-like trailing-cell semantics:

```rank
A F rank 0
A F rank 1
A F rank 2
```

Example:

```rank
Rows = Matrix normalize rank 1
```

Every function declares an intrinsic rank for each supported arity. Without an
explicit modifier, that rank determines the cells it receives. `rank R`
overrides the unary rank: if the argument rank is greater than `R`, the function
is applied to each trailing `R`-cell and the leading frame is preserved. If the
argument rank is at most `R`, the function receives the whole argument once.
Rank values are currently nonnegative integers.

An explicit `axis` list before `rank` names the frame axes. The remaining axes,
kept in their original order, form the cell passed to the unary function:

```rank
rem T has shape 2 64 128
A = T F rank 2
rem frame 2, cells 64 128

B = T F axis 1 rank 2
rem frame 64, cells 2 128
```

The axis order also determines the frame order in the result. For a tensor of
shape `2 3 4 5`, `T F axis 1 3 rank 2` applies `F` to `2 4` cells and produces
results in a `3 5` frame. The number of frame axes plus the cell rank must equal
the tensor rank. Frame axes are zero-based, unique and in bounds.

Every cell result must have the same shape. Scalar results leave only the frame
shape; array results append their shape to the frame. Source cells and the
assembled result are lazy views, and a demanded cell result is cached.

For example, `integer` has intrinsic unary rank 1. It converts a complete text
value by default, while an explicit rank 0 converts its character atoms:

```rank
Value = "1203" integer
Digits = "1203" integer rank 0
rem Value is 1203; Digits are 1 2 0 3
```

Rank-0 application over a lazy sequence remains lazy. Binary rank
specifications remain deferred.

## Reduce

A reduction collapses values:

```rank
Total = A + reduce
Product = A * reduce
```

Without an explicit rank, reduction consumes the complete finite value in
row-major order. `reduce rank R` instead reduces every trailing rank-`R` cell
to one atom while preserving its leading frame:

```rank
RowTotals = M + reduce rank 1
BlockProducts = Blocks * reduce rank 2
```

Reduction is a left fold. A scalar and a rank-0 cell reduce to themselves.
The current symbolic reducers are `+`, `-`, `*`, `**`, `/`, `//`, `%`, `and`,
`or` and `xor`.
Empty `+`, `*`, `and`, `or` and `xor` reductions produce `0`, `1`, `true`,
`false` and `false` respectively. Other operations reject an empty cell. A
reduction of an unbounded sequence is an error.

Named reductions use the same data-first style:

```rank
Total = A sum
Largest = A max
Average = A mean
```

Numeric sets also support `sum`, `min` and `max`. Duplicate insertion remains
idempotent, so each distinct set member contributes once.

Boolean collections have named reductions in `use sequences`:

```rank
Every = Mask all
Some = Mask any
TrueCount = Mask count
Rows = Flags all axis 1
RowCounts = Flags count axis 1
```

`all` is equivalent to `and reduce`; `any` is equivalent to `or reduce`.
`count` returns the integer number of `true` values. All three operations
require boolean cells. `all` and `any` short-circuit as soon as the result is
known, while `count` examines the complete cell. An empty collection produces
`true` for `all`, `false` for `any` and zero for `count`. All three support
`rank` and `axis`. A known unbounded sequence is rejected.

A lazy sequence mask is also accepted by `count`. It returns the number of
source items selected by the mask and lets the source plan provide a direct
count without enumerating those items.

A finite lazy source may define a direct cardinality count. The numbers module
uses this hook for `N divisors count`; other numeric sequences still fail the
boolean-cell requirement.

Postfix `min` and `max` reduce one finite collection. Infix binary forms choose
between numeric values and broadcast over arrays:

```rank
Largest = A max
Bound = Low max High
Clamped = Values max 0
```

Binary chains associate from the left. `axis` and `rank` modify the postfix
reduction; the binary form already follows ordinary elementwise broadcasting.

Infix calls resolve the function normally, after evaluating the left and right
operands. A user-defined `min` or `max` takes precedence, even without
`use numbers`. For example, after `fun max A B` returning `A + B`, both
`3 max 4` and `3 4 max` return `7`. A named builtin (`Op = max`) supports
the same lazy binary broadcasting as infix calls. Equal numeric operands
preserve the left operand, including its integer/real representation.

## Scan

Prefix accumulation:

```rank
Prefix = A + scan
```

`scan` accepts a rank-1 array, queue, text or bounded sequence and returns a
material rank-1 array. The first result is the first source value; each later
result applies the binary operation left-to-right to the previous result and
the next value. An empty source returns an empty array. Unbounded sequences and
higher-rank arrays are rejected. `scan` currently has no `rank` or `axis` form.

## Outer

`outer` is a higher-order modifier. It applies the operator or named binary
function immediately before it to every pair of cells:

```rank
Sums = A B + outer
Products = A B * outer
Grid = Values Values bxor outer
Operation = min
Smallest = A B Operation outer
```

Cell ranks belong to the operation; `outer` combines the remaining frames.
Symbolic binary operations have intrinsic ranks `0 0`. The named functions
`band`, `bor`, `bxor`, `shl`, `shr`, `min` and `max` also declare ranks `0 0`.
User-defined binary functions currently default to `all all`; syntax for
declaring their intrinsic ranks remains deferred.

The result shape is the concatenation of the left and right frame shapes.
Therefore, if `A` has shape `2 3` and `B` has shape `4 5`, the result of atom
pairing `A B * outer` has shape:

```text
2 3 4 5
```

`outer` combines axes. `matmul` contracts axes.

The left frame axes come first and the right frame varies fastest. The operation
must accept two arguments and currently must return a scalar for every pair.
Both operands must be finite and restartable.

Construction is lazy and may compute a demanded pair again. A named function
supplied to `outer` must therefore be pure: its result and observable behavior
may depend only on its arguments and immutable captured values. The runtime does
not yet prove this property; static effect analysis is tracked separately as
tooling work.

Explicit binary rank overrides remain deferred.

An axis-qualified cell view may become an operand of `outer`. Its `axis` order
will define frame order and its `rank` will define the cells, allowing rows of
one tensor to be paired with columns of another without moving data. The
expression syntax is deferred because `axis` already introduces selection;
`outer` itself does not permute axes.

Applying a same-shaped boolean mask to a tensor returns a rank-1 lazy sequence
of the selected atoms in iteration order. Tables retain their separate
row-selection rule.

---

# Collections

`use algo` provides standard algorithmic collections. `index`, `queue`, `set`
and `counter` support implicit local naming; ordered multisets are named.

## Named structures

Use `new` to create an independent empty structure. Each evaluation creates
a new instance and requires `use algo`:

```rank
use algo
Graph = new index
Distance = new index
Seen = new set
Counts = new counter
Pending = new queue
Bag = new multiset

Graph 1 2 = 10
Distance 1 = 0
Seen add 1
Counts add 1
Pending push 1
Bag add 1
```

Constructors include `new index`, `new queue`, `new set`, `new counter`,
`new multiset`, `new orderedset`, `new stack`, `new deque` and `new heap`.
They do not replace the implicit local instance.

Assignment and argument passing preserve the structure's reference.
`Alias = Seen` shares `Seen`; `Seen = set` shares the current implicit set.
Neither assignment creates a copy. Named structures can be captured by local
functions and returned from functions.

Named sets and counters accept `Name add Value`. A set keeps one equal
element; a counter increments that element's frequency. The whole expression
after `add` is evaluated once. Ordinary postfix calls `Name Value add`
also work, and `add` returns the receiver when used as a function. Named
queues accept `Name push Value`; named indices use addressed assignment.

Bare `index`, `queue`, `set` and `counter` refer only to the current
function call's implicit instances, or the module instances at top level.
Reading and writing use the same instances. To share a structure with another
function, pass or capture its explicit name.

## Implicit local structure

If a function uses only one instance of a standard structure, the type word
itself denotes that lazily-created local instance.

### Index

`index` is a sparse keyed structure.

```rank
index Value = Position
```

Read:

```rank
j = index Need
```

Membership:

```rank
if Need in index
  ...
end
```

Default:

```rank
Last = index C pad -1
```

Multi-dimensional keyed addressing:

```rank
index A B C = Value
X = index A B C
```

The complete tuple is the key, so an `index` can represent a sparse matrix or
higher-dimensional tensor. It does not infer rectangular dimensions or carry a
dense shape; programs keep those dimensions separately when needed. The key
and value types are inferred from uses within the function.

Bare `index` always refers to the current function call's local structure
(or the module structure at top level), for both reading and writing.
Recursive calls do not share it, and an outer implicit index is not inherited.

Use an ordinary name to share a dictionary explicitly:

```rank
use algo
Index = index

fun store Cache K V
  Cache K = V
  return 0
end

X = Index 7 99 store
Index 7 rem 99
```

`Index = index` aliases the current structure; it does not allocate a copy.
Passing it as `Cache` preserves that reference. Named indices support reads,
membership, padded reads and writes with the same complete tuple keys as
implicit indices. Compound writes such as `Cache K += 1` require an existing
entry. Keys may be integers, real numbers, booleans, text or labels. A named index can also
be captured by a local function.

### Queue, stack, deque and heap

All operations below require `use algo`. Use `use sequences` for `len`.

```rank
Pending = new queue
Pending push 7
First = Pending peek
Removed = Pending pop

Path = new stack
Path push 3
Path push 8
Last = Path pop                 rem 8

Ends = new deque
Ends 2 pushback
Ends 1 pushfront
Left = Ends peekfront
Right = Ends popback

Work = new heap
Work 10 "vertex A" enqueue      rem receiver, priority, payload
Work 3 "vertex B" enqueue
Next = Work pop                 rem vertex B
```

`push` appends to a queue or stack. `pop` removes and returns the oldest queue
entry or the newest stack entry; `peek` returns that entry without removing it.
A deque supports `pushfront`, `pushback`, `popfront`, `popback`, `peekfront` and
`peekback`. Its plain `push` appends at the back, and `pop`/`peek` use the front.
Binary functions use postfix syntax, such as `Ends Value pushfront`.

A heap is a stable min-priority queue. `Heap push Value` uses the value itself
as its priority. `Heap Priority Value enqueue` accepts a separate payload of
any type. Priorities must be comparable scalars of one ordering family;
integer and real priorities can mix. NaN priorities are rejected. Equal
priorities preserve insertion order. For a numeric max-heap, negate priorities
when calling `enqueue`. `pop` and `peek` return payloads, not priorities.

Empty `pop` and `peek` operations raise a missing-value error, so
`Pending pop pad -1` supplies a fallback. `len` counts remaining entries.
Queue, stack and deque indices start at zero at the current front/bottom.
They retain queue-style array operations. Heap iteration visits payloads in
internal heap order, not sorted order; repeatedly call `pop` to get priority order.
Queue iteration can observe entries appended during the loop. Do not remove
entries while iterating a container; use a conditional `for` with `pop` instead.

End operations use constant expected time with numeric-keyed storage; heap
insertion and extraction use O(log n) comparisons and `peek` takes O(1).
Materializing a queue-family container as an array takes O(n). Named containers
are shared references when assigned, captured or passed to functions. Their
runtime types are `.queue`, `.stack`, `.deque` and `.heap`.

### Implicit queue

```rank
queue push X
return queue
```

The first use of `queue` lazily creates one queue in the current function-call
workspace. Separate and recursive calls receive separate queues. The queue is
ordered, zero-based, iterable and addressable after it is returned.
For elementwise operations, a queue behaves as a rank-1 array. This lets a
function return a queue and a test compare it directly with an array literal.

`push` takes one argument, so the rest of its line is one complete expression:

```rank
queue push A i + Carry
```

Structure methods place the receiver first and the method second. A method with
no arguments ends after its name; a method with one argument consumes the rest
of the line. The block syntax for methods with two or more arguments is not yet
settled. The earlier `with ... end` proposal is disputed and is not current
syntax.

Addressed mutation uses assignment rather than a `put` method:

```rank
index Row Column = Value
A Row Column = Value
```

An `index` writes a sparse tuple key. An array write requires one in-bounds
index per dense axis and changes the existing material array.

### Set

```rank
set add X
set remove X
if X in set
  ...
end
Count = set len
```

The first use of `set` lazily creates one set in the current function-call
workspace. `add` is idempotent: adding an equal value again leaves the set
unchanged. `remove` deletes that value and raises `.Missing` when it is absent.
Scalars, arrays and records can be elements. Array equality includes
both shape and contents; record equality includes field names and recursively
equal values. `in` tests membership, and `len` returns the number of unique
elements.

As with `queue`, separate and recursive function calls receive separate sets.
A set is iterable in insertion order. Adding an existing value does not move
it. An array is useful for a composite value such as a coordinate:

```rank
set add array X Y
```

A numeric set is a finite collection for `sum`, `min` and `max`:

```rank
Total = set sum
Smallest = set min
Largest = set max
```

Each distinct value contributes once. An empty set sums to zero; `min` and
`max` reject it as an empty reduction.

### Ordered multiset

`new orderedset` creates the unique-value variant of a multiset: repeated
`add` calls for an existing value have no effect. It shares multiset operations
and the `.multiset` runtime type.

`Bag lowerbound X` (also `Bag X lowerbound`) returns the smallest value >= X;
it is an alias for `ceiling`. `Bag upperbound X` returns the smallest value > X.
These return values, not iterator positions. If no value qualifies, they raise
a missing-value error that can be handled with `pad`. Both use the multiset's
expected O(log n) tree lookup and preserve exact integer comparisons.

An ordered multiset keeps duplicate comparable scalar values in sorted order.
It is always named because algorithms often need more than one instance:

```rank
Tickets = Prices multiset
Empty = new multiset
```

`Values multiset` fills a new multiset from text or a finite rank-1 array,
queue, set, multiset or sequence. `new multiset` creates an empty instance and
infers its ordering from the first added value. All values must share one
scalar ordering: numeric, text, boolean or symbol. Integers and real numbers
share the numeric ordering.

Methods put the receiver before the operation:

```rank
Tickets add Price
Tickets remove Price
Best = Tickets floor Limit
Next = Tickets ceiling Limit
Third = Tickets 2
```

These method words are contextual library names, not reserved words. Rank
dispatches `floor`, `ceiling`, `lowerbound` and `upperbound` as multiset
methods only when the expression before the operation evaluates to a
multiset. Otherwise the operation resolves as an ordinary function, so a
program may define and call `fun ceiling A B` as `3 ceiling 4`.

`remove` deletes one equal occurrence. Removing an absent value raises
`.Missing`. `floor` returns the greatest value at most its argument;
`ceiling` returns the least value at least its argument. When no such value
exists they also raise `.Missing`, so ordinary `pad` supplies a fallback:

```rank
Best = Tickets floor Limit pad -1
```

`Bag I` addresses the occurrence at zero-based position `I` in sorted order.
Equal values occupy separate positions. A negative or out-of-bounds position
raises `.Missing`, so it also composes with `pad`.

Iteration is sorted and repeats duplicate values. With `use sequences`, `len`
counts all occurrences and `shape` is its one-dimensional size. Numeric
`min` and `max` from `use numbers` read its endpoints.

Construction takes expected `O(N log N)` time. Indexing, `add`, `remove`,
`floor` and `ceiling` take expected `O(log N)` time. Membership with `in` has
the same expected bound. The runtime type is `.multiset`.

### Fenwick tree

A Fenwick tree is a fixed-size integer array with logarithmic prefix sums:

```rank
F = N fenwick
F I = Value
F I += Delta
Value = F I
Prefix = F sum I
```

Indices are zero-based. Cells start at zero. Addressed assignment writes one
cell, and compound assignment updates it. `F sum I` returns the inclusive sum
from index zero through `I`; `F sum -1` is the empty prefix and returns zero.
Other negative and out-of-bounds indices raise `.Missing` and compose with
`pad`. Cell access is constant time; assignment and prefix sums take
`O(log N)` time. The runtime type is `.fenwick`.

`sum` is also contextual rather than reserved. The middle form is a Fenwick
method only when `F` evaluates to a Fenwick tree. For any other receiver the
ordinary application chain remains intact; for example, `A sum print` first
reduces `A` and then prints the result. Receiver dispatch happens at each application, so
`F sum I print` computes the prefix and then prints it, with or without
`use numbers`. The receiver and index are evaluated once.

### Segment tree

A segment tree stores a finite rank-1 value under one associative binary
operation:

```rank
Tree = Values min segment
Sums = Values + segment
Tree = Values Operation segment
```

`segment` is an operation modifier, like `scan` and `reduce`. The named form
resolves `Operation` once when the tree is built. It therefore honors a
user-defined `min` or any other binary function. Rank does not try to prove
that the operation is associative.

A point uses ordinary zero-based addressing. Assignment changes the point and
updates its ancestors:

```rank
Value = Tree Position
Tree Position = Value
Tree Position += Delta
```

A numeric tree built with the standard `+` operation also accepts inclusive
range assignment and addition:

```rank
Tree Left Right = Value
Tree Left Right += Delta
```

These operations broadcast the numeric value across the range. They use lazy
propagation internally, so range updates and sum queries take `O(log N)` time.
Assignment replaces earlier pending additions; later additions apply to the
assigned value. Other segment operations remain point-update trees.

With `use sequences`, postfix `copy` creates an independent version of a
numeric `+ segment` tree:

```rank
Version = Tree copy
Version Position = Value
```

The first copy converts the source to persistent storage in `O(N)` time.
It does not change its values. That copy and all later copies share unchanged
nodes in `O(1)` time. Updating any persistent version copies only its affected
root paths in `O(log N)` time; no update changes another version.

`query` reduces an inclusive range while preserving left-to-right operand
order:

```rank
Answer = Tree Left Right query
```

Both bounds must be valid positions and `Left` must not exceed `Right`.
Out-of-bounds positions raise `.Missing` and compose with `pad`. No identity
value is required because an empty range is not a valid query. Empty trees may
be constructed but cannot be queried or addressed.

`firstatleast` finds the first position where the aggregate of the prefix
reaches a numeric target:

```rank
Position = Tree Target firstatleast
```

It returns `-1` when no prefix reaches the target. Prefix aggregates must be
monotone relative to the target. Typical valid trees use `max`, or `+` with
nonnegative values. Rank does not attempt to prove this condition.

`maxsum` is the native numeric profile for prefix and subarray sums:

```rank
Tree = Values maxsum segment
State = Tree Left Right query
```

`State` is a record with `.sum`, `.prefix`, `.suffix` and `.best`. The three
maxima allow the empty subarray and are therefore never negative. Addressing
still reads the numeric point, and point assignment accepts a number. The
profile keeps the standard four-value segment aggregate inside the runtime so
large queries do not pay for millions of interpreted combining calls.

The built-in is recognized by function identity. A user function named
`maxsum` remains an ordinary binary operation when used with `segment`.

Construction takes `O(N)` time. Point access is constant time; point updates
and range queries take `O(log N)` time, excluding the cost of the selected
operation. `firstatleast` also takes `O(log N)`. With `use sequences`, `len`
and `shape` report the fixed size.
The runtime type is `.segment`.

### Wavelet matrix

A wavelet matrix prepares immutable range-count queries over comparable scalar
values:

```rank
Data = Values wavelet
Count = Data Left Right Low High within
Sum = Data Left Right Low High sumwithin
One = Data (array Left Right) missing
Answers = Data Queries missing
```

Both position and value ranges are inclusive. `within` counts positions from
`Left` through `Right` whose values lie from `Low` through `High`. Values must
all be numbers, text, booleans or symbols of one comparable kind. Bounds of a
different kind are errors.

`sumwithin` uses the same ranges and sums their matching values. It requires a
numeric wavelet. Its sum tables are prepared lazily on the first aggregate
query. `missing` requires positive integer values and returns the smallest
positive sum that no subset of the selected positions can form. Its right
argument has intrinsic rank 1: one pair produces one answer, while a `Q 2`
query matrix produces a length-`Q` answer vector.

Construction takes `O(N log S)` time and memory, where `S` is the number of
distinct values. `within` and `sumwithin` take `O(log S)` per query. If `T` is
the returned missing sum, `missing` takes `O(log S log T)`. The prepared value
cannot be changed. With `use sequences`, `len` and `shape` report its fixed
size. Its runtime type is `.wavelet`.


### Permutations

`permutations` has intrinsic rank 1. It accepts text or a finite rank-1 array,
queue, set or sequence. Text produces a lazy sequence of texts; other inputs
produce a lazy sequence of rank-1 arrays:

```rank
for Route in Cities permutations
  Route visit
end
```

The empty collection has one empty permutation. Input order determines
generation order; sets use insertion order. Results are distinct by value:
equal input values never produce duplicate permutations. The exact sequence
size is the multinomial count, so `len` does not need to enumerate it. An
unbounded sequence is an error.

### Combinations

`combinations` accepts a finite collection and a nonnegative count, then
returns a lazy sequence of selections without repetition:

```rank
for Pair in Values 2 combinations
  Pair score
end
```

Selections follow input order. A count greater than the collection length
produces an empty sequence; count zero produces one empty selection. Equal
values at different positions remain distinct choices. An unbounded sequence
is an error.

For a tensor, `combinations` selects cells along the leading axis and preserves
the remaining cell shape. Given `Rings` with shape `6 3`, every value from
`Rings 2 combinations` therefore has shape `2 3`.

`multicomb` is the corresponding generator with repetition:

```rank
for Pair in Values 2 multicomb
  Pair score
end
```

It uses the same order and tensor cell rules. A selection may use the same
input position more than once. Count zero produces one empty selection,
including for an empty input; a positive count from an empty input produces
an empty sequence. Its exact size is the multiset coefficient, so `len` does
not enumerate the results.

### Counter

`counter` is a frequency map:

```rank
counter add X
Count = counter X
Kinds = counter len
```

The first use lazily creates one counter in the current function-call workspace.
`add` increments the frequency by one. Addressing an absent key returns zero,
and `len` returns the number of distinct keys. Scalar and array keys use the
same equality as `set` elements. Separate and recursive calls receive separate
counters. `counter` is a first-class value with runtime type `.counter`.

Counter iteration and direct frequency assignment are not defined yet.

If multiple structures of the same type are needed, they should be given
explicit names.

## Design rule

These are general data structures, not puzzle-specific shortcuts. Candidate
additions are tracked in the
[competitive-programming library roadmap](design/competitive-programming-library.md).

---

# Graphs

`use graph` provides a mutable graph value for traversal algorithms. Its public
behavior does not expose adjacency-list, CSR or other physical storage.

## Construction

A closed graph receives its complete finite vertex domain. This includes
isolated vertices and makes an unknown endpoint an error:

```rank
use graph
use ranges

Nodes = 1 to NodeCount
Graph = new graph Nodes .undirected
```

An open graph starts empty and registers endpoints as edges arrive:

```rank
Graph = new graph .directed
Graph add From To
```

Direction is always explicit. `.directed` stores only `From` to `To`;
`.undirected` also makes `From` a neighbor of `To`. A self-loop appears once in
an undirected neighbor sequence. Parallel edges are preserved.

Vertices are integer, real, boolean, text or symbol scalars. A finite rank-1
array or sequence supplies several vertices to either the closed constructor or
`add`. The latter is useful for isolated vertices in an open graph:

```rank
Graph add Node
Graph add Nodes
```

A rank-2 array with shape `M 2` supplies `M` edges:

```rank
Edges = array shape 3 2
  1 2
  2 4
  4 1
end
Graph add Edges
```

An edge has weight `1` unless `add` supplies a numeric weight. Weighted bulk
input has shape `M 3`, with source, target and weight columns:

```rank
Graph add From To Cost

Flights = array shape 2 3
  1 2 6
  2 3 -4
end
Graph add Flights
```

Integer and real weights are accepted. Negative weights are preserved for
algorithms such as Bellman-Ford; the graph does not choose an algorithm or
interpret their sign.

`Graph add A B` and `Graph add Edges` dispatch only after `Graph` evaluates to
a graph. The word `add` remains available to user functions and other
collections.

## Neighbors and size

Address a graph with one vertex to obtain a finite lazy sequence of its
neighbors:

```rank
for Next in Graph Current
  queue push Next
end
```

The sequence is a snapshot of that vertex's neighbors when `Graph Current` is
evaluated. Later graph mutations do not change an existing sequence. Neighbor
order follows edge insertion order.

The contextual `edges` method returns the same outgoing entries as lazy
rank-1 pairs `array Next Cost`. `unpack` gives readable access without changing
the compact neighbor form:

```rank
for Edge in Graph edges Current
  unpack Next Cost = Edge
end
```

For an undirected graph, the reverse entry has the same weight. Unweighted
entries appear with cost `1`. Like `add`, `edges` dispatches only when its
receiver evaluates to a graph and does not reserve the word for other values.

For an open graph, an unknown vertex has an empty neighbor sequence and does not
register the vertex. A closed graph raises `.Missing` for an unknown vertex.
`Graph len` returns the vertex count, and `Graph type` returns `.graph`.

Graphs are reference values: assignment and argument passing share mutations.
Removing vertices or edges is not part of the current API.

## Disjoint sets

`use graph` also provides a mutable disjoint-set union structure. A closed DSU
starts with a finite rank-1 collection and rejects unknown values:

```rank
Union = new dsu Nodes
Union merge A B
Root = Union find A
Same = Union connected A B
Count = Union components
```

`merge` uses union by size and returns true only when it combines two previous
components. `find` returns the representative value selected by the structure;
`connected` compares representatives. `components` returns the current number
of components, while `len` returns the number of registered values.

`new dsu` without a collection creates an open DSU. `find`, `merge`, and
`connected` register unknown scalar values before answering. DSU values may be
integer, real, boolean, text, or symbols, like graph vertices. The method words
dispatch only when their receiver is a DSU and remain available to ordinary
user functions.

## Functional graphs

A rank-1 successor array can prepare a functional graph whose vertices are the
integers from `1` through `N`. Item `I - 1` is the sole outgoing successor of
vertex `I`, and every successor must also lie in `1..N`:

```rank
Planets = Next functional
End = Planets jump Start Steps
Steps = Planets distance From To
Lengths = Planets lengths
Count = Planets Start Limit upto
Weighted = Next Cost weighted
State = Weighted Start Limit upto
```

`jump` follows exactly the requested nonnegative number of transitions and
accepts arbitrarily large integers. Its cached binary-lifting table grows only
to the largest requested bit. `distance` returns the minimum number of forward
transitions from `From` to `To`; an unreachable target is missing and composes
with `pad`:

```rank
Steps = Planets distance From To pad -1
```

`lengths` returns a rank-1 integer array aligned with the successor array. Each
item is the number of distinct vertices visited from that vertex before the
first repeated vertex. Construction decomposes the graph into cycles and their
incoming trees once; queries do not mutate the value.

`upto` counts vertices on the path from `Start` whose numbers do not exceed
`Limit`, including the start when it is in range. It requires every successor
to be either its own vertex or a larger vertex. This makes the path monotone,
so the cached jump table answers each query in `O(log N)` time. It returns zero
when `Start` exceeds `Limit`. Next-greater links are a typical use.

`Next Cost weighted` prepares the same increasing successor path with one
numeric outgoing-edge cost per vertex. Its `upto` result is a record:

- `.count` is the number of visited vertices;
- `.sum` is the sum of traversed edge costs;
- `.last` is the last visited vertex.

The edge leaving `.last` is not traversed and is not included in `.sum`.
Integer costs keep an integer sum; any real cost produces a real sum. The
successor and cost arrays must have equal lengths. Weighted jump sums grow
alongside the same lazy binary-lifting table.

This API is experimental. It stays in the graph library while examples beyond
the adjacent CSES functional-graph tasks test whether the prepared object is a
useful general abstraction. If later programs do not reuse the combined
`jump`, `distance`, `lengths`, `upto`, and `weighted` interface, simplify it to independent
operations or remove it before treating the API as stable.

## Rooted trees

`Tree Root root` prepares an immutable rooted view of a connected undirected
tree. The source graph may use any supported scalar vertices. Preparation
validates that the graph is a tree, takes `O(N log N)` time and snapshots its
current edges:

```rank
Rooted = Tree 1 root
Boss = Rooted Employee K ancestor
Common = Rooted A B lca
Length = Rooted A B distance
```

The query words use the same data-first postfix form as
`Tree Left Right query`. `ancestor` returns the vertex `K` parent edges above
the requested vertex. An ancestor above the root is missing and composes with
`pad`. `lca` returns the lowest common ancestor, and `distance` returns the
number of edges between two vertices. Each query takes `O(log N)` time.

The prepared value is a record with these fields:

- `.root`: the selected root vertex;
- `.parent`: an index of parent vertices, with no entry for the root;
- `.depth`: an index of distances from the root;
- `.order`: vertices in heavy-first depth-first preorder;
- `.entry`: an index of zero-based positions in `.order`;
- `.size`: an index of subtree sizes;
- `.head`: an index of heavy-path head vertices.

A vertex's subtree occupies the contiguous half-open interval beginning at its
`.entry` position and containing `.size` items. This supports flattening
subtree operations into ordinary range operations. The record and its indices
are read-only snapshots; later graph mutations do not change them.
The largest child subtree is visited first. Consequently, vertices from any
one heavy path also occupy consecutive `.entry` positions; `.head` identifies
the first vertex of that path for heavy-light decomposition.

## Pair distances

`Tree pathlengths` snapshots a connected undirected tree and returns a finite
lazy sequence containing the edge distance between every unordered pair of
distinct vertices. Each pair occurs once, and an `N`-vertex tree therefore has
`N * (N - 1) // 2` logical path lengths:

```rank
Lengths = Tree pathlengths
Exact = (Lengths equal K) count
Mask = Lengths at least Low
Mask and= Lengths at most High
Within = Mask count
```

Iteration or materialization enumerates the logical sequence and takes
quadratic time. Integer comparisons followed by `count` are planned without
materializing it. Exact and bounded-range counts use centroid decomposition in
`O(N log^2 N)` time and `O(N)` auxiliary space. Comparisons may be written on
either side of the sequence, and bounds combined with `and` remain visible to
the planner. Arbitrary predicates and `or`, `xor`, or `not` compositions fall
back to ordinary lazy enumeration.

The values count edges, like rooted-tree `distance`; stored graph weights do
not alter them. The sequence deliberately discards pair endpoints. Use
`Rooted A B distance` when a particular pair or its vertices matter.

## Basic algorithms

Graph algorithms are ordinary data-first functions exported by `use graph`.
They operate on the abstract graph value and may choose a different internal
representation in future implementations.

`Graph Start bfs` traverses outgoing unweighted edges in breadth-first order;
`Graph Start dfs` uses depth-first order without consuming the host call stack.
`Graph Start dijkstra` computes shortest distances for nonnegative numeric
weights and rejects a negative edge. All three return a record with three fields:

- `.distance`: an index from every reached vertex to its distance;
- `.parent`: an index containing the search-tree parent of each reached vertex
  except the start;
- `.order`: vertices in discovery order for BFS and settlement order for
  Dijkstra.

```rank
Result = Graph Start dijkstra
Distance = Result .distance
Answer = Distance Target pad infinity
```

`Graph components` accepts an undirected graph and returns `.count`, a
`.component` index numbered from one in vertex insertion order, and a `.roots`
array. `Graph bipartite` also accepts an undirected graph and returns
`.possible` plus a `.color` index whose values are one or two. An odd cycle
makes `.possible` false.

`Graph topological` accepts a directed graph. It returns `.possible` and an
`.order` array. A directed cycle makes `.possible` false and `.order` empty.
`Graph scc` finds strongly connected components of a directed graph and returns
the same `.count`, `.component`, and `.roots` fields as `components`.

All indices use the graph's scalar vertices as keys. Missing distances and
parents remain missing values, so existing `pad` handling applies.

`Graph cycle` returns one cycle from either a directed or undirected graph as a
rank-1 array. The first vertex is repeated at the end, so each adjacent pair is
an edge in traversal order. An acyclic graph returns an empty array. Search is
iterative; self-loops and cycles formed by parallel undirected edges are
preserved.

`Graph Start euler` returns an Euler trail that begins at `Start` and uses every
edge exactly once. It works for directed and undirected graphs, infers the end
vertex from the degree balances, and returns an empty rank-1 array when no such
trail exists. A graph without edges returns `array Start`. Parallel edges and
self-loops remain distinct, edge weights do not affect the trail, and equal
inputs produce insertion-order-stable results. The iterative search takes
`O(V + E)` time and does not mutate the graph.

`Graph Start bellmanford` accepts negative weights. Its `.distance` and
`.parent` indices cover vertices reachable from `Start`; `.negative` is a set
of every reachable vertex whose shortest distance is unbounded below because
of a reachable negative cycle. Distances stored for those vertices are
intermediate values and must not be used as shortest paths.

`Graph floyd` computes all-pairs shortest paths and returns `.distance` as a
two-key index addressed by `Distance From To`. Missing pairs are unreachable.
Its `.negative` set contains vertices that lie on a negative cycle.

`Graph mst` accepts an undirected weighted graph and applies Kruskal's
algorithm. It returns `.connected`, `.components`, total `.weight`, and
`.edges` as an `M` by `3` array. For a disconnected graph these fields describe
the minimum spanning forest and `.connected` is false. Parallel edges are
eligible independently; self-loops are never selected.

`Graph Source Sink maxflow` accepts a directed graph whose weights are finite,
nonnegative capacities. Source and sink must differ. It uses a level-graph
blocking-flow algorithm and returns:

- `.value`, the maximum flow value;
- `.flow`, a two-key index addressed by `Flow From To`, with parallel-edge
  flows aggregated and absent pairs readable through `pad 0`;
- `.cut`, the set of vertices reachable from `Source` in the final residual
  graph, which is the source side of a minimum cut.

---

# Tables

Tables reuse Rank's normal addressing model.

## SQLite

With `use tables`, an existing SQLite database can be opened read-only:

```rank
Db = "demos/pgexercises/data/club.sqlite3" sqlite
Facilities = Db .facilities
Query = Facilities sql
Rows = Facilities array
```

To inspect the SQL and plan in a program, add `use io` and print
`Query .text` or `(Facilities explain) .detail`.

`Db .facilities` validates the table name and returns a SQLite-backed table
view without loading rows. The variable keeps the database path and query plan.
`Query` is a record with `.text` (parameterized SQL) and `.params` (an ordered
array of bound values). `Facilities explain` runs `EXPLAIN QUERY PLAN` and
returns an ordinary Rank table of plan rows. Postfix `array` executes the query
and returns a rank-1 array of object rows; after that, normal Rank table
operations apply. SQLite `NULL` becomes an absent object field, integer 0/1
stays integer, and row order is unspecified unless the SQL query orders it.

SQLite table views support lazy field projection, comparisons and boolean
masks, `innerjoin by/on`, `leftjoin by/on`, `select`, `unique` and field-keyed `sort by`.
`M = Db .members alias .m` gives a table view a join role without reading or
renaming columns. Two aliased operands must have distinct names and both be
rank-1 array tables or SQLite views. Their join keeps each row's fields under
the corresponding nested label, for example `J .m .firstname` and
`J .r .firstname`; an unmatched right scope is absent and can be filled with
`pad` after materialization. The SQL join remains lazy until a terminal read.
Aliasing an already scoped SQLite join is currently an error.
`Cols = record ... end` followed by `Out = View Cols select` builds an ordered,
named projection. SQLite expressions must belong to `View`; constants become
bound parameters. It returns a flat lazy SQLite view without changing its
source. An array source produces lazy rank-1 object rows from scalar fields or
same-length rank-1 columns. Missing array cells and SQLite `NULL` omit the
corresponding output field. Boolean SQL expressions materialize as Rank
booleans. A final `sort by` after `select` orders the exported rows.
`len` runs `COUNT(*)`, and `sum` of a lazy column or arithmetic column
expression runs SQL `SUM`. Field names are schema-checked and quoted; values
are bound parameters. Joining requires views of the same database. Numeric
join keys compare by numeric value, while text and numeric keys do not match.
`sql` exposes the current query and ordered parameters; `explain` inspects its
SQLite plan. `array`, `print` or CSV output materializes a view. SQLite-backed views are
read-only; derived-column assignment and operations beyond this set require
materialization. An expression used as a mask must belong to that exact view.

For a query that cannot yet be expressed through Rank's table operations, use
an explicit read-only SQL source with positional bound parameters:

```rank
Text = "SELECT * FROM facilities WHERE facid = ?"
Params = array FacilityId
Result = Db Text Params sqlquery
Rows = Result array
```

`sqlquery` requires exactly one `SELECT` or read-only `WITH` query and a rank-1
parameter array, including an empty array when there are no placeholders.
Values are bound by the SQLite driver, never interpolated into SQL text. Wrong
parameter counts, duplicate result column names and unsupported parameter
types are errors. Table names are selected with labels, checked against the
schema and quoted as identifiers. A SQLite-backed view is read-only; changing
its materialized array never writes to the database. `sqlquery` remains the
escape hatch for queries not yet expressible through Rank's SQLite views.

## CSV

Current I/O form:

```rank
Data = "train.csv" csv
```

`csv` reads UTF-8 comma-separated data with a header row and returns a rank-1
array of object rows. Quoted fields may contain commas, line endings and escaped
double quotes. Every data row must have the same field count as the header;
empty and duplicate header names are errors.

Rank infers one fixed type for each column from its nonempty cells. A column is
integer when every value is an integer without ambiguous leading zeroes, real
when every value is numeric, and boolean when every value is exactly `true` or
`false`; otherwise it is text. Empty cells are absent fields and therefore
compose with `pad` when the column is projected:

```rank
Age = Data .Age pad Median
```

Writing mirrors assignment:

```rank
Out "submission.csv" csv
```

Output must be a rank-1 array of object rows. The first row determines column
order. A missing field produces an empty cell, an unexpected field is an error,
and text is quoted when CSV escaping requires it. The file ends with a line
ending.

## Column labels

Literal columns use first-class labels:

```rank
Age = Data .Age
Sex = Data .Sex
```

A variable may hold a label:

```rank
Column = .Age
Values = Data Column
```

## Projection

The first table representation is an array whose cells are objects, such as an
array returned by `json`. With `use tables`, one text or label selector lazily
projects the named field from every object while preserving the source shape:

```rank
Age = Data .Age
Column = "Age"
Age = Data Column
```

The field of each row is read only when the corresponding projected cell is
demanded. A demanded non-object cell raises `.TypeError`; a missing field
raises `.Missing`.

Projection also composes inside a data-first call:

```rank
Count = Data .Age len
```

An ordered rank-1 array of labels or text selects several columns:

```rank
Features = array .Age .Fare .Pclass
X = Data Features
```

The result is a rank-2 `rows × columns` array. Column order and repeated names
are preserved. An empty field array produces an `N × 0` matrix without reading
any row. Selected cells stay lazy: a demanded non-object row raises
`.TypeError`, and a demanded missing field raises `.Missing`.

The selected matrix retains its column names while it remains unchanged.
Writing it with `csv` uses those names as the header, which makes a submission
table a direct column selection:

```rank
Out = Test (array .PassengerId .Survived)
Out "submission.csv" csv
```

CSV output requires selected column names to be unique. Ordinary array
operations return ordinary arrays without the table header metadata.

The same selector can be reused:

```rank
X = Train Features
Xtest = Test Features
```

## Computed columns

```rank
Family = Data .SibSp
Family = Family + Data .Parch + 1

Data .FamilySize = Family
```

The receiver must be a rank-1 table. A scalar value is repeated for every row;
a column value must have the same one-dimensional shape as the table. The right
side is read completely before any row changes, so replacing a column from its
own projection is well-defined. Rows are open objects, so assignment may add a
new field. Compound assignment requires the field to exist in every row.

## Missing values

`pad` is used instead of a table-specific `fill`:

```rank
Median = Data .Age median
Data .Age = Data .Age pad Median
```

The `mean`, `median` and `std` statistical reductions ignore missing cells in a
projected table column. If no cells remain, they raise `.EmptyReduction`.

## Boolean rows

Boolean masks use the normal addressing model:

```rank
Mask = Data .Age greater 18
Adults = Data Mask
```

The mask is an ordinary first-class value and the source table is not mutated.
Table masks follow the language's demand-driven mask semantics. A planner may
combine their predicates and push them into a table scan, including when the
mask is later used by a reduction or projection.

Explicit replacement uses ordinary assignment:

```rank
Data = Data Mask
```

## Filter clause

A table source may be refined as part of its definition:

```rank
Data = "data.csv" csv
filter
.Age greater 18
.Score greater 0
end
```

The clause continues the construction of `Data`. It is not a later mutation of
an already-defined table.

Inside the clause, the current collection is implicit. Therefore:

```rank
.Age greater 18
```

means the condition on the `.Age` column of the current table without repeating
`Data`.

Multiple condition lines are combined with logical AND:

```rank
filter
.A greater 0
.B less 10
end
```

corresponds to the combined condition:

```rank
.A greater 0 and .B less 10
```

Separate lines are preferred when AND is all that is needed.

The exact interaction between implicit AND and explicit `or` is not yet fixed.
For complex OR conditions, first-class boolean masks remain the primary,
unambiguous mechanism.

## Grouping

```rank
Groups = Data group by .Sex .Pclass
Rate = Groups .Survived mean
```

`group by` takes one or more field labels separated by spaces. A single key is
`Data group by .Sex`. It returns a grouped view, not nested arrays of rows.
`Groups .Survived mean`, `median`, `std` and `sum` return ordinary rank-1 tables:
one row per key, with the key fields followed by the aggregate field. Groups
appear in first-seen order, and the source rows are captured when `group by`
runs. Missing key cells form one group per key combination. The statistical
reductions skip missing values; when a group has none, its aggregate cell is
missing and may be filled with `pad`. `sum` retains its integer-zero result for
an empty group. Keys must be scalar and cannot be NaN; repeated key fields are
errors.

## Join

Use `leftjoin by` when every left row must remain, or `innerjoin by` for only
matched rows. The same field names on both sides are listed without `array`:

```rank
Forecast = Test Means leftjoin by .store_nbr .family .weekday
```

When corresponding fields have different names, list explicit `equal` pairs:

```rank
Matched = Orders Customers innerjoin on
  .o_custkey equal .c_custkey
```

Several pairs may follow `on` in left-to-right order, and the line may break
immediately after `on`. Aliased table joins retain two nested row objects; the
flat collision rule below applies to joins without aliases. Keys use Rank's
value equality, so integer `1` and real `1.0` match but text `"1"` does not. Missing
join keys never match. Repeated right keys multiply matching rows. Array-backed
joins preserve left row order and, within each left row, right row order. The
right key columns of a flat join are omitted; a shared non-key column name
raises `.TypeError` instead of being renamed automatically. Unmatched right
fields are missing and
can be projected with `pad`. A nonexistent key field raises `.Missing`.

The same joins compile to SQL for SQLite-backed table views. A nested aliased
result must be materialized before sorting by its nested fields. A database
source needs an explicit ordering contract where row order matters.

## Labels

With `use tables`, `Table labels` returns a rank-1 array of column labels.
CSV header order is retained even when a column is entirely empty or the CSV
has no data rows. For a table of ordinary objects without a CSV schema, fields
appear in first-seen order across rows. An empty schema-less table returns an
empty array; a non-object row raises `.TypeError`, and a non-rank-1 value raises
`.DimensionMismatch`.

```rank
Features = Train labels
Mask = Features not equal .label
Features = (Features Mask) array
```

## Text columns

Text operations may lift over a whole column:

```rank
Cabin = Train .Cabin pad "U/0/U"
Parts = Cabin "/" split

Train .Deck = Parts 0
Train .Number = Parts 1
Train .Side = Parts 2
```

Rank does not require a pandas-like `.str` namespace.

## Date columns

CSV date columns remain text until explicitly parsed. Date operations then
lift over the resulting column:

```rank
use dates

Times = Data .datetime datetime
Data .hour = Times hour
Data .weekday = Times weekday
Data .month = Times month
Data .year = Times year
```

---

# Tensors

Rank's array model is intended to scale from ordinary vectors to dense tensors
used in numerical computing and ML.

An atom has shape `[]`. A tensor stores a flat sequence of atoms with a
rectangular shape `[D1, D2, ...]`. Lazy dimensions may have an exact, unknown
finite, or infinite size; asking for an unknown finite shape is a demand point.

## Core operations

The current implementation includes dense construction through `array shape`
and dynamic row-major `reshape`:

```rank
M = Values (array Rows Columns) reshape
```

Dense storage may also be allocated with a fill value and updated in place:

```rank
M = array shape Rows Columns pad 0
M Row Column = Value
M # Column = Values
```

Only material arrays are writable. Postfix `copy` eagerly copies either a
material or lazy tensor into independent writable storage with the same shape:

```rank
use sequences
Writable = Source copy
```

Changing `Writable` does not change `Source`.

`transpose` returns a lazy read-only view. Without an axis modifier it reverses
the order of every axis:

```rank
T = A transpose
rem shape 2 3 4 becomes 4 3 2
```

An explicit axis list gives the complete output-axis order:

```rank
T = A transpose axis 2 0 1
rem shape 2 3 4 becomes 4 2 3
```

Axis numbers are zero-based. The list must contain every source axis exactly
once; missing, repeated and out-of-range axes are errors. A matrix transpose is
`A transpose axis 1 0`.

## Axis reductions

`sum`, `mean`, `median`, `std`, `min`, `max`, `all`, `any` and `count` without
modifiers
reduce every element. `axis` reduces only the named axes and preserves the
remaining axes in their original order:

```rank
Total = A sum
Rows = A mean axis 1
Columns = A mean axis 0
Middle = A median axis 0
Spread = A std axis 0
Planes = T sum axis 0 2
Lows = A min axis 0
Highs = A max axis 1
Complete = Flags all axis 1
Present = Flags any axis 0
TrueByRow = Flags count axis 1
Loss = Pred Target mse
RowLoss = Pred Target mae axis 1
```

An axis list is treated as a set, so its written order does not affect the
result. Every axis must exist and may appear only once. Empty `sum` and `count`
cells return zero; empty `all` and `any` cells return `true` and `false`; an
empty `mean`, `median`, `std`, `min` or `max` raises `.EmptyReduction`. `mean`,
`median` and `std` always return real values. `std` uses the population
denominator `N`.

`rank` and `axis` answer different questions. `rank` chooses trailing cells and
applies the whole operation to every cell in the leading frame. `axis` names
the coordinate dimensions that the operation consumes.

The binary error metrics `mse` and `mae` first broadcast their two operands to
one shape. Without `axis` they average every squared or absolute difference.
With `axis` they average only the named axes and preserve the remaining frame:

```rank
Loss = Pred Target mse
PerSample = Pred Target mse axis 1
```

Their framed results are lazy. Empty reduced cells raise `.EmptyReduction`.
Standard binary functions may declare intrinsic ranks. Rank splits array
arguments into trailing cells, broadcasts their leading frames, and applies
the function to corresponding cells. An atomic or whole-value argument has an
empty frame and is reused for every cell of the other argument. Explicit
binary `rank` overrides are not yet part of the language.

The broader tensor direction includes:

```rank
matmul
max
exp
log
sqrt
round
sin
cos
tan
atan2
softmax
gelu
layernorm
```

The exact module split is still evolving.

## Determinant

`det` from `use linalg` has intrinsic rank 2 and computes the determinant of a
square numeric matrix:

```rank
D = A det
BatchDeterminants = Batch det
Planes = T det axis 1 rank 2
```

Integer-only cells produce exact `integer` results. A cell containing any
`real` value produces a `real`. A singular cell returns zero, and the
determinant of a `0` by `0` matrix is one. A non-square cell raises
`.DimensionMismatch`; a nonnumeric element raises `.TypeError`. Batched results
are evaluated lazily and cached.

## Linear solve

`solve` from `use linalg` solves the equation `A * X = B` directly:

```rank
X = A B solve
```

`A` is a square rank-2 numeric matrix. `B` is either a numeric vector of
length `N` or a rank-2 matrix with shape `N K`; the real result preserves
the shape of `B`. The operation is eager. Incompatible shapes raise
`.DimensionMismatch`, singular coefficients raise `.SingularMatrix`, and
nonnumeric elements raise `.TypeError`.

The equation is the contract, not a particular factorization. An implementation
may choose an equivalent solver from known or detected matrix properties.
The current interpreter uses Gaussian elimination with partial pivoting.

## Matrix inversion

`inverse` from `use linalg` has intrinsic rank 2. It inverts a square numeric
matrix and returns a real matrix with the same shape:

```rank
B = A inverse
BatchInverse = Batch inverse
Planes = T inverse axis 1 rank 2
```

The second expression applies to every trailing matrix cell. The third uses
axis 1 as the frame and forms each matrix from the remaining two axes. A
non-square cell raises `.DimensionMismatch`; a singular cell raises
`.SingularMatrix`. Ranked matrix cells are evaluated lazily and cached.

## Symmetric eigendecomposition

`eigh` from `use linalg` decomposes one real symmetric matrix:

```rank
unpack Values Vectors = A eigh
```

`Values` contains the eigenvalues in ascending order. The matching eigenvectors
are the columns of `Vectors`, so `Vectors # j` belongs to `Values j`. The
operation returns eager real arrays. It accepts a square rank-2 numeric matrix;
shape errors raise `.DimensionMismatch`, nonnumeric or nonfinite elements raise
`.TypeError` or `.DomainError`, and an asymmetric matrix raises `.NotSymmetric`.
The current interpreter uses Jacobi rotations. Eigenvector signs and bases
inside repeated-eigenvalue subspaces are not otherwise canonicalized.

## Standard deviation

`std` from `use stats` computes population standard deviation:

```rank
Spread = Values std
Columns = Data std axis 0
Rows = Data std axis 1
```

It divides by `N`, always returns real values, and supports ordinary `rank` and
`axis` reduction. An empty cell raises `.EmptyReduction`; every demanded cell
must be finite and numeric.

## Covariance

`covariance` from `use stats` calculates sample covariance. By default, the
last axis contains observations, the preceding axis contains features, and all
earlier axes are independent batches:

```rank
Cov = Features covariance
BatchCov = Batch covariance
```

```text
Features Observations       -> Features Features
Batch Features Observations -> Batch Features Features
```

An explicit axis pair handles other layouts:

```rank
Cov = Samples covariance axis 1 0
BatchCov = T covariance axis 2 0
```

The first number selects the feature axis and the second selects the
observation axis. Both are zero-based, valid, and distinct. All remaining axes
become batch axes in their original order. This operation-specific `axis` form
already defines the cells and is not combined with `rank`.

Covariance divides by `N - 1`, always returns real values, and raises
`.InsufficientData` when the observation axis has fewer than two items. The
result and per-feature means are calculated on demand and cached.

## Sliding windows

Multidimensional `window` creates overlapping tensor cells without eagerly
copying them:

```rank
WindowShape = array 2 3
Blocks = M WindowShape window
Scores = Blocks + reduce rank 2
```

For source shape `4 5`, `Blocks` has shape `3 3 2 3`. The trimmed source axes
form the leading window-position frame and the requested window axes are
appended as trailing cells. This makes `rank 2` apply directly to each `2 3`
block.

Selected axes follow the operation:

```rank
Columns = M 3 window axis 1
Blocks = T WindowShape window axis 0 2
```

There must be one window size for every selected axis. The appended cell axes
follow the explicit axis order.

Stride and symmetric zero padding are contextual modifiers:

```rank
Blocks = M WindowShape window stride 2
Blocks = M WindowShape window padding 1
Blocks = M WindowShape window stride 2 padding 1
```

A scalar applies to every selected axis; a rank-1 integer array supplies one
value per selected axis. Strides are positive, padding is nonnegative, and the
defaults are one and zero. When `axis` is also present it follows these
modifiers. Padding is available for arrays and inserts integer zero beyond the
source boundary. Position axes use the usual convolution formula
`max(0, floor((N + 2*P - W) / S) + 1)`.

## Rank-based application

The same `rank` mechanism used for arrays applies to tensor cells:

```rank
X normalize rank 1
```

For a row-wise table calculation:

```rank
Geo distance rank 1
```

An explicit axis list selects the frame, so non-trailing and non-contiguous
cells do not require a transpose:

```rank
rem T has shape 2 64 128
Rows = T normalize rank 2
rem two cells of shape 64 128

Planes = T normalize axis 1 rank 2
rem 64 cells of shape 2 128
```

For `T shape = 2 3 4 5`, `T F axis 1 3 rank 2` has frame shape `3 5` and
passes cells of shape `2 4` to `F`. Explicit axes are frame axes and their
written order becomes the leading result-axis order. All remaining source axes
form the cell in natural order. The number of frame axes plus the cell rank
must equal the tensor rank.

Scalar cell results have the frame shape. Array results append their common
shape to the frame. Source cells and assembled results are lazy read-only views;
each demanded function result is cached. This avoids a separate
dataframe-specific row API.

## Iteration by axis and cell rank

Ordinary `for` over a rank-N tensor yields its rank-(N-1) cells along the
leading axis:

```rank
for Row i in M
  Row print
end
```

A bare `rank` in the iterable position selects trailing cells. The leading
frame supplies the coordinate bindings:

```rank
for Value i j in M rank 0
  Value print
end
```

`axis` explicitly lists the frame axes being iterated. It is core contextual
vocabulary, not a reserved grammar keyword, and it comes before its numeric
arguments so they cannot be confused with addressing:

```rank
for Column j in M axis 1 rank 1
  Column print
end

for Line i j in T axis 0 1 rank 1
  Line print
end
```

The first binding receives the cell. Subsequent bindings receive coordinates
for the listed frame axes in the same order. Index bindings may be omitted.
Axis numbers are zero-based and unique, and this invariant must hold:

```text
number of frame axes + cell rank = tensor rank
```

Without `axis`, the frame axes are the leading axes in natural order. `rank 0`
yields atoms; a rank equal to the tensor rank yields the whole tensor once.
Iteration produces cells in row-major frame order.

The same `axis` word selects tensor slices and arbitrary positions:

```rank
Rows = M axis 0 from 1 until 4
Columns = M axis 1 array 0 2 5
```

The selected axis is preserved and receives the length of the range or index
array. All other axes keep their order and size.

## Outer

`outer` is a higher-order modifier: the operator or named binary function
immediately before it is applied to every pair of cells:

```rank
Sums = A B + outer
Grid = Values Values bxor outer
Operation = min
Smallest = A B Operation outer
```

Cell ranks belong to the operation, while `outer` combines the remaining
frames. Symbolic binary operations have intrinsic ranks `0 0`. The named
functions `band`, `bor`, `bxor`, `shl`, `shr`, `min` and `max` also declare
ranks `0 0`. User-defined binary functions currently default to `all all`;
syntax for declaring their intrinsic ranks remains deferred.

The result shape is the concatenation of the left and right frame shapes. Thus
atom-pairing operations preserve all operand axes. Left frame axes come first
and the right frame varies fastest. The operation must accept two arguments and
currently must return a scalar for every pair.

Both operands must be finite and restartable. Construction is lazy and may
compute a demanded pair again. A named function supplied to `outer` must
therefore be pure: its result and observable behavior may depend only on its
arguments and immutable captured values. The runtime does not yet prove this
property; static effect analysis is tracked separately as tooling work.

Explicit binary rank overrides remain deferred.

A future axis-qualified cell view can be passed to `outer`: `axis` order will
define frame order and `rank` will define its cells. This will support pairings
such as every row of one matrix with every column of another as lazy views.
The expression syntax remains deferred because `axis` already introduces
selection. `outer` itself does not permute axes.

## Matrix multiplication

`matmul` from `use linalg` contracts one axis from each numeric array:

```rank
C = A B matmul
```

By default it contracts the last axis of `A` with the first axis of `B`.
The contracted dimensions must be equal. All remaining axes from `A` form
the leading result axes, followed by all remaining axes from `B`:

```text
2 3       matmul 3 4   -> 2 4
2 3       matmul 3     -> 2
3         matmul 3 4   -> 4
5 2 3     matmul 3 4   -> 5 2 4
```

Two vectors produce a scalar dot product. There is no implicit broadcasting or
pairing of leading axes.

An explicit pair selects a different contracted axis from each operand. The
first number belongs to the left operand and the second to the right:

```rank
C = A B matmul axis 2 0
```

Both axes are zero-based. Exactly two axes are required, and out-of-range axes
are errors. Scalar or nonnumeric operands are errors; unequal contracted
dimensions raise `.DimensionMismatch`.

Array results are lazy. Each output element is calculated on demand and cached.
The calculation uses ordinary Rank numeric promotion: integer-only terms stay
integer, while a real term promotes that output element to real. A contraction
over an empty dimension produces zero for every output element.

`matmul` differs from `outer`: `outer` adds combination axes, while `matmul`
removes the selected compatible axes by summing their products.

## ML direction

High-level names such as `logistic`, `linear` and `cnn` have been useful as
temporary examples while stress-testing Kaggle workflows.

They are **not** treated as magical core primitives.

A current project goal is to implement logistic regression itself in Rank
using the tensor/array layer, and later use the same approach for more advanced
models.

---

# Standard library

Rank starts with a small core. Vocabulary is introduced through `use` modules.

Current module directions:

```rank
use numbers
use random
use linalg
use bits
use ranges
use graph
use tables
use stats
use text
use crypto
use dates
use io
use ml
use algo
use sequences
```

These names are organizational and may still be consolidated.

Each module owns its vocabulary, semantic handlers, validators and execution
planner rules. Common operations normally fit the stable application grammar
and do not add parser productions. Syntax extensions are combined before parser
construction and are then enabled semantically by the corresponding `use`.

## Numbers

Candidate reusable operations:

```rank
odd
even
abs
sqrt
isqrt
log
exp
round
sin
cos
tan
asin
acos
atan
atan2
sinh
cosh
tanh
asinh
acosh
atanh
gcd
lcm
powmod
binomial
binomialmod
factors
divisors
multiple by
min
max
infinity
```

`multiple by` is an elementwise divisibility test and returns a boolean value
or mask:

```rank
Mask = N multiple by 3
```

It is the readable shortcut for `N % 3 equal 0`.

`abs` has intrinsic rank 0 and returns the absolute value of an `integer` or
`real`, preserving its numeric type:

```rank
Distance = Difference abs
Magnitudes = Values abs
```

Its scalar rank makes the second form elementwise over arrays and lazy over
sequences. Negative infinity becomes positive infinity, and either signed real
zero becomes positive zero. A demanded nonnumeric cell is an error.

`sqrt` has intrinsic rank 0 and returns the real square root of an `integer` or
`real`:

```rank
Root = Value sqrt
Roots = Values sqrt
```

It maps lazily over arrays and sequences. A negative input raises
`.DomainError`; positive infinity remains infinity.

`isqrt` has intrinsic rank 0 and returns the exact integer floor of the square
root of a nonnegative `integer`:

```rank
Root = Value isqrt
Roots = Values isqrt
Perfect = Root ** 2 equal Value
```

It maps lazily over arrays and sequences. A negative integer raises
`.DomainError`, and a `real` raises `.TypeError`. The computation uses only
integer arithmetic, so large values do not lose precision.

`log` has intrinsic rank 0 and returns the natural logarithm as a `real`:

```rank
Natural = Value log
Bits = Value log / (2 log)
```

It maps lazily over arrays and sequences. Its input must be positive and
finite; zero, negative values and infinities raise `.DomainError`.

`exp` has intrinsic rank 0 and returns the natural exponential as a `real`:

```rank
Growth = Rate exp
Weights = Scores exp
```

It maps lazily over arrays and sequences. It accepts every numeric input;
negative infinity produces zero, positive infinity remains infinity, and a
finite input whose result overflows produces positive infinity.

`round` rounds a numeric value to a signed number of decimal places:

```rank
Price = Value round 2
Rounded = Values round 4
Hundreds = Count round -2
```

It applies lazily to scalar cells while preserving an array's shape or a
sequence's order. Halfway values round to the nearest even result, as in
Python and NumPy. An integer remains an integer and a real remains a real.
The places argument must be one scalar safe integer.

The trigonometric family uses radians and returns `real` values:

```rank
Y = Angle sin
X = Angle cos
Slope = Angle tan
Angle = Ratio atan
Angle = Y X atan2
```

The circular functions are `sin`, `cos` and `tan`; their inverse functions are
`asin`, `acos` and `atan`. `atan2` takes the vertical coordinate first and the
horizontal coordinate second, so it preserves quadrant information and handles
a zero horizontal coordinate.

`sinh`, `cosh` and `tanh` provide the hyperbolic functions; `asinh`, `acosh` and
`atanh` provide their inverses. `asin` and `acos` accept values from -1 through
1, `acosh` accepts values at least 1, and `atanh` accepts values strictly
between -1 and 1. An input outside a function's mathematical domain raises
`.DomainError`. `sin`, `cos` and `tan` also reject infinities.

Unary functions have intrinsic rank 0 and map lazily over arrays and
sequences. `atan2` has intrinsic ranks `0 0`. It uses the general trailing-axis
broadcasting rule for arrays, broadcasts a scalar over one array, and zips two
sequences. It can also be supplied to `outer`.

`factors` accepts a positive integer and returns its prime factors as a finite
lazy sequence in ascending order, including repeated factors:

```rank
Factors = 12 factors
rem 2 2 3
```

Factoring zero or a negative integer is an error. Factoring one produces an
empty sequence.

`divisors` accepts a positive integer and returns its positive divisors as a
finite lazy sequence in ascending order:

```rank
Values = 12 divisors
rem 1 2 3 4 6 12
```

The plan recognizes `count`, so the common composition below multiplies the
prime exponents without materializing the divisors:

```rank
Count = N divisors count
```

Zero and negative integers are errors. The divisors of one contain only one.

`gcd` and `lcm` use data-first application:

```rank
G = 54 24 gcd
L = 8 12 lcm
```

`lcm` also acts as a named reduction over a finite sequence:

```rank
Answer = (1 to 20) lcm
```

Both operations return nonnegative integers. `0 0 gcd` is zero, an `lcm`
containing zero is zero, and the `lcm` of an empty sequence is one.

`powmod` raises an integer base to a nonnegative integer exponent while reducing
every step modulo a positive integer:

```rank
Value = Base Exponent Modulus powmod
```

The result is normalized from zero through `Modulus - 1`. The implementation
uses repeated squaring, so it does not construct the potentially huge value
`Base ** Exponent` first.

`binomial` returns the exact binomial coefficient for nonnegative integers
with `0 at most K at most N`:

```rank
Exact = N K binomial
```

It has intrinsic ranks `0 0`, so it broadcasts over numeric arrays.
`binomialmod` has a separate fixed arity and calculates directly modulo a
prime:

```rank
Value = N K Modulus binomialmod
```

The current modular implementation requires `N` to be smaller than the prime
modulus, a safely indexable `N`, and a modulus within 64 bits. It caches and
incrementally extends factorial and inverse-factorial tables for each modulus,
so repeated calls cost `O(MaximumN)` preparation and `O(1)` each afterward.
Invalid coefficient bounds or modulus conditions raise `.DomainError`.

Postfix `min` and `max` reduce one collection. Their direct binary forms are
infix and return the smaller or larger numeric operand:

```rank
Smallest = Values min
Left = A max B
Bound = Low max Limit min High
```

Binary chains associate from the left and broadcast over arrays using the
ordinary trailing-axis rules. Parenthesize a compound right operand, as in
`0 max (Limit - Used)`. A stored operation remains an ordinary function value,
so `Operation = max` may be called as `A B Operation` or passed to `outer`.

`infinity` is the positive infinite `real` value. Unary negation produces
`-infinity`.

## Sequences

`all`, `any` and `count` are named boolean reductions:

```rank
Every = Mask all
Some = Mask any
TrueCount = Mask count
Rows = Flags all axis 1
RowCounts = Flags count axis 1
```

`all` and `any` are equivalent to `and reduce` and `or reduce`, respectively.
`count` returns the integer number of `true` values. All three accept only
boolean cells and support `rank` and `axis`. `all` and `any` short-circuit;
`count` examines the complete cell. Empty collections produce `true`, `false`
and zero, respectively. Known unbounded sequences are rejected.

A lazy sequence mask is also accepted by `count`. It returns the number of
source items selected by the mask and lets the source plan provide a direct
count without enumerating those items.

A finite lazy source may also define a direct cardinality count. For example,
`N divisors count` returns the number of positive divisors without enumerating
them. Other numeric sequences still fail the boolean-cell requirement.

## Random

`use random` provides random sampling operations:

```rank
State = 42 seed
Shuffled = Values shuffle
Repeatable = Values 42 shuffle
Sample = Values 10 choices
Noise = Shape Low High uniform
Rows = Data shuffle axis 0
Columns = Data 42 shuffle axis 1
```

`Seed seed` reinitializes the current interpreter's pseudorandom stream and
returns the integer seed. Imported functions share that stream, so the setting
applies to their later unseeded random operations as well. Repeating the call
with the same seed restarts the same sequence.

`shuffle` accepts an array or a finite sequence and returns a new eager dense
array. It never changes its source. A sequence is explicitly consumed by the
operation. An unbounded sequence, a scalar or a missing tensor axis is an
error.

`Shape Low High uniform` returns an eager real tensor whose independent values
are drawn from the half-open interval `[Low, High)`. `Shape` is a rank-1 array
of nonnegative integer dimensions. Equal bounds produce a constant tensor;
zero dimensions produce an empty tensor. Bounds must be finite numbers and the
lower bound must not exceed the upper bound.

`Values Count choices` independently draws `Count` values with replacement
and returns an eager dense array. For a tensor it draws complete cells along
the leading axis, preserving their shape. Count must be nonnegative. Count
zero is valid for an empty input; a positive draw from an empty input is an
error.

The default axis is zero. Selecting another axis reorders its complete slices
with one shared permutation: shuffling matrix columns moves every column as a
unit rather than shuffling each row independently.

Without a seed, `shuffle` consumes the current interpreter's pseudorandom
stream. Supplying an integer seed creates a private stream for that operation,
so equal inputs and equal seeds produce equal results within one interpreter
version without changing the default stream. The precise generator and seeded
order are implementation details and may change between versions. `shuffle`,
`choices` and `uniform` are not cryptographic randomness operations.

## Linear algebra

`use linalg` provides tensor contraction and matrix operations.

`diag` converts a numeric vector into a square diagonal matrix and extracts
the main diagonal of a numeric matrix:

```rank
Matrix = Values diag
Values = Matrix diag
```

A rectangular matrix returns `min(Rows, Columns)` values. Empty vectors and
matrices are valid. Other ranks raise `.DimensionMismatch`, and a nonnumeric
selected value raises `.TypeError`.

`det` has intrinsic rank 2 and returns the determinant of a square numeric
matrix:

```rank
D = A det
BatchDeterminants = Batch det
Planes = T det axis 1 rank 2
```

Integer-only matrices produce exact `integer` results; matrices containing a
`real` produce `real`. A singular matrix returns zero, and the determinant of a
`0` by `0` matrix is one. A non-square matrix raises `.DimensionMismatch`; a
nonnumeric element raises `.TypeError`. Higher-rank inputs use the ordinary
trailing-cell and `axis ... rank 2` rules.

`solve` directly solves `A * X = B`:

```rank
X = A B solve
```

`A` must be a square rank-2 numeric matrix. `B` may be a length-`N` vector
or an `N K` matrix, and the eager real result has the same shape as `B`.
Shape errors raise `.DimensionMismatch`, singular coefficients raise
`.SingularMatrix`, and nonnumeric elements raise `.TypeError`. The equation
is the semantic contract; implementations may select an equivalent algorithm
from known or detected matrix properties. The current interpreter uses
Gaussian elimination with partial pivoting.

`matmul` contracts the last axis of its left array with the first axis of its
right array:

```rank
C = A B matmul
C = A B matmul axis 2 0
```

The explicit form names the left and right contracted axes. Their dimensions
must match. Remaining left axes precede remaining right axes in the result, so
vector dot products, matrix-vector products, matrix products and higher tensor
contractions use the same rule. `matmul` does not implicitly broadcast leading
axes. Array results are lazy and cache each demanded numeric element; a shape
mismatch raises `.DimensionMismatch`.

`inverse` has intrinsic rank 2:

```rank
B = A inverse
BatchInverse = Batch inverse
```

It accepts a square rank-2 matrix and returns a real matrix of the same shape.
On a higher-rank tensor it applies independently to every trailing matrix cell.
The ordinary `axis ... rank 2` form selects matrices on other axes:

```rank
Planes = T inverse axis 1 rank 2
```

A non-square cell raises `.DimensionMismatch`; a singular cell raises
`.SingularMatrix`. In a higher-rank result, matrix cells are computed only when
demanded, and each demanded result is cached. Individual matrix inversion uses
partial-pivoting Gauss-Jordan elimination and does not round its real results.

`eigh` decomposes one real symmetric matrix:

```rank
unpack Values Vectors = A eigh
```

Eigenvalues are ascending, and the corresponding eigenvectors are columns of
`Vectors`. The operation accepts a square rank-2 numeric matrix and returns
eager real arrays. Asymmetric input raises `.NotSymmetric`; shape, element and
convergence errors use `.DimensionMismatch`, `.TypeError`, `.DomainError` and
`.ConvergenceError`. The current implementation uses Jacobi rotations.

## Bits

`use bits` provides bitwise operations over arbitrary-precision integers:

```rank
A B band
A B bor
A B bxor
A bnot
A N shl
A N shr
A N bit
A popcount
X binary
X Width binary
```

`bnot` follows infinite two's-complement semantics, so `A bnot` equals
`-A - 1`. Fixed-width code makes its width explicit with a mask:

```rank
Word = Value bnot 65535 band
```

Shifts require a nonnegative bit count. `shr` is an arithmetic right shift.
`bit` tests a zero-based position and returns a boolean. `popcount` returns the
number of set bits. `bit` and `popcount` require a nonnegative input value.
The module does not introduce a separate bit-mask type: bit masks are ordinary
integers and remain distinct from boolean array masks.

The two-argument forms of `band`, `bor`, `bxor`, `shl` and `shr` have intrinsic
ranks `0 0`, so they can be passed to `outer`:

```rank
Grid = Values Values bxor outer
```

`binary` formats a nonnegative integer as text. With one argument it uses the
shortest representation, including `"0"` for zero. A positive integer width
pads with leading zeroes and raises an error when the value does not fit:

```rank
Bits = 10 binary
Padded = 3 5 binary
rem "1010", "00011"
```

## Sequences

Examples:

```rank
primes
fibonacci
len
shape
transpose
window
copy
sort
argsort
count
```

`copy` eagerly copies a material or lazy array into independent writable dense
storage while preserving its shape. On a numeric `+ segment`, it creates an
independent persistent version that shares unchanged nodes. It does not accept
a sequence; postfix `array` materializes a finite sequence into a rank-1 array.

Both are infinite lazy sources until bounded. `primes` yields ascending prime
integers beginning with `2`, supports `to` and `until`, and may seek to a
zero-based position through normal sequence addressing:

```rank
BelowTwenty = primes until 20
SixthPrime = primes 5
```

`from` sets an inclusive lower value boundary and lets the source seek instead
of enumerating the discarded prefix:

```rank
Candidates = primes from 100
First = Candidates 0
rem First is 101
```

`fibonacci from Lower` uses the same plan interface. A lower-bounded source is
still infinite until `to` or `until` supplies an upper boundary.

`in` performs optimized primality testing on this source without enumerating
an unbounded prefix:

```rank
if Candidate in primes
  ...
end
```

A boundary remains part of membership, so `23 in (primes until 20)` is false.
Membership in another bounded sequence uses a finite linear scan. An unbounded
sequence without its own membership plan is rejected.

`argsort` has intrinsic rank 1 and returns stable, zero-based sorting positions.
For tensors it returns the same shape, orders along the last axis by default,
and accepts `axis N` to select another axis.

`sort by` performs a stable materializing sort of a finite rank-1 collection.
Record fields form a lexicographic key, or one unary function computes a scalar
key once for each value. `argsort by` accepts the same keys and returns source
positions:

```rank
Events = Events sort by .time .delta
Values = Values sort by magnitude
Order = Events argsort by .time .delta
```

The result is a new rank-1 array. Key values use the ordinary numeric, text,
boolean or symbol ordering.

## Tables

Includes concepts such as:

```rank
csv
sqlite
sql
explain
sqlquery
labels
group by
leftjoin by
innerjoin by
leftjoin on
innerjoin on
```

`labels` returns the ordered column labels of a rank-1 table. CSV headers are
retained even for empty columns and zero data rows. For object arrays without
CSV headers, it unions keys in first-appearance order. `group by` builds a
grouped view from one or more named fields; `mean`, `median`, `std` and `sum`
over a grouped column produce a flat table with the keys and aggregate.
`leftjoin` and `innerjoin` match shared fields after `by`, or differently named
field pairs after `on`. These are table operations distinct from text `join`.
`sqlite` opens an existing database read-only; `Db .table` returns a table view
that postfix `array` materializes. `sql` inspects its parameterized statement,
`explain` returns SQLite plan rows, and `sqlquery` creates a read-only query
with bound positional parameters.

## Images

With `use images`, `Directory images` returns a rank-1 table of regular JPEG
and PNG files, sorted by filename in ascending code point order. Each row has
`.name` (the filename) and `.path` (the full path); other files are ignored.
`Images Height Width resize` decodes every image in that order, applies EXIF
orientation, stretches it to the requested positive integer height and width,
converts it to 8-bit sRGB with three channels, and returns a lazy rank-4 RGB
tensor of shape `[image count, height, width, 3]`. Pixel values are integers
from 0 to 255. Empty directories produce an empty tensor with that shape.
This module needs a host with image directory and decoding support; the CLI
uses `sharp` in a synchronous child process so Rank evaluation stays
synchronous. Invalid dimensions raise `.DomainError`, and malformed image rows
raise `.TypeError`.

## Stats

`use stats` provides arithmetic mean, median, population standard deviation,
error metrics and sample covariance:

```rank
Average = Values mean
Rows = Matrix mean axis 1
Middle = Values median
Spread = Values std
Columns = Matrix std axis 0
Loss = Pred Target mse
Rows = Pred Target mae axis 1
Cov = Features covariance
Cov = Samples covariance axis 1 0
```

`mean`, `median` and `std` accept a numeric array or finite sequence and always
return a `real`. They skip missing cells in a projected table column. An empty
input, including a column containing only missing cells, raises
`.EmptyReduction`. `median` sorts a copy, selects the middle value for an odd
count and averages the two middle values for an even count. `std` divides by
the population denominator `N`. All three operations support `rank` and `axis`;
tensor behavior is described in [Tensors](../language/tensors.md). `median` and
`std` reject nonfinite cells with `.DomainError`.

`mse` and `mae` calculate mean squared error and mean absolute error between
two numeric values, finite sequences or arrays:

```rank
Loss = Pred Target mse
FeatureLoss = Pred Target mae axis 0
```

The inputs follow Rank's trailing-axis broadcasting rules. Without `axis`, the
metric averages every broadcast result. An axis list averages only the named
axes and preserves the others in their original order. Both metrics always
return real values, keep framed tensor results lazy, and raise
`.EmptyReduction` for an empty reduced cell. Incompatible shapes raise
`.DimensionMismatch`. Binary `rank` application remains deferred.

By default, `covariance` treats the last two axes as features and observations;
earlier axes are independent batches. The explicit `axis F O` form selects the
feature and observation axes in that order. It preserves the other axes and
replaces the selected axes with two feature axes. The operation uses the sample
denominator `N - 1`, returns real values, and requires at least two
observations. Its result and feature means are calculated lazily and cached.

## Text

Examples:

```rank
split
words
vocab
reverse
codepoint
character
text
integer
parse
startswith
hex
```

`+` concatenates two text values. Both operands must already be text; Rank does
not implicitly convert numbers or other values:

```rank
Candidate = Secret + N text
```

`split` separates text at every exact occurrence of a text separator and
returns a rank-1 array of text values. A rank-1 array of separators splits at
any of them. Adjacent separators preserve empty parts. An empty separator
splits by Unicode code point and must be used alone:

```rank
Parts = "2x3x4" "x" split
Fields = Text (array "," ";") split
Characters = "A😀Б" "" split
```

`Text words` returns lowercase Unicode letter-and-number runs as a rank-1 text
array; punctuation and whitespace separate words. `Texts Limit vocab` accepts
a rank-1 text array and a nonnegative integer limit. It counts all words,
orders them by descending frequency and then ascending Unicode code point
order, and returns at most `Limit` terms. An empty input or zero limit returns
an empty array. These operations require `use text`; wrong element types raise
`.TypeError`, and an invalid limit raises `.DomainError`.

`parse` matches a complete text value against a text pattern and returns the
captured values as a rank-1 array. It is normally combined with `unpack`:

```rank
Pattern = "/word to /word = /integer"
unpack From To Distance = Line Pattern parse
```

Patterns use `/integer`, `/real`, `/word` and `/text`. Integers and reals are
converted to their corresponding scalar types. `/word` captures one or more
non-whitespace characters. `/text` captures as little text as possible while
allowing the following literal pattern to match. `//` matches one literal
slash. All other characters, including spaces, match exactly:

```rank
Pattern = "/integerx/integerx/integer"
unpack Length Width Height = "2x3x4" Pattern parse

Spaced = "/integer x /integer"
unpack A B = "2 x 3" Spaced parse
```

An unknown directive raises `.InvalidFormat`. Input that does not match the
complete pattern raises `.InvalidText`, with the original pattern or input
available as the error value respectively.

`startswith` tests an exact, case-sensitive prefix:

```rank
Ready = Text "Rank" startswith
```

`hex` converts `bytes` to lowercase hexadecimal text without a prefix:

```rank
Encoded = Bytes hex
```

`integer` parses optional `+` or `-` followed by decimal digits. Its intrinsic
unary rank is 1, so a complete text value is converted at once. Explicit
`rank 0` converts each Unicode character and produces a lazy sequence:

```rank
Value = "-1203" integer
Digits = "1203" integer rank 0
```

`text` formats one scalar value as text. Text input is returned unchanged.
Arrays and other collections require an explicit mapping rank rather than
being flattened implicitly.

A literal format after `text` selects fixed decimal output:

```rank
(2 / 3) text ".6f" print
rem 0.666667
12 text ".3f" print
rem 12.000
```

The format is `.Nf`, where N is an integer from 0 to 100. It produces exactly
N digits after the decimal point, with no exponent. Rounding uses the same
nearest-even rule as `round`; it does not add precision to a real value.
Integer inputs retain their exact value. A result that rounds to zero has no
minus sign. Nonfinite reals retain their ordinary text representation.
Invalid formats raise `.InvalidFormat`; nonnumeric input raises `.TypeError`.

This is a literal modifier, not a second function arity: `text` remains unary.
A format variable or an alias such as `F = text` does not accept the modifier.
Formatted arrays keep their shape; formatted sequences are lazy.
Plain `text` and `print` keep their existing behavior.

`join` takes a rank-1 array, queue-family collection or finite sequence followed
by a text separator. It converts scalar elements as plain `text` does and
returns one string. An empty collection produces empty text. An empty separator
concatenates the elements directly:

```rank
(array 1 2 3) ", " join print
rem 1, 2, 3
(array "ab" "cd") "" join print
rem abcd
```

A nontext separator, nonscalar element or higher-rank array raises
`.TypeError`. Join matrix rows explicitly instead of flattening the matrix:

```rank
for Row in Matrix
  Row text ".6f" " " join print
end
```

`join` consumes its input. Known infinite sequences are rejected; for a sequence
whose size is unknown, the caller must ensure that it terminates.


`reverse` reverses text by Unicode code point:

```rank
Back = "A😀Б" reverse
rem Б😀A
```

Reversal of array axes is a separate tensor operation and remains deferred.

`codepoint` converts exactly one Unicode character to its integer code point.
`character` performs the inverse conversion and returns one-character text:

```rank
Code = "😀" codepoint
C = 128512 character
```

`character` rejects negative integers, values above `0x10ffff`, and Unicode
surrogate code points.

`len` from `sequences` returns the number of Unicode code points in text, the
leading-axis length of an array, the size of a queue or set, or the length of a
finite sequence. It rejects an infinite sequence.

`reshape` from `sequences` constructs a dense array in row-major order:

```rank
M = Values (array Rows Columns) reshape
```

The shape is a rank-1 array of nonnegative integers. The source may be an
array, queue, finite sequence or text, and its element count must exactly match
the requested shape. An infinite source is an error.

`window` returns overlapping fixed-size cells lazily:

```rank
Pairs = Text 2 window
Windows = Values Width window
WindowShape = array 2 3
Blocks = M WindowShape window
Columns = M 3 window axis 1
Strided = M WindowShape window stride 2
Padded = M WindowShape window padding 1
```

Tensor window sizes correspond to all axes unless `axis` selects a subset.
`stride` and `padding` accept a scalar for all selected axes or one integer per
axis. Their defaults are one and zero. Strides are positive; padding is
nonnegative, symmetric, array-only and filled with integer zero. The modifiers
precede a final `axis` clause when combined. Results remain lazy and contain
only complete windows of the conceptually padded source.

## JSON

`use json` decodes a complete JSON document from text:

```rank
Data = Text json
FileData = Path read json
```

JSON integers become arbitrary-precision `integer` values. Decimal and
exponent forms become `real`; strings and booleans become the corresponding
Rank scalars; arrays become Rank arrays; objects become keyed `object` values;
and JSON `null` becomes `.null`. Invalid input raises `.InvalidJson`. File input
is composed explicitly with `read`, so file and UTF-8 failures keep their
ordinary I/O error kinds.

Object addressing follows the common data-first addressing model. Membership
tests keys, `len` counts entries, and iteration yields each value followed by
its text key:

```rank
Name = Data "name"
HasName = "name" in Data

for Value Key in Data
  Key print
end
```

Object entry order follows the source document. Values may be heterogeneous,
so the loop value binding receives an inferred union type and can be narrowed
with `is`.

## Cryptography

`use crypto` provides hash and related byte operations. `md5` hashes the UTF-8
encoding of text and returns 16 `bytes`; formatting remains an explicit step:

```rank
Digest = Text md5
Hash = Digest hex
```

## File I/O

`print` writes one line using Rank's default value representation and returns
the value so a pipeline may continue. Scalars and arrays keep their compact
grader-friendly form. Records include field names and values, for example
`{.value = 3, .name = root}`, rather than an opaque runtime marker.

`use io` provides symbol-directed access to standard input. `.word` reads one
whitespace-separated token as text. `.integer` reads the same unit and converts
it to an arbitrary-precision integer:

```rank
Name = stdin .word
N = stdin .integer
```

Spaces, tabs, LF and CRLF separate tokens. Optional `+` and `-` signs are
accepted. End of input raises `.EndOfInput`; a token that is not a decimal
integer raises `.InvalidNumber`. Standard input is supplied by the host, so an
embedded host without it raises `.IO`.

A count after the mode returns an exact-size lazy, single-pass sequence:

```rank
Count = N - 1
Values = stdin .integer Count
Words = stdin .word Count
```

The count must be a nonnegative integer. No input is read until the sequence is
consumed, so input and conversion errors are delayed too. Use postfix `array`
when the complete input must be validated or traversed more than once:

```rank
Values = stdin .integer Count array
```

Line-oriented input is not part of the current language yet.

`use io` provides one-shot UTF-8 text operations for the common case:

```rank
Text = Path read
Lines = Path readlines

Text Path write
Text Path append
```

`read` preserves the complete decoded text, including a final line ending.
Invalid UTF-8 raises `.InvalidEncoding`. `readlines` recognizes LF, CRLF and CR,
removes the line separators and does not add an empty item for a final line
ending. An empty file produces an empty rank-1 array.

`write` creates or replaces a file. `append` creates a missing file or adds text
to the end of an existing file. Both encode text as UTF-8.

Random access uses byte offsets. A one-shot block read does not create a visible
file handle:

```rank
Bytes = Path Offset Count readbytes
```

`bytes` is a specialized rank-1 tensor whose atoms are integers from 0 through
255. It formats as hexadecimal text such as `0x52616e6b`. Offsets and counts are
nonnegative integers, and a block ending past the file returns the available
bytes.

Repeated and stateful I/O uses a `file` value:

```rank
File = Path open

Header = File 64 readbytes
File 1024 seek
Chunk = File 128 readbytes

Offset = File position
Length = File size
Done = File eof
```

`seek` sets an absolute byte offset from the beginning. `position` and `size`
return byte counts. `eof` is true when the current position is at or beyond the
current size.

`open` is read-only by default. A mode label selects another mode:

```rank
Output = Path .write open
Update = Path .update open
Log = Path .append open
```

`.write` creates or clears a file, `.update` opens an existing file for reading
and writing, and `.append` creates a missing file and forces writes to its end.
Handles opened by all three modes can be read. Binary output takes a `bytes`
value previously obtained from `readbytes`:

```rank
Output Bytes writebytes
Output flush
```

`flush` requests that buffered output reach the host file system. File-system
failures raise `.IO` and carry the path as `.Value`.

A file is a scoped resource. It closes automatically when its owning function,
test or program exits, including through `return` or an error. Returning a file,
directly or inside a returned collection, moves ownership to the caller. A file
may be closed early with `File close`; closing an already closed file has no
effect, and other operations on it raise `.IO`.

The interpreter accesses files only through its host adapter. The command-line
host uses the local file system; browser and embedded hosts may provide a file
picker, virtual file system or another implementation with the same semantics.

## Dates

`use dates` parses calendar dates and local date-times explicitly:

```rank
use dates

Day = "2024-02-29" date
Moment = "2024-02-29 13:05:09" datetime
Day weekday
Moment hour
```

`date` accepts exactly `YYYY-MM-DD`. `datetime` accepts exactly
`YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SS`. Both use the proleptic
Gregorian calendar and years `0001` through `9999`. `datetime` is a local
wall-clock value without a time zone or UTC offset. Invalid syntax, dates and
times raise `.InvalidDate`; a non-text input raises `.TypeError`.

`date` and `datetime` are distinct immutable scalar types. They compare for
equality by type and value and order chronologically within their own type.
Ordering one against the other raises `.TypeError`. They are valid set and
index keys, and `text` and CSV output render their canonical forms using a
space between date and time. Parsing a CSV column does not change the original
text column unless it is explicitly assigned back.

`year`, `month`, `day` and `weekday` accept either type. `hour`, `minute` and
`second` require `datetime`. Each returns an `integer`; `weekday` numbers
Monday as 0 and Sunday as 6. The operations apply elementwise to arrays and
sequences, preserve tensor shape, and evaluate lazy cells only when demanded.
A missing projected table cell remains `.Missing` and can be handled with
`pad` before parsing.

```rank
Days = (Train .date pad "2024-01-01") date
```

```rank
Days = Train .date date
Train .weekday = Days weekday

Times = Train .datetime datetime
Train .hour = Times hour
Train .month = Times month
```

## Algorithm profile

`use algo` provides algorithmic collections and combinatorial generators:

```rank
Seen = new set
Counts = new counter
Empty = new multiset
F = Size fenwick
Tree = Values min segment
Data = Values wavelet
Seen add Value
Counts add Value
Bag = Values multiset
Bag add Value
Bag remove Value
Third = Bag 2
Lower = Bag floor Limit
Upper = Bag ceiling Limit
Routes = Cities permutations
Pairs = Values 2 combinations
```

`new stack`, `new deque` and `new heap` create empty named containers.
`pop` and `peek` work on queues, stacks, deques and heaps. Deques also provide
`pushfront`, `pushback`, `popfront`, `popback`, `peekfront` and `peekback`.
`Heap Priority Value enqueue` inserts a payload with a separate priority into
a stable min-heap. `Heap push Value` uses the value as its priority.
`new orderedset` creates a duplicate-free multiset. `lowerbound` returns the
smallest value >= the query; `upperbound` returns the smallest value > it.
These names, together with `floor` and `ceiling`, are contextual rather than
reserved: receiver-first method dispatch occurs only when the evaluated
receiver is a multiset. Otherwise Rank resolves the word as an ordinary
function.
See [collections](../language/collections.md) for examples and empty-container rules.

`Values multiset` constructs a populated ordered multiset; `new multiset`
creates an empty one. A multiset preserves duplicates. `Bag I` selects a sorted
occurrence by zero-based index. Its lookup and mutation operations take expected
`O(log N)` time. Missing indexed, `floor` and `ceiling` results raise `.Missing`
and therefore compose with `pad`. The complete collection semantics are defined
in [Collections](../language/collections.md).

`Size fenwick` constructs a fixed-size integer Fenwick tree. It supports
zero-based cell access and assignment plus inclusive prefix sums through
`F sum I`, all as specified in [Collections](../language/collections.md).
This middle use of `sum` dispatches by the receiver's Fenwick type and does not
reserve the word in other application chains.

`Values Operation segment` builds a segment tree for an associative binary
operation. `Tree Left Right query` reduces an inclusive range, and addressed
assignment performs a point update. Construction, bounds and error behavior
are specified in [Collections](language/collections.md).

`Tree Target firstatleast` finds the first monotone numeric prefix that reaches
the target. `Values maxsum segment` selects the native prefix/subarray summary
profile. `Values wavelet` prepares immutable inclusive range counts through
`Data Left Right Low High within`. Numeric wavelets also provide `sumwithin`
for range-value sums and `Data Bounds missing` for positive coin values.

Numeric `Values + segment` trees also accept `Tree Left Right = Value` and
`Tree Left Right += Delta` with lazy `O(log N)` range updates.

## Graph profile

`use graph` provides the `new graph` constructor, graph-specific `add` and
`edges` dispatch, and the `bfs`, `dfs`, `components`, `bipartite`, `dijkstra`,
`bellmanford`, `floyd`, `cycle`, `euler`, `topological`, `scc`, `mst`, and `maxflow`
algorithms. It also provides the experimental `Next functional` prepared value
with `jump`, `distance`, `lengths`, and the increasing-path `upto` query.
`Next Cost weighted` adds numeric edge sums to that path. Their inputs and
results are specified in [Graphs](../language/graphs.md).
An undirected tree can be prepared with `Tree Root root`; its postfix
`ancestor`, `lca`, and `distance` queries and traversal fields follow the
rooted-tree rules above. `Tree pathlengths` provides a lazy unordered-pair
distance sequence with planned exact and bounded-range counts.
The same module provides closed and open `new dsu` structures with contextual
`merge`, `find`, and `connected` methods plus `components` and `len` queries.

## Rule for adding library vocabulary

A word belongs in the standard library when it represents a broad, reusable
concept with established meaning.

Do not add a word merely because it makes one LeetCode, Euler or Kaggle task
shorter.

---

# Project Euler examples

Project Euler stress-tests Rank's numerical, sequence and array semantics.

## 1. Multiples of 3 or 5

```rank
rem Project Euler 1
rem Multiples of 3 or 5
rem https://projecteuler.net/problem=1

N = 1 until 1000

Mask = N multiple by 3
Mask or= N multiple by 5

Answer = N Mask sum

Answer print
```

This example demonstrates:
- the ordinary/lazy sequence `1 until 1000`;
- the `multiple by` divisibility operation from `numbers`;
- boolean masks as first-class values;
- incremental mask composition with `or=`;
- boolean addressing;
- the `sum` reduction.

This example intentionally uses mask composition rather than the table-oriented
source clause syntax.

## 2. Even Fibonacci numbers

```rank
rem Project Euler 2
rem Sum even Fibonacci terms <= 4e6
rem https://projecteuler.net/problem=2

use sequences
use numbers

Fib = fibonacci to 4000000
Answer = Fib even sum
```

The bounded Fibonacci source stays lazy. The source-bound mask made by `even`
also acts as the selected sequence, so `sum` can consume it directly. The
planner pushes the predicate into the Fibonacci source, which can generate only
even terms.

## 3. Largest prime factor

```rank
rem Project Euler 3
rem Largest prime factor of 600851475143
rem https://projecteuler.net/problem=3

use numbers

Factors = 600851475143 factors
Answer = Factors max
```

`factors` produces a finite lazy sequence of prime factors. The general `max`
reduction consumes it without adding a puzzle-specific operation.

## 4. Largest palindrome product

```rank
rem Project Euler 4
rem Largest product of two N-digit numbers
rem https://projecteuler.net/problem=4

Lower = 10 ** (Digits - 1)
Upper = Lower * 10 - 1

Factors = Lower to Upper
Products = Factors Factors * outer
Mask = Products palindrome rank 0
Answer = Products Mask max
```

`outer` constructs the multiplication table lazily. Ranked `palindrome` checks
each scalar product, and its boolean tensor selects the candidates for `max`.
The helper converts each number to text and compares it with `reverse`.

## 5. Smallest multiple

```rank
rem Project Euler 5
rem Smallest number divisible by 1..20
rem https://projecteuler.net/problem=5

use ranges
use numbers

Range = 1 to 20
Answer = Range lcm
```

The standard `lcm` reduction consumes the lazy range. For `1 to 10`, the same
program produces `2520`.

## 6. Sum square difference

```rank
rem Project Euler 6
rem https://projecteuler.net/problem=6

use ranges
use numbers

Range = 1 to 100
SquareOfSum = (Range sum) ** 2
Squares = Range ** 2
SumOfSquares = Squares sum
Answer = SquareOfSum - SumOfSquares
```

Scalar extension applies `** 2` to every range value, while the parentheses
make the first power operate on the reduced sum. With an upper boundary of
`10`, the result is `2640`.

## 7. 10001st prime

```rank
rem Project Euler 7
rem https://projecteuler.net/problem=7

use sequences

option Count integer = 10001

Index = Count - 1
Answer = primes Index
```

`Count` is one-based because that is how the task states the position. Rank
sequence addressing is zero-based, so the program names the conversion before
addressing the lazy `primes` source. With `Count = 6`, the result is `13`.

## 8. Largest product in a series

```rank
rem Project Euler 8
rem https://projecteuler.net/problem=8

use text
use sequences
use numbers

option Width integer = 13

Digits = Number integer rank 0
Windows = Digits Width window
Products = Windows * reduce rank 1
Answer = Products max
```

Explicit `rank 0` converts the text atoms into a lazy digit sequence. The loops
are unnecessary: `window` exposes each adjacent rank-1 digit cell and the
ranked multiplication reduction produces one value per cell. The default width
13 produces `23514624000`; width 4 produces `5832`.

## 9. Special Pythagorean triplet

```rank
rem Project Euler 9
rem https://projecteuler.net/problem=9

use ranges
use numbers

option Target integer = 1000

ALast = (Target - 1) // 3
BLast = (Target - 1) // 2
A = (1 to ALast) array
B = (2 to BLast) array
PairSums = A B + outer
C = Target - PairSums

Increasing = A B less outer
Increasing and= B less C

ASquares = A ** 2
BSquares = B ** 2
SquareSums = ASquares BSquares + outer
Valid = SquareSums equal C ** 2
Valid and= Increasing

PairProducts = A B * outer
Products = PairProducts * C
Candidates = Products Valid
Answer = Candidates max
```

The bounds follow from `a < Target / 3` and `b < Target / 2`. The `outer`
operations form pairwise sums and squared sums only inside that search space.
Trailing-axis broadcasting compares every `b` with the corresponding `c`, and
the combined boolean tensor keeps only increasing Pythagorean triples. The
default target produces `31875000`; target 12 produces `60`.

## 10. Summation of primes

```rank
rem Project Euler 10
rem https://projecteuler.net/problem=10

use sequences
use numbers

option Limit integer = 2000000

Primes = primes until Limit
Answer = Primes sum
```

The bound becomes part of the lazy prime-source plan, and `sum` consumes that
finite plan. The default limit produces `142913828922`; limit 10 produces `17`.

## 11. Largest product in a grid

```rank
rem Project Euler 11
rem https://projecteuler.net/problem=11

Directions = array shape 4 2
  0 1
  1 0
  1 1
  1 -1
end

Answer = Grid 4 greatest_product
```

The grid is one dense rank-2 array. The helper walks horizontal, vertical and
both downward diagonal directions, rejects endpoints outside the shape, and
keeps the largest fixed-width product. The full example produces `70600674`.

## 12. Highly divisible triangular number

```rank
rem Project Euler 12
rem https://projecteuler.net/problem=12

option Minimum integer = 500
Answer = Minimum first_triangle
```

`divisor_count` consumes the sorted lazy sequence from `factors`. If the prime
exponents are `e1, e2, ...`, it multiplies `(e1 + 1) * (e2 + 1) * ...` without
enumerating every divisor. The first triangle with over 500 divisors is
`76576500`.

## 13. Large sum

```rank
rem Project Euler 13
rem https://projecteuler.net/problem=13

Total = Numbers sum
Text = Total text
Prefix = Text from 0 until 10
Answer = Prefix integer
```

Rank integers keep all 50 decimal digits, so the program can sum the original
values directly. Text slicing then selects the requested leading digits. The
answer is `5537376230`.

## 14. Longest Collatz sequence

```rank
rem Project Euler 14
rem https://projecteuler.net/problem=14

Cache = new index
Cache 1 = 1
Answer = 1000000 longest_collatz
```

The implementation walks each unknown suffix into a stack, stops when it
reaches a cached value, and writes the lengths back in reverse order. The
shared sparse `index` avoids rebuilding overlapping chains. The answer is
`837799`.

## 15. Lattice paths

```rank
rem Project Euler 15
rem https://projecteuler.net/problem=15

Paths = 1
for I in 1 to Size
  Paths = Paths * (Size + I) // I
end
```

This evaluates the central binomial coefficient one exact integer step at a
time. A 20 by 20 grid has `137846528820` paths.

## 16. Power digit sum

```rank
rem Project Euler 16
rem https://projecteuler.net/problem=16

Digits = (2 ** 1000) text
Values = Digits integer rank 0
Answer = Values sum
```

Exponentiation remains exact. Explicit rank 0 parses each character as one
digit, and `sum` reduces the resulting sequence to `1366`.

## 17. Number letter counts

```rank
rem Project Euler 17
rem https://projecteuler.net/problem=17

Answer = 1000 number_letter_total
```

`number_letter_total` creates the small English length tables once and defines
a local `letters` helper that captures them. It implements British `and`
without constructing the spelled-out text. The total is `21124`.

## 18. Maximum path sum I

```rank
rem Project Euler 18
rem https://projecteuler.net/problem=18

Work = Triangle copy
for Row in (Rows - 2) to 0 by -1
  for Column in 0 to Row
    Parent = Row * (Row + 1) // 2 + Column
    Left = Parent + Row + 1
    Right = Left + 1
    LeftValue = Work Left
    RightValue = Work Right
    BestChild = LeftValue max RightValue
    Work Parent += BestChild
  end
end
```

The triangular input is stored densely in row-major triangular order. A
writable `copy` is folded upward in place, so the algorithm also scales to the
larger form of the problem. The first cell becomes `1074`.

## 19. Counting Sundays

```rank
rem Project Euler 19
rem https://projecteuler.net/problem=19

Answer = 1901 2000 count_sundays
```

The helper advances the weekday of each month start from the stated 1900
anchor. Leap years use ordinary divisibility masks and boolean composition.
The twentieth-century count is `171`.

## 20. Factorial digit sum

```rank
rem Project Euler 20
rem https://projecteuler.net/problem=20

Factorial = (1 to 100) * reduce
Digits = Factorial text
Values = Digits integer rank 0
Answer = Values sum
```

The symbolic product reduction computes the exact factorial; the same ranked
text conversion as problem 16 gives the digit sum `648`.

## 21. Amicable numbers

```rank
rem Project Euler 21
rem https://projecteuler.net/problem=21

B = A proper_divisor_sum
Partner = B proper_divisor_sum
if B not equal A and Partner equal A
  Total += A
end
```

`proper_divisor_sum` visits divisor pairs only through the square root. The
search adds each amicable value below 10000 and produces `31626`.

## 22. Names scores

```rank
rem Project Euler 22
rem https://projecteuler.net/problem=22

Text = Input read
Names = Text names_from_text
Answer = Names names_score
```

The program accepts the official names file as a path argument. It removes the
outer quotes, splits the CSV text, sorts the names, and derives letter values
from Unicode code points. The official input is embedded only in the test; the
program tree needs no fixture file. The answer is `871198282`.

## 23. Non-abundant sums

```rank
rem Project Euler 23
rem https://projecteuler.net/problem=23

Abundant = new queue
AbundantSet = new set
```

A divisor-sum sieve discovers abundant numbers. For every candidate, the
ordered queue supplies possible first terms and the set tests the complement
in expected constant time. The search stops after the first pair and produces
`4179871`.

## 24. Lexicographic permutations

```rank
rem Project Euler 24
rem https://projecteuler.net/problem=24

Choice = Remaining // Block
Digit = Available Choice
Available remove Digit
```

Factorial block sizes select each digit directly from an ordered multiset, so
the program does not enumerate the first million permutations. Text preserves
the possible leading zero. The answer is `"2783915460"`.

## 25. 1000-digit Fibonacci number

```rank
rem Project Euler 25
rem https://projecteuler.net/problem=25

for Length less Digits
  Next = Previous + Current
  Previous = Current
  Current = Next
  Index += 1
  Length = Current text len
end
```

The two latest arbitrary-precision integers are sufficient state. The first
Fibonacci value with 1000 decimal digits has index `4782`.

## 26. Reciprocal cycles

```rank
rem Project Euler 26
rem https://projecteuler.net/problem=26

Seen Remainder = Position
Remainder = Remainder * 10 % Denominator
```

Long division repeats exactly when a remainder repeats. A sparse `index`
records the first position of each remainder, giving denominator `983` below
1000.

## 27. Quadratic primes

```rank
rem Project Euler 27
rem https://projecteuler.net/problem=27

for A in (-Limit + 1) until Limit by 2
  for B in primes to Limit
    Length = A B quadratic_run
  end
end
```

The constant coefficient must be a positive prime, and the winning odd prime
allows only odd `a`, which narrows the search. The local `is_prime` helper uses
optimized membership in the existing `primes` source, so no separate predicate
word is needed.
The coefficient product is `-59231`.

## 28. Number spiral diagonals

```rank
rem Project Euler 28
rem https://projecteuler.net/problem=28

Side = Layer * 2 + 1
Total += 4 * Side ** 2 - 6 * (Side - 1)
```

Each concentric layer contributes its four corners directly. The formula gives
`669171001` for a 1001 by 1001 spiral without constructing the matrix.

## 29. Distinct powers

```rank
rem Project Euler 29
rem https://projecteuler.net/problem=29

for A in 2 to Limit
  for B in 2 to Limit
    Values add A ** B
  end
end
```

Exact integer exponentiation and structural set equality remove duplicates
without canonicalizing prime exponents manually. The result is `9183`.

## 30. Digit fifth powers

```rank
rem Project Euler 30
rem https://projecteuler.net/problem=30

Text = N text
Digits = Text integer rank 0
Powers = Digits ** Power
Sum = Powers sum
```

Rank-0 conversion exposes decimal digits, scalar extension raises every digit,
and a reduction checks their sum. The fifth-power answer is `443839`; the same
function gives `19316` for fourth powers.

## 31. Coin sums

```rank
rem Project Euler 31
rem https://projecteuler.net/problem=31

Ways = array shape (Target + 1) pad 0
Ways 0 = 1
for Coin in Coins
  for Amount in Coin to Target
    Previous = Amount - Coin
    Ways Amount += Ways Previous
  end
end
```

Processing one coin at a time counts combinations without counting different
orders separately. The dynamic-programming array gives `73682` ways to make
200 pence.

## 32. Pandigital products

```rank
rem Project Euler 32
rem https://projecteuler.net/problem=32

Identity = A text + B text
Identity += Product text
if Identity Digits pandigital
  Products add Product
end
```

Only one-by-four and two-by-three digit factor shapes can fill a nine-digit
identity. A set removes products found through more than one factor pair; the
sum of distinct products is `45228`.

## 33. Digit cancelling fractions

```rank
rem Project Euler 33
rem https://projecteuler.net/problem=33

if Numerator Denominator curious
  NumeratorProduct *= Numerator
  DenominatorProduct *= Denominator
end
```

The helper checks all four possible locations of one common nonzero digit with
integer cross multiplication. `gcd` reduces the accumulated fraction to the
denominator `100`.

## 34. Digit factorials

```rank
rem Project Euler 34
rem https://projecteuler.net/problem=34

for Length in 2 to MaximumDigits
  0 Length "" 0 search
end
```

The local recursive function enumerates nondecreasing digit multisets rather
than every integer through seven times 9 factorial. It finds `145` and `40585`,
whose sum is `40730`.

## 35. Circular primes

```rank
rem Project Euler 35
rem https://projecteuler.net/problem=35

for Shift in 1 until Length
  Left = Text from Shift until Length
  Right = Text from 0 until Shift
  Number = (Left + Right) integer
end
```

Decimal slices form each rotation, and `Number in primes` performs optimized
primality testing without materializing the infinite source. There are `55`
circular primes below one million.

## 36. Double-base palindromes

```rank
rem Project Euler 36
rem https://projecteuler.net/problem=36

Decimal = Value text
Binary = Value binary
```

Text `reverse` performs the same palindrome check in both representations.
Even positive values cannot be binary palindromes without a leading zero, so
the odd-only search produces `872187`.

## 37. Truncatable primes

```rank
rem Project Euler 37
rem https://projecteuler.net/problem=37

LeftText = Text from Drop until Length
RightText = Text from 0 until Last
```

Every proper decimal prefix and suffix is parsed and tested with `in primes`.
The search stops after the stated eleven values and returns `748317`.

## 38. Pandigital multiples

```rank
rem Project Euler 38
rem https://projecteuler.net/problem=38

for Text len less 9
  Piece = Base * Multiplier
  Text += Piece text
  Multiplier += 1
end
```

Each base appends successive products until it reaches nine digits. Sorting
the text recognizes digits one through nine exactly once; the maximum is
`932718654`.

## 39. Integer right triangles

```rank
rem Project Euler 39
rem https://projecteuler.net/problem=39

Primitive = 2 * M * (M + N)
for P in Primitive to Limit by Primitive
  Counts P += 1
end
```

Euclid's formula generates each primitive triple from coprime parameters of
opposite parity. Marking all scaled perimeters identifies `840` as the most
productive perimeter through 1000.

## 40. Champernowne's constant

```rank
rem Project Euler 40
rem https://projecteuler.net/problem=40

for Remaining greater Digits * Count
  Remaining -= Digits * Count
  Digits += 1
  First *= 10
  Count *= 10
end
```

Whole blocks of equal-width integers are skipped arithmetically, so the program
never constructs the million-character prefix. The seven selected digits have
product `210`.

## 41. Pandigital prime

```rank
for CandidateText in Digits permutations
  Candidate = CandidateText integer
  if Candidate in primes
    return Candidate
  end
end
```

Descending digits make lazy permutations arrive from largest to smallest. The
first prime is `7652413`.

## 42. Coded triangle numbers

```rank
Discriminant = 8 * Value + 1
Root = Discriminant isqrt
if Root ** 2 equal Discriminant
  Count += 1
end
```

`codepoint` computes word values, and exact `isqrt` recognizes triangular
values without floating-point conversion. The official file contains `162`.

## 43. Sub-string divisibility

```rank
for Digit in Digits
  if not (Digit in Prefix)
    Next = Prefix + Digit
    Valid = Next Divisors valid_suffix
  end
end
```

A local recursive search rejects invalid prefixes as soon as their newest
three-digit slice can be checked. The survivors sum to `16695334890`.

## 44. Pentagon numbers

```rank
if Difference in Pentagons
  if Sum in Pentagons
    Best = Difference
  end
end
```

An indexed array supplies pair values while a set provides membership tests.
The bounded search finds the minimum difference `5482660`.

## 45. Triangular, pentagonal, and hexagonal

```rank
for Hex not equal Pent
  if Hex less Pent
    HexIndex += 1
  else
    PentIndex += 1
  end
end
```

Every hexagonal number is triangular, so merging only two polygonal streams
reaches `1533776805` without storing either stream.

## 46. Goldbach's other conjecture

```rank
Remainder = Value - TwiceSquare
if Remainder in primes
  return true
end
```

Odd composites are tested against successive doubled squares. Optimized prime
membership identifies `5777` as the first counterexample.

## 47. Distinct prime factors

```rank
Factors = Value factors unique
if Factors len equal Count
  Run += 1
else
  Run = 0
end
```

The standard operations express the property directly. The first qualifying
run of four integers begins at `134043`.

## 48. Self powers

```rank
Total += N N Modulus powmod
Total %= Modulus
```

Modular exponentiation avoids large intermediate powers. The final ten-digit
numeric suffix is `9110846700`.

## 49. Prime permutations

```rank
Key = A text sort
if B text sort equal Key
  if C text sort equal Key
    ...
  end
end
```

Sorted decimal text gives digit permutations a common key. The requested
concatenation is `296962999629`.

## 50. Consecutive prime sum

```rank
Total = Prefix End - Prefix Start
if Total in primes
  return Total
end
```

Prefix sums make every interval sum constant time, and lengths are tried from
largest to smallest. The result below one million is `997651`.


---

# LeetCode examples

These examples use only the current Rank design.

## 1. Two Sum

```rank
rem LeetCode 1: Two Sum
rem Return indices of two values
rem whose sum equals Target.

fun two_sum A Target
  for Value i in A
    Need = Target - Value

    if Need in index
      J = index Need
      return array J i
    end

    index Value = i
  end
end
```

This demonstrates:
- `array 2 7 11 15` construction and `A i` addressing;
- explicit value/index binding `for Value i in A`;
- user-defined functions and `return`;
- implicit `index`;
- keyed membership and lookup.

## 2. Add Two Numbers

```rank
rem LeetCode 2: Add Two Numbers
rem Add reverse-order digit arrays.

fun add_two A B
  N = A len
  M = B len
  Size = N

  if M greater Size
    Size = M
  end

  Carry = 0
  I = 0

  for I less Size
    X = 0
    Y = 0

    if I less N
      X = A I
    end

    if I less M
      Y = B I
    end

    Sum = X + Y + Carry
    queue push Sum % 10
    Carry = Sum // 10
    I += 1
  end

  if Carry greater 0
    queue push Carry
  end

  return queue
end
```

This uses condition-controlled `for`, ordinary array addressing and one
function-local queue. It does not require padded stacking.

## 3. Longest Substring Without Repeating Characters

```rank
rem LeetCode 3: Longest Substring
rem Find the longest window containing
rem no repeated character.

fun longest Text
  Start = 0
  Best = 0

  for C i in Text
    if C in index
      Last = index C

      if Last at least Start
        Start = Last + 1
      end
    end

    index C = i
    Size = i - Start + 1

    if Size greater Best
      Best = Size
    end
  end

  return Best
end
```

The two loop bindings explicitly receive the current Unicode code point and
its zero-based index. The local `index` stores each character's latest position.
The solution uses only current Rank constructs and runs in linear time.

## 4. Median of Two Sorted Arrays

The runnable example in `demos/leetcode/004_medarrs.ra` uses binary partitioning
and keeps the required `O(log(m+n))` running time. It demonstrates `at most`,
Python-style `//`, real `/`, and the infix binary forms `A min B` and
`A max B`. Array boundaries are handled explicitly, so the algorithm does not
need sentinel infinities even though `use numbers` provides `infinity`.

## 5. Longest Palindromic Substring

The runnable example in `demos/leetcode/005_longestpal.ra` expands around every
possible odd and even center. It uses ordinary conditional `for` loops rather
than adding `break`, and extracts each better result directly:

```rank
Best = Text from L to R
```

Text slices count Unicode code points. The example runs in quadratic time and
constant auxiliary space apart from the returned text value.

## 9. Palindrome Number

Text version:

```rank
rem LeetCode 9: Palindrome Number
rem Check whether X reads the same
rem forward and backward.

fun palindrome X
  Text = X text
  Back = Text reverse

  return Text equal Back
end
```

Follow-up without text conversion:

```rank
rem Follow up:
rem Do not convert X to text.

fun palindrome X
  if X less 0
    return false
  end

  if X % 10 equal 0
    if X not equal 0
      return false
    end
  end

  Back = 0

  for X greater Back
    Digit = X % 10
    X = X // 10

    Back = Back * 10 + Digit
  end

  if X equal Back
    return true
  end

  return X equal Back // 10
end
```


---

# Kaggle examples

Kaggle is used as a stress test for Rank's table, text, date and tensor design.

High-level ML model names in these examples are temporary conveniences. The
current goal is to implement important models such as logistic regression in
Rank itself.

## Titanic

Survival rate by sex and passenger class:

```rank
rem Kaggle: Titanic
rem Compute survival rate by
rem sex and passenger class.

use tables
use stats

Data = "train.csv" csv

Groups = Data group by .Sex .Pclass
Rate = Groups .Survived mean

Rate print
```

Baseline feature preparation:

```rank
Median = Train .Age median
Train .Age = Train .Age pad Median
Test .Age = Test .Age pad Median

Train .Female =
  Train .Sex equal "female"

Test .Female =
  Test .Sex equal "female"

Features =
  array .Female .Pclass .Age .Fare

X = Train Features
Xtest = Test Features
```

The [runnable Titanic baseline](../demos/kaggle/001_titanic.ra) implements
the preprocessing, logistic regression and submission output in Rank. Its
three positional paths default to ignored local directories:

```text
demos/kaggle/data/titanic/train.csv
demos/kaggle/data/titanic/test.csv
demos/kaggle/submissions/titanic.csv
```

The neighboring test uses small in-memory rows, so the repository test suite
does not require a Kaggle account or downloaded competition data.

## House Prices

Reusable feature selectors:

```rank
rem Kaggle: House Prices
rem Predict SalePrice.

Features =
  array .OverallQual .GrLivArea
  .Neighborhood .HouseStyle
  .KitchenQual .ExterQual

X = Train Features
Xtest = Test Features
```

`Features` is an ordinary array of labels.

The [runnable numeric baseline](../demos/kaggle/002_prices.ra) currently
uses `OverallQual` and `GrLivArea`, fills missing values from the training
medians, fits log price with linear regression written in Rank, and writes the
`Id,SalePrice` submission. The neighboring tests do not require Kaggle files.

## Spaceship Titanic

Text splitting over a whole column:

```rank
Cabin = Train .Cabin pad "U/0/U"
Parts = Cabin "/" split

Train .Deck = Parts 0
Train .Number = Parts 1
Train .Side = Parts 2
```

The [runnable numeric baseline](../demos/kaggle/003_spaceship.ra) fills the
five spending columns and age from training medians, derives total spending,
fits the Rank logistic regression, and writes boolean predictions. Its tests
use in-memory rows and cover missing test values.

## Digit Recognizer

Get all pixel columns except the target:

```rank
Features = Train labels
Mask = Features not equal .label
Features = (Features Mask) array

X = Train Features
Xtest = Test Features

X = X / 255
Xtest = Xtest / 255
```

A numeric table can participate directly in array arithmetic.

The [runnable Digit Recognizer baseline](../demos/kaggle/004_digitsreq.ra)
reads train/test CSV files, gets pixel columns from `Train labels` in header
order, fits class centroids, and writes `ImageId,Label`. The train-derived class
set and column selection are covered by adjacent tests and a CLI file test.
Default local paths are `data/digits/{train,test}.csv` and
`submissions/digits.csv` under `demos/kaggle/`.

## Disaster Tweets

The workflow suggested reusable first-class preprocessing values:

```rank
Texts = Train .text pad ""
Vocab = Texts 128 vocab

Model = Texts Vocab tfidf_fit
X = Texts Model tfidf_transform
Xtest = (Test .text pad "") Model tfidf_transform
```

`words` and `vocab` are text-library words. The TF-IDF fitting and transform
remain [Rank functions](../demos/kaggle/005_distweets.ra): the vocabulary
and inverse document frequencies come only from training text. `term_counts`
uses an `index` from each word to its vocabulary column positions, so counting
does not scan the full vocabulary for every word. The runnable
baseline fits Rank logistic regression and writes `id,target`. Its default
local paths are `data/disaster-tweets/{train,test}.csv` and
`submissions/disaster-tweets.csv` under `demos/kaggle/`.

## Store Sales

Grouping and join:

```rank
Groups = Train group by .store_nbr .family .weekday
Means = Groups .sales mean

Forecast = Test Means leftjoin by .store_nbr .family .weekday
```

The [runnable Store Sales baseline](../demos/kaggle/006_storesales.ra)
uses these table operations. An unseen test key falls back to the global
training mean through `pad`. `use dates` computes Monday-first weekdays from
the date column. The grouping and forecast both have focused tests.

## Bike Sharing

Date operations lift over columns:

```rank
use dates

Date = Train .datetime datetime

Train .hour = Date hour
Train .weekday = Date weekday
Train .month = Date month
Train .year = Date year
```

Clamping without elementwise `max`:

```rank
Negative = Pred less 0
Pred Negative = 0
```

The [runnable Bike Sharing baseline](../demos/kaggle/007_bakishare.ra)
parses the fixed Kaggle datetime format with `use dates`, combines four calendar
and eight numeric features, reuses the tested linear regression, clamps negative
predictions, and writes the required two-column submission.

## NYC Taxi

Apply a function to each row/cell:

```rank
Geo =
  Train .pickup_latitude
  .pickup_longitude
  .dropoff_latitude
  .dropoff_longitude

Train .distance =
  Geo distance rank 1
```

The [runnable NYC Taxi baseline](../demos/kaggle/008_nytaxi.ra) builds the
five-feature matrix directly, computes a documented planar distance in Rank,
reuses the log-linear model, and writes `id,trip_duration`. Tests cover the
distance, datetime extraction through `use dates`, and complete prediction path.

## Dogs vs Cats

Images should become ordinary tensor data:

```rank
Train = "demos/kaggle/data/dogs-vs-cats/train" images
Test = "demos/kaggle/data/dogs-vs-cats/test1" images
Pixels = Train 8 8 resize
X = Pixels (array (Train len) 192) reshape
```

The [runnable Dogs vs Cats baseline](../demos/kaggle/009_dogvscat.ra)
derives cat/dog labels from training filenames, resizes JPEG/PNG files to
8×8 RGB, fits Rank logistic regression, and writes `id,label` probabilities.
The small image size keeps a full local competition run practical; this is a
simple pixel baseline, not a convolutional model. The CLI image test creates
real JPEG/PNG files and checks image order, decoding and the submission path.
Extract Kaggle's local archives into the two ignored directories shown above.

## Connect X

Ordinary two-dimensional addressing is sufficient:

```rank
Board r c
Next r c = Player
```

Game-specific primitives are unnecessary.

The [runnable example](../demos/kaggle/010_connectx.ra) checks immediate
wins, blocks immediate losses and otherwise prefers a legal center column.
Its neighboring test file also verifies full columns, full boards and that
searching candidate moves does not mutate the input board.
---

# TPC-H examples

TPC-H is a stress test for Rank's relational and analytical data model.

It complements the other problem suites:
- LeetCode tests the algorithmic core;
- Project Euler tests numeric and sequence programming;
- Kaggle tests data processing and ML;
- TPC-H tests relational analytics.

For now the wiki contains only Q6. `group by`, `leftjoin` and `innerjoin` now
work on arrays of rows; further queries can exercise them before a SQLite
table source is added. SQL pushdown and ordering for database sources are
still open.

## Q6. Forecasting Revenue Change

```rank
rem TPC-H Q6
rem Forecasting Revenue Change
rem https://www.tpc.org/tpc_documents_current_versions/pdf/tpc-h_v3.0.1.pdf

use tables
use dates

L = "lineitem.csv" csv
filter
.l_shipdate date year equal 1994
.l_discount at least 0.05
.l_discount at most 0.07
.l_quantity less 24
end

Revenue =
  L .l_extendedprice
  * L .l_discount
  sum

Revenue print
```

The clause is part of constructing `L`. Each condition line is evaluated in the
implicit context of the current table, and the lines are combined with logical
AND.

---

# Product decisions

This document records deliberate product and language design decisions for Rank.
It explains the ergonomic rationale behind decisions that might otherwise look
counterintuitive to programmers accustomed to desktop-first, punctuation-heavy
languages.

---

## 1. Words over symbols for comparisons and logic

Rank intentionally uses English words for relational and boolean operations
instead of symbolic punctuation:

| Operation | Rank keyword | Conventional symbol |
|---|---|---|
| Equality | `equal` | `==` |
| Inequality | `not equal` | `!=` |
| Less than | `less` | `<` |
| Greater than | `greater` | `>` |
| Less than or equal | `at most` | `<=` |
| Greater than or equal | `at least` | `>=` |
| Boolean conjunction | `and` | `&&` |
| Boolean disjunction | `or` | `||` |
| Boolean negation | `not` | `!` |

### Rationale: The primary keyboard layer

On desktop keyboards, `<`, `>`, `!`, `=`, and `&` have dedicated keys or simple
Shift combinations.

On phones, tablets, handheld calculators, and wearable touchscreens, the reality
is inverted:
- **Letters are on the primary keyboard layer.** They can be typed continuously
  with standard thumb typing, swipe gestures, and system word completion.
- **Punctuation and relational symbols require switching layers.** Typing `<=`
  often requires tapping `?123`, finding `<`, switching back or into `#+=` for `=`,
  and returning to the letter layer. This introduces high input friction and breaks
  typing flow.
- Words such as `equal`, `greater`, and `at least` can be typed without leaving
  the primary alphanumeric layout.

Rank deliberately rejects adding symbolic aliases (such as `==`, `!=`, `<=`, `>=`).
Dual syntax creates dialect fragmentation, and the word-based syntax directly
serves the mobile/small-screen mission.

---

## 2. Intentional intermediate variables over vertical pipelines

Rank encourages naming intermediate values rather than constructing long
vertical pipelines (`|>` or fluent dot-chaining):

```rank
rem Preferred Rank style:
Digits = Number integer rank 0
Windows = Digits Width window
Products = Windows * reduce rank 1
Answer = Products max
```

### Rationale: Readability, debugging, and the BASIC spirit

1. **Self-documenting dataflow on narrow screens:** On a 40-column display,
   multi-stage chained expressions either wrap awkwardly or hide intermediate
   array shapes. Naming values (`Digits`, `Windows`, `Products`, `Palindromes`)
   documents the algorithmic transformation at every step without extra comments.
2. **REPL inspectability:** In a handheld terminal or calculator REPL, each
   intermediate variable is an immediate inspection point. The programmer can
   print `Windows` to verify slice geometry before reducing it. In a monolithic
   pipeline, inspecting intermediate states requires editing and splitting the
   expression.
3. **True to BASIC:** Rank is fundamentally a modern BASIC. Clear assignments to
   meaningful variables keep the mental model accessible, straightforward, and
   concrete.

Short, unambiguous postfix pipelines (`Fib even sum`, `Text reverse print`) are
supported where they remain intuitive, but intermediate variables remain the
canonical idiomatic style.

---

## 3. Rejection of multi-variable `for` comprehensions

Rank rejects multi-generator loop syntax (such as `for a in 1 to N, b in a to N`
or list comprehensions):

```rank
rem Rank uses explicit nested blocks:
for a in 1 to Last
  for b in 1 to Last
    ...
  end
end
```

### Rationale: The 40-column budget

Multi-variable loop declarations pack too much state into a single horizontal
line, directly violating the target 40-column line width. Explicit nested
blocks make the iteration order, nesting depth, and loop scope obvious at a
glance.

---

## 4. Single-level `break` without labeled jumps

The `break` statement terminates only the nearest enclosing `for` loop:

```rank
for
  Count += 1
  if Count equal 10
    break
  end
end
```

### Rationale: Pragmatic control flow

Multi-level labeled breaks (e.g. `break 'outer`) or non-local control jumps add
syntactic weight and compiler complexity that belong to systems languages rather
than BASIC. If a deeply nested loop needs to terminate completely, standard Rank
patterns apply:
- Condition checks on outer loops;
- Flag variables;
- Returning directly from a dedicated helper function (`fun ... return ... end`).

---

## 5. Multidimensional `window` and operator-modifier reductions

Rank introduces `window` and operator-modifier reductions (`* reduce`, `+ reduce`)
to replace nested index-manipulation loops with rank operations:

```rank
Windows = Digits Width window
Products = Windows * reduce rank 1
Answer = Products max
```

### Rationale: APL power with readable words

Algorithms that process sequential data (signal filtering, time-series windows,
adjacent digit products) traditionally force programmers into writing manual
index offset math (`i + j`), bounds checks, and mutable accumulator loops.

By providing `window`, Rank lifts a sequence from rank R to rank R+1
(producing adjacent overlapping cells). Combined with trailing cell reductions
(`rank 1`), the problem is solved declaratively in four readable lines that fit
comfortably on a phone screen.

---

## 6. Consumable lazy sequence masks

Lazy masks created by predicates (e.g. `Fib even`) retain their underlying
source and can be consumed directly by operations:

```rank
Fib = fibonacci to Limit
Answer = Fib even sum
```

### Rationale: Eliminating ceremonial boilerplate

Previously, applying a mask required re-referencing the original sequence
(`Fib (Fib even) sum`). Making lazy masks directly consumable eliminates this
syntactic stutter while preserving the first-class nature of masks:
- They can still be named and reused: `Mask = Fib even`;
- They can still be composed: `Mask or= N multiple by 5`;
- They still participate in explicit addressing: `Selected = Fib Mask`.

---

## 7. The `#` whole-axis selector

Rank uses `#` as a positional tensor selector meaning every item on one axis:

```rank
Column = A # j
Plane = T # # k
```

### Rationale: Compact multidimensional addressing on mobile devices

MATLAB, Octave, NumPy and Julia conventionally use a bare colon for a complete
axis; q elides an index between separators; Wolfram spells the selector `All`.
Rank has no bracket-and-comma index list in which an empty slot can live, and
adding one would make common tensor access harder to type on a phone.

`#` is available from a long press on the period key on the target Android
keyboard and remains visually distinct between whitespace-separated selectors.
It is contextual rather than a general operator. J uses `#` for tally/copy and
q uses it for take/reshape, but Rank spells those operations with words, leaving
the glyph unambiguous in Rank source.

---
