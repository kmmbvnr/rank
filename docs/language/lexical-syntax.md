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

A postfix function applies to the accumulated arithmetic expression or range.
Within that expression, multiplication precedes addition and powers associate
right. Addressing stays tight: `A i * B j` multiplies two addressed values.

```rank
2 + 9 sqrt
rem sqrt(11)
2 + 3 * 4
rem 14
Fibs until 1000 sum
1 to 9 by 2 array
A max + 1
```

To process just one operand, group it explicitly: `A - (A mean)` or
`0 until (Classes len)`. Comparisons separate completed values, so
`A len equal B len` means `(A len) equal (B len)`. Processing a comparison
result requires an explicit group: `(A equal B) count`.

An unparenthesized value expression permits a formula, a block of successive
function calls, and an optional arithmetic continuation. A new function after
that continuation is a syntax error. Name the intermediate result:

```rank
Scores = X W matmul + Bias
Scores sigmoid
```

`X W matmul + Bias sigmoid` is rejected with a message asking for an
intermediate variable. Explicit parentheses start a separate expression;
short names are preferred when they describe a useful intermediate result.
There is no numeric limit on the number of operations, and no `|` operator.

When a function is supplied dynamically and its signature is unknown during
parsing, make the input boundary explicit: `(2 + 9) Op`. An unresolved address
operand that turns out to be a function raises an error asking for parentheses
or an intermediate variable; it cannot silently change the formula's grouping.

Chained comparisons such as `1 equal 2 equal false` are also syntax errors.
The diagnostic asks for parentheses or an intermediate variable.
`(1 equal 2) equal false` explicitly selects the grouping. Use `and` when
the intention is to test two independent comparisons.

Leading unary `+` and `-` bind before postfix application. Therefore the
function in this expression receives `-121`:

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

Use parentheses or a named intermediate value when an arithmetic sign must be
applied to the result of a call. Logical `not` applies after calls and
comparisons, before `and`, `xor` and `or`: `not X even` means `not (X even)`;
`not X less 3` means `not (X less 3)`.

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

### Explicit conversions

`integer`, `real` and `text` are core functions and require no `use`.
Assignment never converts between integer and real. Convert the value before
assigning it to a variable or record field of the other type:

```rank
Whole = 1
Fraction = 2.7
Whole = Fraction integer
Fraction = Whole real
Label = Fraction text
```

`integer` preserves an integer, truncates a finite real toward zero, or parses
signed decimal integer text exactly. Thus `(-2.9) integer` is `-2`.
`"2.9" integer` is an error; write `"2.9" real integer` to request both steps.
Nonfinite real values cannot become integers.

`real` preserves a real or converts an integer or decimal text to binary64.
Text must be a complete decimal number, optionally signed and with a decimal
point or exponent, such as `"-2.75"` or `"1.25e2"`. Whitespace, hexadecimal
notation and malformed text are rejected. Conversion can round an integer
that binary64 cannot represent exactly; overflow raises `.InvalidNumber`.

`text` explicitly renders a scalar, retaining its existing optional fixed
format: `2.75 text ".1f"`. Parsing and formatting never happen implicitly on
assignment. Mixed numeric arithmetic still promotes its result to real.

`round` changes the numeric value while retaining its type. To round first
and then obtain an integer, write `Value round 0 integer` with `use numbers`.
For elementwise conversion, use `Values real rank 0` or
`Values integer rank 0`. Text is parsed as a whole by default;
`"1203" integer rank 0` instead converts its individual digits.

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
