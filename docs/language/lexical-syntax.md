# Lexical syntax

## Naming

Standard language words are lowercase:

```rank
for
sum
queue
index
sqrt
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

## Multiple assignment

Several names on the left unpack a rank-1 array with the same number of items:

```rank
Length Width Height = array 2 3 4
```

The number of names and items must match exactly. Multiple assignment supports
only `=`; compound assignment always has one target. Each target keeps the same
inferred-type rule as an ordinary assignment. This form is especially useful
with structured text parsing:

```rank
Pattern = "/integerx/integerx/integer"
Length Width Height = Line Pattern parse
```

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

`Value type` returns a label such as `.integer`, `.text`, `.array` or
`.object`. `Value is .integer` is the short boolean type guard. Its right side
must be a known runtime type label.

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

Rank currently has five scalar value types: `integer`, `real`, `boolean`, `text`
and `label`. Integers have arbitrary precision. `real` is currently an IEEE 754
binary64 value and decimal literals contain a decimal point:

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

Future low-precision numeric formats used by ML, such as 4-bit or 8-bit floats,
must be requested explicitly. Type inference never silently selects a reduced
precision format. `path` is an input constraint represented by a `text` value,
rather than a separate runtime type.

## Labels

A leading dot creates a literal label:

```rank
.Age
.Sex
.Pclass
.UserId
```

Labels are first-class values, not text.

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
