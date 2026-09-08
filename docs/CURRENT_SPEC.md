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

## Labels

A leading dot creates a literal label:

```rank
.Age
.Sex
.Pclass
.UserId
```

Labels are first-class values, not strings.

```rank
Column = .Age
Values = Data Column
```

Use `text` when a textual representation is needed:

```rank
Name = text .Age
```

## Strings

Strings use quotes:

```rank
Text = "hello"
```

The editor should make quotes cheap to enter, but quotes remain ordinary source syntax.

---

# Values and addressing

Rank uses whitespace-based application and addressing.

## General form

```rank
A i
A i j
Data .Age
index Key
```

Conceptually, the value comes first and selectors follow.

The fundamental selection model is:

```text
value + selector -> value
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
    print Ai
    print i
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
    print i
end
```

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

## Varargs

Current vararg syntax uses `*`:

```rank
fun lcm * Numbers
    ...
end
```

Argument expansion uses the same marker:

```rank
Answer = lcm * Range
```

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

Sequences may be lazy.

Boundary operations such as `from`, `to` and `until` may be pushed into the
source by the execution planner when the source can seek efficiently.

## Selection with boolean masks

Selection uses Rank's normal addressing model.

```rank
Mask = A greater 0
B = A Mask
```

The mask is an ordinary value. It can be named, reused and combined before it is
applied.

```rank
M3 = N % 3 equal 0
M5 = N % 5 equal 0

Selected = N (M3 or M5)
```

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

## Each

`each` applies a scalar function to every atom while preserving shape:

```rank
Numbers = Text int each
Flags = Values prime each
```

It is the friendly rank-0 operation.

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
Data = csv "train.csv"
```

Writing mirrors assignment:

```rank
csv "submission.csv" = Out
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

Explicit replacement uses ordinary assignment:

```rank
Data = Data Mask
```

## Filter clause

A table source may be refined as part of its definition:

```rank
Data = csv "data.csv"
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

## Numbers

Candidate reusable operations:

```rank
odd
even
prime
gcd
lcm
factor
multiple by
```

`multiple by` is an elementwise divisibility test and returns a boolean value
or mask:

```rank
Mask = N multiple by 3
```

It is the readable shortcut for `N % 3 equal 0`.

## Sequences

Examples:

```rank
primes
fibonacci
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
int
```

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

print Answer
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
            return index Need, i
        end

        index Ai = i
    end
end
```

This demonstrates:
- `for Ai in A`;
- implicit `index`;
- keyed membership and lookup.

## 9. Palindrome Number

Text version:

```rank
rem LeetCode 9: Palindrome Number
rem Check whether X reads the same
rem forward and backward.

fun palindrome X
    Text = text X
    Back = reverse Text

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

Data = csv "train.csv"

Keys = .Sex .Pclass
Groups = Data Keys group
Rate = Groups .Survived mean

print Rate
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

L = csv "lineitem.csv"
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

print Revenue
```

The clause is part of constructing `L`. Each condition line is evaluated in the
implicit context of the current table, and the lines are combined with logical
AND.

---

# Open questions

These are active design questions, not alternate historical syntaxes.

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
operations such as `last A`, but this is not yet fully fixed.

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
