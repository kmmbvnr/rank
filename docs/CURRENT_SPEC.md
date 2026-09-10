# Rank Wiki

**Current language snapshot — 2026-09-10**

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
- [Tables](language/tables.md)
- [Tensor model](language/tensors.md)
- [Standard library](stdlib/modules.md)
- [Project Euler examples](examples/project-euler.md)
- [LeetCode examples](examples/leetcode.md)
- [Kaggle examples](examples/kaggle.md)
- [TPC-H examples](examples/tpch.md)
- [Product decisions](design/product-decisions.md)
- [Open questions](design/open-questions.md)

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

## Unpacking assignment

`unpack` assigns the items of a rank-1 array to the following names:

```rank
unpack Length Width Height = array 2 3 4
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

`Value type` returns a symbol such as `.integer`, `.text`, `.array` or
`.object`. `Value is .integer` is the short boolean type guard. Its right side
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

Rank currently has five scalar value types: `integer`, `real`, `boolean`, `text`
and `symbol`. Integers have arbitrary precision. `real` is currently an IEEE 754
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

## Mathematical compact indexing

For compact mathematical code, a capital letter followed by lowercase indices
denotes indexed access:

```rank
Ai
Aij
DPij
```

Examples:

```rank
DP00 = true
DPij = DPi q
```

This convention is intended for short mathematical object names. Longer names
continue to use ordinary spaced addressing.

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

`by` sets a positive integer step. The bounds determine the direction, so
the same step spelling works for ascending and descending ranges:

```text
1 to 9 by 2
=> 1 3 5 7 9

10 until 0 by 2
=> 10 8 6 4 2
```

The step must be greater than zero. With `to`, the endpoint is included only
when the range lands on it exactly; `1 to 6 by 2` therefore produces
`1 3 5`. With `until`, the endpoint is always excluded. `by` applies only
to numeric ranges; bounding a known sequence such as `fibonacci to 100` does
not accept a step.

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

For a tensor, ordinary iteration yields cells along its leading axis. Explicit
cell-rank and axis iteration are defined in [Tensors](tensors.md).

## Errors and exceptions

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
also before a pending error, `return` or `break` continues outward. A
`try / finally / end` block without `catch` is valid and performs cleanup while
allowing the original error to propagate.

Direct `return` and `break` statements inside `finally` are errors because they
would hide pending control flow. If cleanup raises an error while another Rank
error is pending, the cleanup error propagates and its `.Cause` contains the
original error. An error raised from `finally` cannot be handled by a `catch`
belonging to the same construct; an enclosing `try` may handle it.

`return` and `break` are control flow rather than errors and are never caught.
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

`%` is remainder.

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

Sequence sources may accept bounds, filters and reductions in their own plan.
For example, applying an `even` mask to `fibonacci` allows the source to produce
only `2 8 34 ...`. A source that has no specialized implementation uses the
general lazy operation with the same observable result.

Boundary operations such as `from`, `to` and `until` may be pushed into the
source by the execution planner when the source can seek efficiently.

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
core array constructor and conversion.

Position disambiguates the three uses of `array`:

```rank
A = array 2 7 11       rem construct
Picked = A array 2 0   rem select
Copy = Source array    rem materialize
```

Values after `array` form a selector; postfix `array` at the end of the
expression materializes.

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

Window sizes are positive integers. Only complete windows are returned. If a
window is larger than its source axis, that position axis is empty. Windows are
read-only views of their source.

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

The compact mathematical forms `Ai`, `Mij`, and `Tijk` are reserved for the
same addressing meaning. The interpreter currently implements the spaced form;
general compact addressing remains a later step.

A material dense array can be changed through the same full address:

```rank
M Row Column = Value
```

The address must contain exactly one integer index per axis. Negative and
out-of-bounds indices are errors. Only `=` is supported for addressed
assignment. Assignment changes the existing array object, so every alias of
that array observes the new cell. The target and indices are evaluated before
the right-hand expression.

Lazy arrays produced by operations such as `outer` and `window` are not
writable. Materialize a finite result explicitly with postfix `array` before
changing its cells.

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

`sort` and `unique` have intrinsic rank 1. Both preserve text as text and a
rank-1 array as a rank-1 array:

```rank
Letters = "caab" sort
Distinct = Letters unique
rem Letters is "aabc"; Distinct is "abc"
```

Text is ordered by Unicode code point. Arrays may contain one comparable
scalar type: numbers, text, booleans or symbols. Integers and real numbers form
one numeric ordering. `unique` preserves the first occurrence. It also accepts
queues, sets and lazy sequences; sequence filtering stays lazy.

## Elementwise arithmetic

Arithmetic on compatible arrays is elementwise:

```rank
C = A + B
Squares = Range * Range
Powers = Bases ** Exponents
Pred = Pred - 1
```

Scalar broadcasting is allowed where shape rules make it unambiguous.
Two array operands are compatible only when their complete shapes are equal;
an equal number of elements is not enough.

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
Products = A B * outer
Cells = A F rank 0
```

The trailing modifier binds the operation and its operands as one expression.
In `A B * outer`, `A B` is not evaluated first as addressing.

## Each

`each` applies a scalar function to every atom while preserving shape:

```rank
Numbers = Text integer each
Flags = Values prime each
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

For example, `integer` has intrinsic unary rank 1. It converts a complete text
value by default, while an explicit rank 0 converts its character atoms:

```rank
Value = "1203" integer
Digits = "1203" integer rank 0
rem Value is 1203; Digits are 1 2 0 3
```

Rank-0 application over a lazy sequence remains lazy. Results must currently
have compatible rectangular shapes. Binary rank specifications and the policy
for incompatible result shapes remain deferred until the tensor model is
implemented.

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

`min` and `max` reduce one finite collection or compare two numeric values:

```rank
Largest = A max
Bound = Low High max
```

Their binary form returns one operand and is not an elementwise clamp.

## Scan

Prefix accumulation:

```rank
Prefix = A + scan
```

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

`use algo` provides standard local structures with implicit naming.

## Implicit local structure

If a function uses only one instance of a standard structure, the type word
itself denotes that lazily-created local instance.

### Index

`index` is a sparse keyed structure.

```rank
index Ai = i
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

### Queue

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
if X in set
  ...
end
Count = set len
```

The first use of `set` lazily creates one set in the current function-call
workspace. `add` is idempotent: adding an equal value again leaves the set
unchanged. Scalars and arrays can be elements; array identity includes both
shape and contents. `in` tests membership, and `len` returns the number of
unique elements.

As with `queue`, separate and recursive function calls receive separate sets.
A set is iterable in insertion order. Adding an existing value does not move
it. An array is useful for a composite value such as a coordinate:

```rank
set add array X Y
```

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

These are general data structures, not puzzle-specific shortcuts. Advanced
structures may live in modules:

- heaps;
- disjoint-set union;
- Fenwick tree;
- segment tree;
- bitset;
- sparse table;
- graph structures.

---

# Tables

Tables reuse Rank's normal addressing model.

## CSV

Current I/O form:

```rank
Data = "train.csv" csv
```

Writing mirrors assignment:

```rank
Out "submission.csv" csv
```

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

One label returns a column:

```rank
Age = Data .Age
```

Multiple labels return a table/view:

```rank
X = Data .Age .Fare .Pclass
```

A sequence of labels can be used as a reusable selector:

```rank
Features =
  .Age .Fare .Pclass

X = Train Features
Xtest = Test Features
```

This is one of the central table abstractions in Rank.

## Computed columns

```rank
Family = Data .SibSp
Family = Family + Data .Parch + 1

Data .FamilySize = Family
```

## Missing values

`pad` is used instead of a table-specific `fill`:

```rank
Median = Data .Age median
Data .Age = Data .Age pad Median
```

Statistical reductions on table columns are expected to ignore `missing` by
default unless explicitly configured otherwise.

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
Keys =
  .Sex .Pclass

Groups = Data Keys group
Rate = Groups .Survived mean
```

`group` returns a grouped view suitable for reductions.

## Join

Relational joins are fundamental table operations:

```rank
Forecast = Test Keys Means join
```

Exact join variants and collision rules remain an open design detail.

## Labels

The table schema itself is accessible as labels:

```rank
Features = Train labels
Mask = Features not equal .label
Features = Features Mask
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

Date operations also lift naturally:

```rank
Data .hour = Data .datetime hour
Data .weekday = Data .datetime weekday
Data .month = Data .datetime month
Data .year = Data .datetime year
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
```

Only material arrays are writable. Lazy tensor results must first be
materialized with postfix `array`.

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

`sum` and `mean` without modifiers reduce every element. `axis` reduces only
the named axes and preserves the remaining axes in their original order:

```rank
Total = A sum
Rows = A mean axis 1
Columns = A mean axis 0
Planes = T sum axis 0 2
```

An axis list is treated as a set, so its written order does not affect the
result. Every axis must exist and may appear only once. An empty `sum` is zero;
an empty `mean` raises `.EmptyReduction`. `mean` always returns real values.

`rank` and `axis` answer different questions. `rank` chooses trailing cells and
applies the whole operation to every cell in the leading frame. `axis` names
the coordinate dimensions that the operation consumes.

The broader tensor direction includes:

```rank
matmul
max
exp
log
sqrt
softmax
gelu
layernorm
```

The exact module split is still evolving.

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

## Rank-based application

The same `rank` mechanism used for arrays applies to tensor cells:

```rank
X normalize rank 1
```

For a row-wise table calculation:

```rank
Geo distance rank 1
```

This avoids a separate dataframe-specific row API.

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

`matmul` is distinct from `outer`.

- `outer` adds combination axes.
- `matmul` contracts compatible axes.

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
use ranges
use collections
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
prime
gcd
lcm
powmod
factors
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

`factors` accepts a positive integer and returns its prime factors as a finite
lazy sequence in ascending order, including repeated factors:

```rank
Factors = 12 factors
rem 2 2 3
```

Factoring zero or a negative integer is an error. Factoring one produces an
empty sequence.

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

`min` and `max` use data-first application. With one collection they reduce it;
with two numeric values they return the smaller or larger operand:

```rank
Smallest = Values min
Left = A B max
```

`infinity` is the positive infinite `real` value. Unary negation produces
`-infinity`.

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
```

Both are infinite lazy sources until bounded. `primes` yields ascending prime
integers beginning with `2`, supports `to` and `until`, and may seek to a
zero-based position through normal sequence addressing:

```rank
BelowTwenty = primes until 20
SixthPrime = primes 5
```

## Tables

Includes concepts such as:

```rank
csv
group
join
labels
```

## Stats

`use stats` currently provides arithmetic mean:

```rank
Average = Values mean
Rows = Matrix mean axis 1
```

`mean` accepts a numeric array or finite sequence and always returns a `real`.
An empty input raises `.EmptyReduction`. Axis-qualified tensor behavior is
described in [Tensors](language/tensors.md).

## Text

Examples:

```rank
split
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
```

Tensor window sizes correspond to all axes unless `axis` selects a subset.
Only complete windows are produced.

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

Examples:

```rank
hour
weekday
month
year
```

## Algorithm profile

`use algo` may act as a contest-oriented umbrella module rather than introducing
new semantics.

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

use numbers

Factors = 600851475143 factors
Answer = Factors max
```

`factors` produces a finite lazy sequence of prime factors. The general `max`
reduction consumes it without adding a puzzle-specific operation.

## 5. Smallest multiple

Euler 4 is deferred until the tensor and rank models are implemented.

```rank
rem Project Euler 5
rem Smallest number divisible by 1..20

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

use ranges
use numbers

Range = 1 to 100
Sum = Range sum
SquareOfSum = Sum * Sum
Squares = Range * Range
SumOfSquares = Squares sum
Answer = SquareOfSum - SumOfSquares
```

Elementwise multiplication preserves the lazy range shape, and each `sum`
consumes only its own plan. With an upper boundary of `10`, the result is
`2640`.

## 7. 10001st prime

```rank
rem Project Euler 7

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
use ranges

option Target integer = 1000

Last = Target - 1
for a in 1 to Last
  for b in 1 to Last
    if b greater a
      C = Target - a - b
      if C greater b
        if a * a + b * b equal C * C
          Answer = a * b * C
        end
      end
    end
  end
end
```

This is deliberately the direct imperative version: it exercises nested blocks
and integer conditions without introducing a puzzle-specific operation. The
default target produces `31875000`; target 12 produces `60`.

## 10. Summation of primes

```rank
use sequences
use numbers

option Limit integer = 2000000

Primes = primes until Limit
Answer = Primes sum
```

The bound becomes part of the lazy prime-source plan, and `sum` consumes that
finite plan. The default limit produces `142913828922`; limit 10 produces `17`.

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
Python-style `//`, real `/`, and the data-first binary forms `A B min` and
`A B max`. Array boundaries are handled explicitly, so the algorithm does not
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

## Regular expression matching

The DP notation can use compact mathematical indexing:

```rank
DP00 = true
DPij = DPi q
```

This is one reason compact `Aij` notation exists in Rank.

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

Keys = .Sex .Pclass
Groups = Data Keys group
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
  .Female .Pclass .Age .Fare

X = Train Features
Xtest = Test Features
```

## House Prices

Reusable feature selectors:

```rank
rem Kaggle: House Prices
rem Predict SalePrice.

Features =
  .OverallQual .GrLivArea
  .Neighborhood .HouseStyle
  .KitchenQual .ExterQual

X = Train Features
Xtest = Test Features
```

`Features` is just a sequence of labels.

## Spaceship Titanic

Text splitting over a whole column:

```rank
Cabin = Train .Cabin pad "U/0/U"
Parts = Cabin "/" split

Train .Deck = Parts 0
Train .Number = Parts 1
Train .Side = Parts 2
```

## Digit Recognizer

Get all pixel columns except the target:

```rank
Features = Train labels
Mask = Features not equal .label
Features = Features Mask

X = Train Features
Xtest = Test Features

X = X / 255
Xtest = Xtest / 255
```

A numeric table can participate directly in array arithmetic.

## Disaster Tweets

The workflow suggested reusable first-class preprocessing values:

```rank
Texts = Train .text
Vocab = Texts vocab

X = Train .text Vocab tfidf
Xtest = Test .text Vocab tfidf
```

Whether `vocab` and `tfidf` belong as library words remains open.

## Store Sales

Grouping and join:

```rank
Keys =
  .store_nbr .family .weekday

Groups = Train Keys group
Means = Groups .sales mean

Forecast = Test Keys Means join
```

## Bike Sharing

Date operations lift over columns:

```rank
Date = Train .datetime

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

## Dogs vs Cats

Images should become ordinary tensor data:

```rank
X = Train .image
Xtest = Test .image

X = X 128 128 resize
Xtest = Xtest 128 128 resize

X = X / 255
Xtest = Xtest / 255
```

## Connect X

Ordinary two-dimensional addressing is sufficient:

```rank
Board r c
Next r c = Player
```

Game-specific primitives are unnecessary.

---

# TPC-H examples

TPC-H is a stress test for Rank's relational and analytical data model.

It complements the other problem suites:
- LeetCode tests the algorithmic core;
- Project Euler tests numeric and sequence programming;
- Kaggle tests data processing and ML;
- TPC-H tests relational analytics.

For now the wiki contains only Q6. Later queries will be added as `group`,
`join`, sorting and related table primitives become more precise.

## Q6. Forecasting Revenue Change

```rank
rem TPC-H Q6
rem Forecasting Revenue Change
rem https://www.tpc.org/tpc_documents_current_versions/pdf/tpc-h_v3.0.1.pdf

use tables
use dates

L = "lineitem.csv" csv
filter
.l_shipdate year equal 1994
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
