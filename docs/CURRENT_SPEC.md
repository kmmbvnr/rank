# Rank Wiki

**Current language snapshot — 2026-09-08**

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
- [Open questions](design/open-questions.md)

## Marketing

The marketing pages are not part of the language snapshot and are not inlined
below.

- [Landscape](marketing/landscape.md)
- [Positioning](marketing/positioning.md)
- [Languages to learn from](marketing/inspirations.md)

---

# Lexical syntax

## Naming

Standard language words are lowercase:

```rank
for
while
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

The current compound assignment operators are `+=`, `-=`, `*=`, `/=`, `%=`,
`and=`, `or=` and `xor=`.

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
```

Exact spelling for `<=` and `>=` is still open.

## Scalar types

Rank currently has four scalar value types: `integer`, `boolean`, `text` and
`label`. Integers have arbitrary precision, and `/` returns an integer quotient;
a separate floating-point type has not been defined yet. `path` is an input
constraint represented by a `text` value, rather than a separate runtime type.

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

---

# Modules, programs and inputs

## Standard modules

A bare module name opens standard-library vocabulary in the current workspace:

```rank
use numbers
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

Standalone boolean expression statements are assertions. Every such expression
must evaluate to `true`.

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
for Ai in A
    Ai print
    i print
end
```

`Ai` binds the current value and `i` is automatically bound to its index.

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

Ranges are first-class sequences.

```rank
1 to 10
1 until 10
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

Ranges can be selectors:

```rank
Part = Text L to R
Part = A L until R
```

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

## While

```rank
while B not equal 0
    R = A % B
    A = B
    B = R
end
```

## For

Ranges and sequences are ordinary iterable values:

```rank
for i in 1 to 10
    i print
end
```

The loop variable is an ordinary name in the current workspace. Each iteration
assigns the next value to it; after a nonempty loop it retains the last value,
following Rank's BASIC-like workspace model.

Mathematical value/index binding:

```rank
for Ai in A
    Sum = Sum + Ai
end
```

## Functions

```rank
fun gcd A B
    while B not equal 0
        R = A % B
        A = B
        B = R
    end

    return A
end
```

Calls use Rank's data-first order. Arguments come first and the function name
is the final word:

```rank
G = A B gcd
Result print
```

## Varargs

Current vararg syntax uses `*`:

```rank
fun lcm * Numbers
    ...
end
```

The call-site spelling for expanding a sequence into arguments is still open;
the former prefix sketch `lcm * Range` is not part of the current language.

## Integer arithmetic

`%` is remainder.

Current examples treat `/` on integers as integer division:

```rank
Digit = X % 10
X = X / 10
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

## Shape and size

An atom has shape `[]`. A finite sequence has shape `[Size]`. A tensor stores a
flat sequence of atoms together with its rectangular shape `[D1, D2, ...]`.

A lazy sequence carries one of three size states:

- `exact`: its length is known;
- `unknown`: it is finite, but finding its length may require iteration;
- `infinite`: it has no finite length.

Requesting the shape of an `unknown` finite sequence is a demand point and may
iterate it. Requesting a finite shape from an `infinite` sequence is an error.

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

Array addressing uses one zero-based index per axis:

```rank
X = A i
Y = M i j
Z = T i j k
```

The compact mathematical forms `Ai`, `Mij`, and `Tijk` are reserved for the
same addressing meaning. The interpreter currently implements the spaced form;
general compact addressing remains a later step.

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

Reusing a mask does not promise that its computed bits are cached. A mask
captures the logical values of its operands when it is created, rather than
looking up later assignments to their variable names. This snapshot rule does
not require copying the underlying storage.

Expressions deferred inside a mask must be pure. Operations with observable
side effects are not allowed there, so an implementation may change evaluation
order, fuse operations or recompute values without changing program meaning.

Addressing does not mutate `A` or `N`.

## Elementwise arithmetic

Arithmetic on compatible arrays is elementwise:

```rank
C = A + B
Squares = Range * Range
Pred = Pred - 1
```

Scalar broadcasting is allowed where shape rules make it unambiguous.

`%` and comparisons are also elementwise over compatible arrays:

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

Named reductions use the same data-first style:

```rank
Total = A sum
Largest = A max
Average = A mean
```

`max` remains a reduction. It is not overloaded as an elementwise clamp.

## Scan

Prefix accumulation:

```rank
Prefix = A + scan
```

## Outer

`outer` applies a binary operation to every pair while preserving the axes of
both arguments:

```rank
Sums = A B + outer
Products = A B * outer
```

If `A` has shape `2 3` and `B` has shape `4 5`, the result of `A B * outer`
has shape:

```text
2 3 4 5
```

`outer` combines axes. `matmul` contracts axes.

The axes of the left operand come first and the right operand varies fastest.
Both operands must be finite and restartable. Construction is lazy: `outer`
does not require all result atoms to be materialized immediately.

Applying a same-shaped boolean mask to a tensor returns a rank-1 lazy sequence
of the selected atoms in iteration order. Tables retain their separate
row-selection rule.

---

# Collections

Rank supports standard local structures with implicit naming.

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
Last = index Ci pad -1
```

Multi-dimensional keyed addressing:

```rank
index A B C = Value
X = index A B C
```

The key and value types are inferred from uses within the function.

### Queue

```rank
push queue X
return queue
```

### Set

```rank
add set X
```

### Counter

```rank
add counter X
```

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

Current direction includes:

```rank
matmul
reshape
transpose
sum
mean
max
exp
log
sqrt
softmax
gelu
layernorm
```

The exact module split is still evolving.

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

## Outer

```rank
Products = A B * outer
Sums = A B + outer
```

`outer` preserves the axes of both inputs.

The result shape is the concatenation of the operand shapes. Left axes come
first and the right operand varies fastest. Operands must be finite and
restartable, and the result may remain lazy.

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
use tensor
use tables
use stats
use text
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
prime
gcd
lcm
factors
multiple by
```

`multiple by` is an elementwise divisibility test and returns a boolean value
or mask:

```rank
Mask = N multiple by 3
```

It is the readable shortcut for `N % 3 equal 0`.

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

## Sequences

Examples:

```rank
primes
fibonacci
len
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

Examples:

```rank
mean
median
```

## Text

Examples:

```rank
split
reverse
text
integer
```

`integer` parses optional `+` or `-` followed by decimal digits. Its intrinsic
unary rank is 1, so a complete text value is converted at once. Explicit
`rank 0` converts each Unicode character and produces a lazy sequence:

```rank
Value = "-1203" integer
Digits = "1203" integer rank 0
```

`len` from `sequences` returns the number of Unicode code points in text or the
outer length of a finite sequence. It rejects an infinite sequence.

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
Mask = Fib even
Answer = Fib Mask sum
```

The bounded Fibonacci source stays lazy. Applying the mask pushes the standard
`even` predicate into the source plan, which can generate only even Fibonacci
terms before `sum` consumes them.

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
use ranges

option Width integer = 13

Digits = Number integer rank 0
Best = 0
Last = Digits len - Width

for i in 0 to Last
  Product = 1
  for j in 0 until Width
    K = i + j
    Product *= Digits K
  end
  if Product greater Best
    Best = Product
  end
end

Answer = Best
```

Explicit `rank 0` converts the text atoms into a lazy digit sequence. The loops
then use ordinary sequence addressing. The default width 13 produces
`23514624000`; width 4 produces `5832`.

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
    for Ai in A
        Need = Target - Ai

        if Need in index
            J = index Need
            return array J i
        end

        index Ai = i
    end
end
```

This demonstrates:
- `array 2 7 11 15` construction and `A i` addressing;
- mathematical loop binding `for Ai in A`, which also binds `i`;
- user-defined functions and `return`;
- implicit `index`;
- keyed membership and lookup.

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

    while X greater Back
        Digit = X % 10
        X = X / 10

        Back = Back * 10 + Digit
    end

    if X equal Back
        return true
    end

    return X equal Back / 10
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

# Open questions

These are active design questions, not alternate historical syntaxes.

## `each` and `rank 0`

`each` is reserved as the readable spelling of rank-0 application. It is not
yet settled whether it is an exact alias for `rank 0` for text, tables and
nested values, or whether those value models need a distinct rule.

## Argument expansion

Vararg declarations currently use `*`, but the data-first call-site spelling
for expanding a sequence into arguments is not yet fixed. The former prefix
sketch `lcm * Range` is not current syntax.

## Comparison words

`equal`, `not equal`, `less` and `greater` are established.

`at least` and `at most` are currently being tested as the readable spellings
for `>=` and `<=`, starting with TPC-H Q6, but are not yet considered fully
settled.

## Compound conditions in table source clauses

Multiple condition lines in a table source clause currently mean implicit AND.

The exact interaction between that implicit AND and explicit `or` is not yet
fixed. Complex OR expressions should currently be expressed with first-class
boolean masks where their semantics are unambiguous.

## Negative indexing

`pad` is cleanest if out-of-range coordinates are truly absent. Python-style
negative indexing conflicts with expressions such as:

```rank
A -1 pad 0
```

The current direction is to avoid relying on negative indexing and use explicit
operations such as `A last`, but this is not yet fully fixed.

## Join variants

The compact form:

```rank
A B join
```

is current, but exact rules for:
- inner/left/right/full joins;
- key inference;
- duplicate column names

still need specification.

## Stack / combine

Rank still needs a final name and exact semantics for combining unequal arrays
into a higher-rank rectangular value with padding.

`mix` was rejected as a user-facing name. `stack` is a candidate but is not yet
fixed.

## Missing values

`pad` is the current common mechanism for absent data.

Statistical reductions over table columns are expected to skip missing values by
default, but the exact generic missing-value policy still needs a formal spec.

## ML library boundary

`logistic`, `linear` and `cnn` have appeared in Kaggle sketches as placeholders.

The current design goal is to implement logistic regression in Rank itself,
using general tensor and reduction primitives, before deciding what belongs in
`use ml`.

## NLP preprocessing

`vocab` and `tfidf` were useful in the Disaster Tweets sketch, but it is not yet
decided whether they should be standard library words or examples implemented
from more primitive operations.
