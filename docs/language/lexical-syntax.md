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
Index %= Size
Mask and= Active
Mask or= Fallback
Mask xor= Changed
```

The current compound assignment operators are `+=`, `-=`, `*=`, `/=`, `//=`,
`%=`, `and=`, `or=` and `xor=`.

## Inferred variable types

Rank infers a variable's type from its first value, similar to writing `auto`
for every local variable in C++. The type then belongs to that name and cannot
change through a later assignment:

```rank
Count = 1
Count = 2
rem Count = 2.0 is a type error
```

Function parameters and loop bindings are inferred when their workspace is
created. Arrays and other structures keep their outer type when their contents
or shape change according to that structure's own rules. Explicit type
annotations may be added later; inference is the only variable declaration
mode today.

Compound assignment follows the same rule. For example, `/=` cannot store a
real quotient in a variable inferred as `integer`; use `//=` when floor division
is intended.

## Data-first application

Rank places data before the operation. A called function is the final word of
an application:

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

One application calls one function. Use a named intermediate value instead of
placing several function words on one line:

```rank
Text = N text
Back = Text reverse
```

This is both a language rule and the preferred narrow-screen style.

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
```

`at least` means `>=`; `at most` means `<=`.

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
