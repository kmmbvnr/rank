# Rank Wiki

**Current language snapshot — 2026-09-28**

Rank is a modern BASIC for small screens and big algorithms.

The language is designed for:
- phones, calculators, wearables and tiny computers;
- competitive programming and algorithms;
- tables and data analysis;
- arrays, tensors and ML;
- source code that remains readable on narrow screens.
- [LLM-aided Rust rewrite](design/llm-rust-rewrite.md): use readable Rank as an
  executable reference for a standalone Rust program.

This wiki contains only the current design. Deprecated experiments are omitted.

When semantics change, update the canonical section and affected examples in the
same change. Link to shared rules instead of copying them between pages. The
[cell/frame application model](language/sequences-arrays.md#rank) is maintained
with `rank-shape-parity.test.ts`, `empty-frame-rank.test.ts`,
`intrinsic-matrix-ranks.test.ts`, `function-ranks.test.ts` and
`comparison-rank.test.ts` in `packages/interpreter/test`. Add missing behavioral
cases there rather than testing documentation wording. Regenerate the stdlib
reference from its catalogue/CLI preamble; `packages/cli/test/reference.test.mjs`
checks that the published page matches the generator.

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
12. The `filter` clause is concise source/query syntax over masks, not
    mutation. It applies to collections and to tables.
13. User-facing syntax should stay simple even if implementations use macros,
    compiler extensions or optimized execution plans internally.
14. Combine compatible tensor operations internally; readable temporary names
    should not inherently require intermediate arrays.
15. Prefer whole-array transformations and predicates. Use loops for the outer
    search or for state that cannot be expressed more clearly as dataflow.

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
- [Value semantics](design/value-semantics.md)
- [Open questions](design/open-questions.md)
- [Abstract interpretation and shape inference](design/abstract-interpretation-shape-inference.md)
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
new
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

Builtin names are protected while available: core names always, other standard
function names after their module is opened. This includes lowercase function
names and parameters; it does not make all library vocabulary reserved syntax.

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

## Coding style and line budget

Rank code is designed for mobile touchscreens, pocket calculators, and narrow
displays. Clean, idiomatic Rank balances brevity with readability:

### 1. 40-column budget
Aim for lines of roughly 40 characters (up to 50 at most). Code that fits on a
narrow screen without horizontal scrolling or arbitrary line wrapping is easier
to read, review, and type on mobile keyboards.

### 2. Parenthesis budget: at most one pair per line
Typing parentheses on mobile touchscreens requires switching keyboard layers
(e.g. `?123` -> find `(` -> return to letters), creating significant typing friction.
Deeply nested parentheses are also hard to read and balance mentally.

Canonical Rank enforces a strict parenthesis budget:
- **At most one pair of parentheses `(...)` per line.**
- If an expression or indexing operation would require a second pair of
  parentheses, extract a well-named intermediate variable on the preceding line.

```rank
rem Avoid: multiple or nested parentheses on one line
return Reversed ((Reversed len - 1) to 0 by -1)

rem Preferred: extract intermediate step to keep at most one pair
Last = Reversed len - 1
return Reversed (Last to 0 by -1)
```

```rank
rem Avoid: nesting sub-expressions
Jump = Cost (i - 1) + ((Height - Prev) abs)

rem Preferred: linear dataflow without nested grouping
Diff = Height - Prev
Jump = Cost (i - 1) + Diff abs
```

### 3. Intentional vs. redundant intermediate variables
Rank prefers explicit intermediate variables over long anonymous pipelines
(see [Product decisions](design/product-decisions.md#2-intentional-intermediate-variables-over-vertical-pipelines)).
However, intermediate variables must carry meaningful algorithmic semantics or
serve to satisfy the line/parenthesis budget, rather than acting as procedural clutter.

- **Intentional intermediate variables (encouraged):**
  - Name key domain concepts and intermediate data states (`Odds = Numbers odd`,
    `Mask = Heights greater 10`, `Tail = Dp (Start to N)`).
  - Break long expressions to stay within the 40-column width.
  - Eliminate nested parentheses to satisfy the <= 1 parenthesis budget.
  - Provide clear REPL inspection points for intermediate vectors/matrices.

- **Redundant procedural aliases (avoid):**
  - *Single-use arithmetic aliases:* do not create temporary names for trivial
    scalar operations right before using them once:
    ```rank
    rem Avoid:
    Diff = A - B
    Jump = Diff abs

    rem Preferred:
    Jump = (A - B) abs
    ```
  - *Single-use boolean flags:* avoid naming a condition that is immediately
    tested by a single `if`:
    ```rank
    rem Avoid:
    Fits = Weight at most W
    if Fits
      ...
    end

    rem Preferred:
    if Weight at most W
      ...
    end
    ```
  - *Procedural counters:* do not maintain manual loop counters or accumulators
    when vector primitives, collection lengths, or reductions already provide the answer:
    ```rank
    rem Avoid: procedural counter in two-pointer matching
    Count = 0
    for I in 0 till N
      ...
      Count += 1
    end

    rem Preferred: direct derivation from array length/index
    return A len - I
    ```

### 4. Vector idioms and ranges over procedural loops
- Use stepped ranges (`for I in (N - 1) to 0 by -1` or `for I in Start to N by Step`)
  instead of manual `while` loops with decrement/increment counters.
- Use boolean masks and counting (`(A equal 1) count`) instead of manual tally loops.
- Use container slicing (`Path (0 till Length)` or `Reversed (Last to 0 by -1)`)
  instead of manual array copy/reverse loops.
- Use guard clauses (`continue` or `return`) early to keep indentation shallow.

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
Cache Key = Value
```

Compound assignment updates an existing variable without repeating the left
side inside the expression:

```rank
Total += Value
Total -= Cost
Product *= Factor
Power **= Exponent
Index mod= Size
Mask and= Active
Mask or= Fallback
Mask xor= Changed
```

The current compound assignment operators are `+=`, `-=`, `*=`, `**=`, `/=`,
`//=`, `mod=`, `and=`, `or=` and `xor=`.

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

Array bindings keep their rank and recursive element contracts. Axis lengths may
change, but a vector cannot become a matrix and an established integer array
cannot receive text cells. Parameters and captured bindings use the same rule;
each function invocation has fresh local contracts. Plain empty and missing-only arrays
defer their element domain. An explicit fill supplies its recursive cell type
even at length zero: `array shape 0 fill 0` is an integer array, while
`fill 0.0` declares real cells and `fill ""` declares text cells. Ordinary arrays are homogeneous, recursively; use
tuples for positional values of different types. Infinity seeds defer their finite
numeric domain until concrete cells settle it.

Ordinary bindings and writes complete planned cells before storing them.
Deferred bindings retain checks that run when their results are demanded. See [Type-stability contracts](language/type-contracts.md) for
nested arrays, numeric settlement, aliases, failure timing, and the comparison
with record fields, collections, and function returns.

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

An ordinary record binding also keeps its recursive schema on whole-record
replacement: the same field names, field types and ranks, independent of field
order and array lengths. Parameters get a fresh binding per call; captured names
keep their enclosing binding's contract. A temporary `.NA` does not erase it.
Use a separate name or a fresh function call for a different schema. Record
assignment still shares identity; rebinding does not change existing aliases.
See [Type-stability contracts](language/type-contracts.md#record-bindings).

An array field keeps its rank and recursive cell types, but not its axis lengths.
An empty array establishes its rank and any type supplied by an explicit fill.
Without a concrete fill, its cell types settle on the first nonempty assignment
and remain fixed if it becomes empty again. Integer and real cells
are different types. A nested record keeps the same field names and recursively
the same field types; declaration order does not affect this contract.
If an array field initially contains several cell types, later array values may
use a subset of those types without narrowing the field's established contract.
Replacing a nested record instead compares its established schema: a separately
created record with a narrower array-field contract is a different schema.

```rank
State = record
  .items = array 1 2
end
State .items = array 3 4 5
rem Allowed: the length changes, but the rank and cell type do not.
rem State .items = array 1.0 is a type error.
```

Establishing or checking an array field's contract reads its cells, including
lazy cells. This can run callbacks and costs time proportional to the values
checked. Absent table cells contribute no type and remain absent.

`with` makes a changed copy of a record and leaves the original unchanged:

```rank
Next = State with
  .mana -= 53
  .boss -= 4
  .spent += 53
end
```

Each line changes one field with `=` or a compound assignment operator, which
reads the source record's value. Unlisted fields keep their values in the copy.
The same field rules apply as for assignment: a field cannot be unknown, repeated
or given another type. The copy retains the source's field contracts, including
cell types established before an array became empty. The copy is shallow; a
record stored in a field stays shared.

Within one function specialization, every returned record must have the same
field names and recursive field types, including array ranks and cell types.
Array lengths may vary. Record argument schemas participate in specialization,
so an identity function can accept different record schemas in separate calls.

Records have reference semantics, one of the few exceptions to
[values and sharing](language/values-addressing.md#values-and-sharing). Assignment,
function arguments and storage inside another structure preserve the same record
identity, so mutation through one alias is visible through the others.

Capturing a record or mutable container in a deferred binding (`Plan' = Expr`)
or a deferred parameter makes its shared state read-only. Writes through any
alias fail, including aliases created before capture and nested records or
containers reachable from the captured value. Arrays keep copy-on-write
semantics. A fresh record made with `with`, or a newly constructed container,
has independent writable storage. Consuming or forgetting the plan does not
make the captured state writable again.

When a plan captures a named callback, it also retains that function's data
dependencies, including transitive helper dependencies from each defining scope. Rebinding those names
later does not change the existing plan. Ordinary calls to the original
function continue to read its current enclosing bindings.

Addressing may continue through arrays, queues and nested records:

```rank
Tape 0 .grad += Change
Node .parent .grad += Change
```

Equality is structural even though mutation is shared by reference. Two records
are equal when they contain the same field names and recursively equal values;
field declaration order does not matter. A record may be used as a set element
or counter element, but its identity travels with it: a set stores the element
under the key it had when it was added. Changing a field afterwards changes the
element in place, and the set no longer finds it, although it is still stored.
Do not change a record, or anything nested in it, while a set or counter holds
it. To change an element, remove it, change it and add it again, or add a changed
copy made with `with`:

```rank
S remove Node
Node .grad += 1.0
S add Node
```

Ordinary runs do not check this. A debugger run reports it as a runtime error,
`set element was modified after it was added`, before the next statement runs.

`print` includes their fields in declaration order so a result remains
useful to a person and to a line-oriented grader:

```rank
Node print
rem {.data = 2, .grad = 0, .op = .leaf}
```

`less`, `greater`, `at most`, and `at least` compare records
lexicographically in declaration order. Both records must declare the same
fields in the same order, and each compared field must itself have an order.
`sort` uses this same order. Structural `equal` still ignores field order.

Records differ from JSON `object` values and sparse `index` values. An
`object` is read by dynamic text keys, while a record declares its fields in
Rank source and accesses them with symbols. An `index` remains open to new
keys and may use tuple keys.

## Unpacking assignment

`tuple A B` constructs a fixed positional value. Every binding and function result
specialization has a fixed tuple arity and recursive type/rank at each position:

```rank
fun N item
  return tuple N "item"
end
unpack Number Name = 1 item
unpack Number Name = 2 item
```

Tuple positions are immutable. Integer indexing, `len`, equality and `unpack`
are supported. Tuples have rank 0 and do not participate in array broadcasting.
`(tuple)` is empty; `(tuple A)` has one position. Arrays inside tuple positions
may change length but keep their element types. Records keep their shared identity.

`unpack` assigns the items of a rank-1 array or a tuple to the following names:

```rank
unpack Length Width Height = array 2 3 4
```

`#` discards an item while preserving its position, as it does in a `for`
binding:

```rank
unpack From To # = Edge
```

A tensor of higher rank gives its slices along the leading axis, each without
that axis, so a matrix unpacks into its rows. `axis N` after the source picks
another axis, so a matrix unpacks into its columns:

```rank
M = array shape 2 3 fill 0
unpack First Second = M
unpack A B C = M axis 1
```

The number of names and items must match exactly. Unpacking supports only `=`;
compound assignment always has one target. Each named target recursively
completes its selected value and keeps the ordinary inferred-type rule. Targets
have no apostrophe form; a discarded `#` child is not completed for a binding. The explicit keyword keeps a
multi-part target available for addressed assignment: `A i j = Value` changes
one cell, while `unpack A B = Values` assigns separate variables. This form is
especially useful with structured text parsing:

```rank
Pattern = "/integerx/integerx/integer"
unpack Length Width Height = Line parse Pattern
```

The same word before an expression expands a rank-1 array into adjacent
application arguments or address selectors (a tensor expands into its
leading-axis slices):

```rank
Point = array X Y

Index unpack Point = 1
Value = Index unpack Point
Result = unpack Point distance
```

The expression is evaluated once and its items are inserted in order. Only one
level is expanded, and the source is not changed. An empty vector inserts no
arguments. A non-array raises `.TypeError`. After expansion, ordinary function
arity and addressing rules apply. `Queue push unpack Items` appends each item
to a queue, stack, deque or heap, and `unpack Items axis N` slices along
another axis there too.

## Data-first application

Rank places data before the operation. A function follows the values it
consumes:

```rank
30 sin
A gcd B
Range lcm
Answer print
Model X predict
```

This is the canonical call order for standard-library and user-defined
functions. Nullary sources such as `fibonacci` and `primes` are values rather
than calls. Keywords such as `use`, `run`, `arg` and `if` introduce their own
statements and do not follow the function-call rule.

An application may form an unambiguous left-to-right pipeline. Each function
consumes the values accumulated before it according to its declared arity, and
its result becomes the first value available to the next function:

```rank
Answer = Fib filter even sum
Text reverse print
A matmul B round 6
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
Fibs till 1000 sum
1 to 9 by 2 array
A max + 1
```

To process just one operand, group it explicitly: `A - (A mean)` or
`0 till (Classes len)`. One case needs no parentheses: `len` right after a
data name that bounds a range measures that name, so `0 till Classes len` and
`1 to Items len` mean `0 till (Classes len)` and `1 to (Items len)`. After a
number, `len` still counts the range: `1 till 5 len` is `4`.

A comparison works like the arithmetic above it, as on a calculator: after a
plain left operand, the comparison takes the next value and a following
function processes its result. `A greater 2 count` means `(A greater 2) count`,
and `A + 1 greater 3 count` counts the cells of `A + 1` above 3. When the left
operand is itself a pipeline, both sides stay independent, so
`A len equal B len` still means `(A len) equal (B len)` and
`X date less Y date` compares two dates. To test a plain value against a
processed one, put the processed side first (`Text reverse equal Text`,
`Queue len greater Head`) or group it (`Head less (Queue len)`). `and`, `or`
and `xor` always separate independent clauses.

An unparenthesized value expression permits a formula, a block of successive
function calls, and an optional arithmetic continuation. A new function after
that continuation is a syntax error. Name the intermediate result:

```rank
Scores = X matmul W + Bias
Scores sigmoid
```

`X matmul W + Bias sigmoid` is rejected with a message asking for an
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

After a single boolean, `and` and `or` are guards. The right side runs only
when the left side does not decide the result, so a bounds check can protect
the read that follows it:

```rank
if Position less 8 and Password Position equal ""
  Password Position = Letter
end
```

`false and X` is `false` and `true or X` is `true` without evaluating `X`.
When the right side does run it must also be a single boolean; to combine a
mask with a flag, put the mask first: `Mask and Flag`. With an array or mask
on the left, both sides always run and combine elementwise. `xor` and the
compound assignments `and=`, `or=` and `xor=` always evaluate both sides.

Materialized boolean arrays use packed bit storage. This does not introduce a
new value type or change indexing, shapes, broadcasting or assignment rules.
Same-shape logical chains, matrix/row broadcasting, zero-filled rank-one
shifts, `count` and `indices` can operate on words without unpacking cells. An
ordinary binding completes a finite mask; `copy` is an optional explicit
snapshot operation. Array aliases remain protected by copy-on-write.
Trailing-axis `count` can reduce contiguous cells in packed form. Higher-rank
shifts and other broadcasting forms keep the ordinary paths when no packed
kernel applies.

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

`equal` and `not equal` reject comparisons between a boolean and an integer
or real with `.TypeError`, including corresponding values inside tuples,
records and cells compared at rank. Compare a flag with `true` or `false`, or
convert it explicitly with `integer` when a numeric value is needed.
Membership tests keep booleans and numbers as distinct values.

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

With an array or queue on the left, `in` tests each cell against the whole
right collection and returns a boolean array with the same shape. A sequence
on the left produces a lazy sequence of booleans in the same order. Text cells
remain whole strings. `not in` negates each result.

```rank
use sequences
Numbers = array 1 2 3 4 5
Numbers in primes                 rem false true true false true
Names = array "Ann" "Bob" "Eve"
Allowed = array "Bob" "Eve"
Names in Allowed                  rem false true true
Numbers in fibonacci              rem true true true false true
```

Arrays and queues are also accepted on the right; their cells form the search
collection regardless of shape. Array-valued elements and records use
structural equality. An array on the left is always a collection of queries,
including when the right side is a set of arrays.

For batch queries against an array, queue, or finite sequence without a
membership plan, the runtime builds one lookup table for numeric, boolean,
and text values. For these values, expected work is `O(N + M)` with `O(M)`
lookup storage, where `N` and `M` are the left and right sizes. Composite
values retain structural scanning. Sets, indexes, multisets, and sequences
with membership plans use their existing lookup operations.

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

A literal may carry an exponent, `e` or `E` followed by digits. Without a decimal point and
with a non-negative exponent it is an integer (`4e6` is `4000000`, `2e+3` is `2000`); with a
decimal point or a negative exponent it is a `real` (`1.5e3`, `1e-3`).

Arithmetic may mix integers and reals: `Count + 0.5` produces a real.
Mixed arithmetic converts the integer operand to binary64, which can lose
precision for large integers. Arithmetic on two integers remains exact,
except for `/` and negative powers.
`/` always produces a real, including `5 / 2`. `//` performs floor division;
two integers produce an integer; a real operand produces a real. Numeric
comparisons, including `equal` and `not equal`, allow mixed types and compare
their numeric values without rounding integers to binary64.

`**` raises its left operand to the power of its right operand. Integer operands
with a nonnegative exponent produce an arbitrary-precision `integer`. A negative
integer exponent produces a `real`; two real operands also produce a `real`. Zero to a negative power and results outside
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

`nan` from `use numbers` is the IEEE not-a-number real value. It marks a real
with no numeric value, such as an unknown parameter, and arises from undefined
real arithmetic like `infinity - infinity`. `nan` is unordered: `less`,
`greater`, `at most`, `at least` and `equal` with it are false, so it does not
equal itself and `find` cannot locate it. `Value isnan` tests for it, mapping
over arrays and sequences like `even`, and `Params isnan find true` gives its
position. `nan` is a number; a cell with no value at all is `.NA`.

## Missing cells

`.NA` is a scalar value of type `.missing` for a cell that has no value. It can
be written in an array, bound and passed like any value, and it does not change
the array's numeric element type:

```rank
Params = array 150000.0 5000.0 .NA 3.0
Unknown = Params present find false
```

Arithmetic and comparison with `.NA` give `.NA`, including `equal`, so a missing
cell is found with `Values present`, a boolean mask that is false for `.NA`
and for a cell that reads as `.Missing`, and not by value. `and` and `or` use
three-valued logic: `false and .NA` is false, `true or .NA` is true, and every
other combination with `.NA` is `.NA`. `default` replaces `.NA`, and `sum`,
`min`, `max`, `mean`, `median`, `std` and the other statistics skip it. `.NA`
reaching a place that needs one value, such as an `if` condition, raises
`.Missing`, which `default` also handles. `nan` stays a number: `isnan` is false
for `.NA`. Reading an absent stored table cell returns `.NA`; reading a missing
key or one absent `lookup` result still raises `.Missing`; see ADR-0108.

A name accepts `.NA` whatever type it holds, and a name that has held only `.NA`
takes the type of its first value, so `Best = .NA` followed by `Best = 1.0` is
valid and `Best = "a"` after that is not. The analyzer types `.NA` as `missing`
and an array with `.NA` cells has element types such as `real` and `missing`;
`default` removes `missing` from the result.

A whole array holds data that has no value as `.NA` instead of raising for each
cell: an absent table cell, a field some object rows lack, and a `lookup` key
with no match. Reading that one lookup cell by itself still raises `.Missing`.
A miss that is not data, such as an index outside the choices of `choose`,
raises `.Missing` for the whole array, and so does a field no row has. A mask
with `.NA` selects no row or element where it has no value, as in SQL:
`X (X greater 2.0)` skips an `.NA` cell.

Missing-cell policies are operation-specific:

| Operations | Policy |
| --- | --- |
| Arithmetic, comparisons, scalar math, `round`, `floor`, `ceil`, `text` | Propagate `.NA` in data cells. Configuration arguments, such as the number of decimal places, must still be valid. |
| `sum`, `min`, `max`, statistical reductions including `mode`, boolean `count` | Skip `.NA`. Empty-input rules still apply after skipping. |
| `present`, `isnan`, `in` | Return booleans. `.NA` is not a present value, a NaN, or a matching membership query. |
| `sort`, `argsort`, `unique`, ordered collection keys | Reject `.NA`; materialize `(Values filter present) array` first. |
| Table grouping | Absent keys form one group; absent join keys do not match. |
| `if`, scalar indices, required keys, integer-only number-theory operations | Require a value; fill or remove `.NA` first. |

`len` counts positions, including missing cells; `present count` counts values.
Structural operations such as reshape, transpose, copy and slicing retain missing
cells in their corresponding positions. Operations requiring booleans, text,
indices or configuration values keep their input checks; they do not acquire an
implicit missing-value fallback. `default` is lazy: the fallback is evaluated
only when needed, once for the resulting array.

The analyzer warns when known or possibly missing values reach a condition,
index or key without a fallback. `present` preserves shape and yields boolean
elements. `X filter present` and `X (X present)` remove `missing` from the
inferred element types; arbitrary filters retain it. Nullable arithmetic retains
its numeric element type and `missing`, without asserting plain numeric storage.

A column named `NA` cannot be selected with `Data .NA`: that spelling denotes the
missing value. Use an unambiguous column name.


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

`integer`, `real`, `text` and `bytes` are core functions and require no `use`.
`bytes` encodes text as UTF-8 or packs a rank-1 array of integers in `0..255`.
For example, `(array 0 0 255) bytes` creates three bytes without text conversion.
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
Nonfinite real values cannot become integers. Booleans convert explicitly:
`false integer` is `0`, and `true integer` is `1`. `Mask integer` converts
each boolean in an array, preserving its shape. Boolean arithmetic remains
an error; cast the mask before using it in numeric expressions.

`real` preserves a real or converts an integer or decimal text to binary64.
Text must be a complete decimal number, optionally signed and with a decimal
point or exponent, such as `"-2.75"` or `"1.25e2"`. Whitespace, hexadecimal
notation and malformed text are rejected. Conversion can round an integer
that binary64 cannot represent exactly; overflow raises `.InvalidNumber`.

`text` explicitly renders a scalar, retaining its existing optional fixed
format: `2.75 text ".1f"`. Parsing and formatting never happen implicitly on
assignment or arithmetic. Numeric arithmetic permits integer-to-real promotion;
assignment still preserves the established variable type.

`round` changes the numeric value while retaining its type. To round first
and then obtain an integer, write `Value round 0 integer` with `use numbers`.
For elementwise conversion, use `Values real rank 0` or `Values integer`.
Text is parsed as a whole by default;
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

Text supports zero-based addressing and `for` iteration over Unicode code
points. Each code point is a one-character `text` value; combining marks are
separate elements. In an outer array, a whole text value occupies one scalar
cell. Explicit `rank 0` exposes its code points and returns an array-shaped
result, without first splitting the text into an array of strings. The editor
should make quotes cheap to enter, but quotes remain ordinary source syntax.

A quoted literal understands `\n`, `\t`, `\"` and `\\`.

### Multiline text

`text … end` writes one text across several source lines, so a keypad, map or
lookup row can use the whole width of a narrow screen. Every line inside the
block is an ordinary quoted literal. By default the lines are glued into one
text with nothing between them; the value is still a rank-1 sequence of code
points, so a grid is addressed with its width:

```rank
Pad = text
  "....."
  ".123."
  ".456."
  ".789."
  "....."
end
Key = Pad 6
rem "1"
```

`text lines … end` joins the lines with `\n` instead, and there is no trailing
line break:

```rank
Message = text lines
  "First line"
  "Second line"
end
```

The quotes make every space explicit, so `"  #  "` keeps its leading and
trailing spaces. `rem` lines and blank lines between the quoted lines are
ignored. A block is the whole right side of an assignment, with nothing after
`end`; name the text before applying anything to it. Any other word after
`text` is a syntax error. `text` remains an ordinary function and module name
everywhere else, as in `Number text` and `use text`.

---

# Modules, programs and inputs

## Standard modules

Native sources remain repeatable in the REPL and file execution. After
`G' = primes`, every `G till 100 sum` returns `1060` and a preview of `G`
begins at `2`. `H' = G` preserves repeatability. Ordinary binding completes
finite results; binding `G = primes` rejects a known infinite result.
Single-pass generators retain their resource identity and REPL replay tapes.
Preview and inspection share a cooperative computation budget, including work
before the next value is yielded. Reaching it stops that observation without
retaining a repeatable plan's result; a later observation recomputes. The viewer
shows `Inspection work limit reached` for a window stopped by this limit.
See [sequence previews](design/generator-previews.md).

Ranges (`to`, `till`, `by`), `len`, `sum`, `min`, `max`, and explicit
conversions `integer`, `real`, `text`, `bytes` are available
without imports. The catalogue groups them under `core`; no `use core` is
needed. User code cannot redefine these available names. `numbers` still provides `sqrt`, `abs` and number theory; `sequences` provides shapes, ordering and sources such as
`fibonacci`.

```rank
Values = 1 to 5
Values len
Values sum
Values min
Values max
```

`use cli` enables `arg`, `flag` and `args`. Without it, a
program cannot declare command-line inputs. `use testing` enables test blocks.

A bare module name opens standard-library vocabulary in the current workspace:

```rank
use numbers
use random
use linalg
use bits
```

Parsing does not depend on which modules were opened. `use` enables the
corresponding meanings, validators and execution rules after parsing.

### Available builtin names

Builtin function names are unique throughout the standard library. Modules
control visibility; two modules cannot export different builtins with the same name.

User code cannot redefine an available builtin name. Core names are always
available; other names become protected when their standard module is opened.
The rule applies to function declarations, parameters and local bindings, and
to unqualified imports of user functions. Names from unopened modules remain
available: a program may define `solve` without `use linalg`.

Conflicts are errors in either order. A source unit containing both
`fun solve ...` and `use linalg` is rejected before execution. In a persistent
session, opening `linalg` after defining `solve` fails without activating the
module. A qualified import such as `use "worker" as W` keeps `W.solve` separate
from the caller's builtin `solve`.

Function aliases are allowed. `op = matmul` retains builtin operation identity,
including forms such as `A B op axis 1 0`. Reassigning an alias to another
function requires the next call to resolve that identity again.

Receiver methods keep their contextual dispatch. `Dsu findroot X` calls the DSU
method when `Dsu` is a DSU. For another receiver it resolves `findroot` as an
ordinary function. A user function with that spelling is legal only while the
module supplying the builtin name remains unopened.

Removed builtin spellings produce a migration diagnostic when the receiver type
is known. The former `Dsu find X` and `Dsu find X` calls report
`DSU find is now findroot`, both during execution and in `rank check`.
These spellings are not aliases; collection search still uses `Values find Target`.

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

A named `run "worker"` also selects `worker` for subsequent bare runs. Imports
and nested runs executed inside `worker` do not change that selection after it
returns, including when execution raises an error.

Running a file from the host, as in `rank worker.ra`, performs an implicit run.
Rank does not require a `main` function.

## Program inputs

Declare program inputs with `use cli`. The import is required even when all
inputs have defaults or receive values from the workspace.

`arg` declares an input parameter of a program. It is broader than a
terminal-only CLI option: a caller may bind it through the current workspace, a
command-line adapter, a browser host or another runner.

```rank
use cli

rem Upper boundary, excluded.
arg Limit integer = 1000
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
use cli
args "--limit" "10"
run
```

The workspace value wins when both are present. Every selected value is checked
against the declared type before program statements execute.

Positional and boolean inputs use the same model:

```rank
use cli
arg Input path
arg Numbers integer array
flag Verbose
```

`array` collects remaining positional values or repeated named values into a rank-one array and must be the last `arg` declaration. Named inputs bind first; positional inputs fill the remaining declarations in order. A declaration
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

Finite lazy boolean sequences and masks are also evaluated and checked element
by element; a false element fails the test. Known infinite sequences cannot be
used as standalone assertions: bound them first. Standalone sequence expressions
are consumed by the test runner, including generator effects and errors.

`equal` remains elementwise. Mixed sequence/array comparisons use array
broadcasting rules, and incompatible shapes raise `.DimensionMismatch`.

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
  `counter`, `multiset`, `orderedset`, `fenwick`, bounded integer `groups` and segment trees;
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
A rejected write reports where the plan was bound (source, line and column),
while the error location still points to the attempted write.

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
A gcd B
```

Conceptually, the value comes first and selectors follow.

A unary function follows its input: `A sum`. A binary function takes one
operand on each side: `A gcd B`. Addressing stays inside each operand:
`Matrix i matmul Other j` multiplies the selected rows. A following known
function or a `rank`/`axis` modifier ends the right operand.

Declare a binary function in the same order:

```rank
fun Acc step X = Acc + X
Result = 2 step 3
Prefix = (array 1 2 3) scan step
```

`scan`, `reduce`, `outer` and `segment` receive the function value and pass
its two arguments directly. They do not require two parameters on the left
of the function name. Direct aliases retain the same operand placement.
Existing declarations with both parameters on one side also use the binary call convention.

Functions with three or more required operands retain their declared operand sides.
Group operands when a selector or another call would otherwise cross their
boundary. A field read belongs to its operand: `Z matmul Model .weights`
passes the `.weights` field as the right operand.

Inside an address, a field label addresses what it reads, so selectors can
follow it: `Rows 0 .attributes "Rate"` reads the `.attributes` object of the
first row, then its `"Rate"` entry. An object addressed by an array of text
keys returns the entries in the order listed.

A few operations declare a label written after their name as a modifier that
chooses the form of their result instead of a field of it: `Text json .flat`
and `Text xml .flat` return a table of nodes, as `Values sort .descending`
reverses the order.

For functions with unary and binary forms, a call without a right operand is
unary: `A min` reduces A, while `A min B` compares A and B elementwise.
`Matrix i min` reduces the selected row; `A min B 0` compares A with the
selected element of B. A following function starts another pipeline step:
`A min B sum` means `(A min B) sum`. Arithmetic on the left completes before
the call: `2 + 3 min 4` means `(2 + 3) min 4`. Group arithmetic on the right,
as in `0 max (Limit - Used)`.

Core names cannot be redefined by a local function or parameter.

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

Tensor iteration walks axis 0 by default. Select axis 1 to visit columns:

```rank
for Column j in M axis 1
  Column print
end
for Value i j in M axis 0 1
  Value print
end
```

Selected axes are removed from each value. The loop visits their coordinate
combinations in row-major source-axis order, regardless of the written axis
order. Indices follow that same order, may be omitted from the right, and may
be skipped with `#`. Negative axes count from the end. Duplicate axes, invalid
axes, too many bindings and a loop `rank` modifier are errors. See
[Tensors](language/tensors.md#iteration-along-selected-axes) for examples.

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

A scalar integer selector removes its axis. `#`, a range or a rank-1 boolean
mask preserves one axis. An integer array replaces the selected axis with its
entire shape. For `T` with shape `2 3 4`, `T # 1` has shape `2 4`, while
`T # # 1` has shape `2 3`.

Several collection selectors form a Cartesian selection rather than paired
coordinates:

```rank
Block = A Rows Columns
```

Each integer-array selector contributes its shape in source-axis order; `#`,
ranges and rank-1 masks contribute one axis each. Omitted trailing axes keep
their shape. Several index arrays still form a Cartesian selection.

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

`axis` modifies an operation; positional selectors address tensor axes:

```rank
Means = A mean axis 0
Column = A # j
```

The first expression reduces axis 0. The second selects position `j` on axis 1.

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

## Positional prefixes and tails

`Values take Count` keeps at most `Count` leading items, and `Values drop Count`
skips them. `Count` must be a nonnegative integer; counts beyond a finite
source are clamped. Text counts Unicode code points. Arrays return lazy views
along their leading axis, preserving other dimensions. Sequences remain lazy
and preserve single-pass behavior. `take` reads no extra item and closes its
iterator on completion. `take 0` does not read the source. `drop` traverses
the skipped prefix when demanded. Postfix `array` materializes the result.

`primes take 5` selects five primes by position. `primes from 5` starts at the
first prime at least 5, a value bound. Both kinds of clause apply to any
sequence; an ordered source seeks to a value bound instead of reading up to it.

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
at most 100 (see [Bounds](#bounds)).

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

An integer array is a selector for arbitrary positions. Real arrays, including
those whose values are whole numbers, require explicit conversion with `integer`
or `floor` before use as indices. Inline `array` remains unambiguous because it
consumes the rest of the expression:

```rank
Letters = Text array 0 2 6
Rows = M (array 2 0 2) #
```

A selector can also be named and reused:

```rank
Order = array 2 0 2
Rows = M Order #
```

Positions are returned in selector order and may repeat. A scalar integer
removes its axis. A range or rank-1 boolean mask retains one axis; an integer
array replaces that axis with its full shape, including empty dimensions.
An integer-array selector in the first position applies to the leading
axis: `A Ix` has shape `shape(Ix)` followed by the trailing axes of `A`.

```rank
use sequences
Ps = (0 till 10) * 3
Ix = (0 till 6) reshape 2 3
B = Ps Ix
rem shape 2 3, values 0 3 6 / 9 12 15
```

A full-shape boolean mask continues to select matching atoms as a rank-1
result.

Text uses the same rules over Unicode code points. Selection returns text rather
than an array of one-character text values.

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
when addressing finds no value, including a negative or out-of-bounds index.
`default` does not hide type errors or failures such as division by zero.

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

### Block scope

`if`, `elif`, `else`, `for`, `try`, `catch` and `finally` bodies are blocks. A
name first assigned inside a block exists only until its `end`. An ordinary
assignment to a name that already exists outside updates it in place. To use
a value after the block, assign the name before it:

```rank
Kind = "lower"
if Score greater Best
  Kind = "record"
elif Score equal Best
  Kind = "tie"
end
Kind print
```

Iteration and index names in a `for` header, and error names in `catch`, must
not match a visible outer name. A conflict is reported before execution,
including when the outer name comes from an earlier notebook or REPL cell.
Sibling blocks may reuse a name once its earlier block has ended. Ordinary
assignments in block bodies can still update outer names, including accumulators.

Reading a block's name after its `end` is reported before the program runs,
and so is reading a name before its first assignment. A loop iteration therefore
never sees a value the previous iteration left in a body name; a value carried
between iterations is assigned before the loop, like an accumulator. Inside a
loop the name keeps one type for every iteration: a body name bound
to an integer on the first iteration cannot receive an array on the second.
Once the outermost loop ends, the name is free again and may be assigned with
any type.

## For

Rank uses one `for` statement for every kind of loop. Ranges and sequences are
ordinary iterable values:

```rank
for i in 1 to 10
  i print
end
```

Iteration and index names belong to the loop and do not exist after `end`.
A name that is already visible outside the loop cannot be used in its header.
To keep the last item, assign it to a separate outer variable:

```rank
Last = 0
for I in 1 to 10
  Last = I
end
Last print
rem 10
```

Each named loop item is recursively completed when bound. The iterable is
consumed directly without retaining its whole source. Loop names have no
apostrophe form. The optional index name binds a ready integer (a text key for an object).

A condition after `for` is evaluated before every iteration:

```rank
for B not equal 0
  R = A mod B
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
Sum = 0
for I in 1 to 5
  if I mod 2 equal 0
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
Index = new index
for (X in Index)
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
traversal axes and coordinate bindings are defined in [Tensors](language/tensors.md).

## Errors and exceptions

Static analysis can combine requirements from several uses of one binding,
including requirements inside a directly called function. New contradictions
report both source lines, for example:

```text
DimensionMismatch: rank conflict
line 2: 2 selectors need rank >= 2
line 3: rank 0
```

These messages describe incompatible requirements. They do not certify the
shape or type of external data, remove runtime checks, or change the result
shape of an empty ranked frame. Guarded uses and unknown callbacks may remain
unresolved. Ordinary `rank R` accepts ranks larger than the operand rank and
negative ranks; it does not impose a minimum input rank by itself.

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
Original = Error .Value default Default
Cause = Error .Cause default Default
Trace = Error .Trace
```

`.Kind` is a label, `.Message` and `.Trace` are text, `.Value` is the optional
value attached when the error was raised, and `.Cause` is an optional earlier
error. Addressing `.Value` or `.Cause` when it is absent produces `.Missing`,
so `default` can provide a default. The error name belongs to its `catch`
block, must not match a visible outer name, and follows the same inferred-type
rules as other names. To retain the error, assign it to a separate outer variable.

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
fun A gcd B
  for B not equal 0
    R = A mod B
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

fun X next
  return X + 1
end
```

Loading a source file with `use` registers its top-level functions without
executing its ordinary top-level statements.

Unary calls follow their input; binary calls put one operand on each side:

```rank
G = A gcd B
Result print
```

### Parameter evaluation and argument boundaries

`fun Values use_values` completes an incoming plan on entry, including plans
inside tuples, records and containers. `fun Values' use_values` keeps the
argument without completing it. The body executes at the call; returning a
plan leaves the receiving binding to keep or complete it.

A native consumer demands a returned plan before dispatching on its value or
rank. For example, `Source total print` computes a plan returned by `total`
before printing it. This demand does not retain the result for a later call.

Ordinary expression evaluation follows operand order and stops at the first
error. During plan construction, whole user calls run immediately; the remaining
operations stay deferred. Ranked and filter callbacks run when their cells or
items are demanded.

A completed postfix operation can itself be an argument:

```rank
use sequences
fun Values' weighted Factor = Values * Factor
Source' = 1 to 4
Result' = Source sum 2 weighted
Saved = Result
```

`Saved` is `20`. The reduction stays deferred through `weighted`; an ordinary
`Values` parameter would complete it once on entry instead.

Receiver methods can change argument boundaries. `Tree sum Index` is a Fenwick
query, while `Values sum` is a reduction. When such a call precedes another
function, a known receiver kind settles the grouping without reading cells.
An unknown kind is demanded for dispatch; that demand does not retain its
result. Parenthesizing the complete argument fixes its boundary:
`(Tree sum Index) Factor weighted` can pass the whole query without inspecting
the receiver first. Each later demand still runs the query again.

### Call-shaped signatures

A header places each parameter where its argument appears in a call. Uppercase
names before the first lowercase name are left data operands. That first
lowercase name names the function. After it, uppercase names are right data
parameters and lowercase names are function parameters:

```rank
use numbers
fun Value rounded Places = Value round Places
fun X Y apply op = X op Y

1.234 rounded 2
2 3 apply +
```

Function parameters accept named functions and binary arithmetic, comparison,
and boolean operators. Inside the body, `X op Y` calls the supplied operation.
In a binary call, selectors stay inside their operand. Group the complete call
before indexing its result: `(A op B) i`. Functions with more required operands
follow the positions in their header.

A dotted lowercase word declares an optional group. Its argument is data; the
call writes the word without the dot:

```rank
fun Value scaled
  .by Factor=2
  .plus Offset=0
  return Value * Factor + Offset
end

3 scaled
3 scaled plus 1
3 scaled by 4 plus 1
```

Immediately following lines that start with `.word` continue the header. The
first line that does not start with a dotted word begins the body. Keep optional
groups in declaration order; groups may be omitted but cannot be repeated.
A declared word takes precedence over a function of the same name at that
position. Any lowercase word is allowed, including keywords such as `.if`,
except `.axis` and `.rank`.

Defaults are scalar literals: numbers (including negative numbers), text,
booleans, and labels. They do not evaluate expressions or read names. Without
an explicit default, the parameter receives `.NA`. Passing `.NA` explicitly
uses the same default as omitting the group. Required positional parameters
have no defaults.

`rank` and `axis` belong to the interpreter. Only positional data operands,
including right data parameters, receive cell ranks; function operands and
optional configuration stay fixed. One data operand accepts one rank and an
optional axis selection. With two data operands, `rank L R` sets both cell
ranks; `rank L` changes the first and keeps the second operand's declared rank
(or its whole value). These modifiers never bind a parameter in the body.

The [fold demo](../demos/classic/fold.ra) implements reduction with
`fun Values' fold op .with Seed`. The deferred input is consumed once.
An omitted seed starts from the first item;
an explicit seed processes every item. Empty input requires a seed and returns
it unchanged.

### Return contracts and argument ranks

Each function specialization has one return type and one return rank. Calls with
matching argument types and ranks share that contract; axis lengths and scalar
values do not create new specializations. A vector and a matrix can therefore use
the same function:

```rank
fun Values double
  return Values * 2
end

Vector = (array 1 2) double
Matrix = (array 1 2 3 4 shape 2 2) double
```

The analyzer keeps the two results separate: `Vector` has rank 1 and `Matrix` has
rank 2. Within either specialization, every reachable return must agree. A branch
that returns a scalar for an empty input and a vector otherwise violates that rule.
Return a vector in both cases, for example `array 0` for the base case. Different
vector lengths are allowed, including zero.

Known contradictory returns produce an editor error, including in functions that
have not been called. Type guards can separate specializations; unresolved calls
and unsupported analysis paths remain subject to runtime checks. At runtime, the
first successful return settles the contract. A later conflicting result raises
`ReturnTypeMismatch` or `ReturnRankMismatch`, including through memoized and tail
calls. Each closure owns its contracts. Redefining a function starts new contracts.

Known array element types distinguish type specializations, which share the
return rank for the same argument ranks. Empty arrays do not settle an element
type. Direct lazy array arguments are not read to choose a specialization.
Known operator types propagate without executing cells; views and copies retain
that information. Reading cells or calling `copy` does not change specialization.
An unresolved lazy element domain stays unresolved after materialization, with
runtime return contracts retained. Returned lazy elements are checked as they
are consumed; the first concrete cell settles their recursive element contract.
Dense arithmetic and `choose` fast paths only borrow stored operands, so unread
operands stay lazy. See [Type contracts](language/type-contracts.md#lazy-call-specialization).

Record arguments also distinguish specializations by their field names and
recursive field types, including array ranks and established cell types. Field
order and array lengths do not distinguish them. Record construction and field
assignment validate array cells, including lazy cells, before those records are
passed to a function.

Within one specialization, returned records must have the same recursive schema.
Being `.record` on both paths is not enough: a field cannot be absent, change
type, or change array rank. Empty arrays may defer cell types until a nonempty
value establishes them. A schema conflict raises `ReturnTypeMismatch`.

For results with different meanings, return a record with an explicit tag and
consistent fields:

```rank
fun Found answer
  if Found
    return record
      .kind = .found
      .values = array 42
    end
  end
  return record
    .kind = .missing
    .values = array 0
  end
end
```

Both paths return a scalar record with a symbol `.kind` and a rank-1 integer
array `.values`. The caller inspects `.kind` before using `.values`.

### Making recursive return types inferable

Start with the result for one argument specialization. Write down its type and
rank, then check the base case and every recursive return against that choice.
A recursive call can use another specialization, but its result must still fit
the caller's return contract.

For integer input, this function has an integer base case and an integer
recursive step:

```rank
fun N factorial
  if N less 2
    return 1
  end
  return N * ((N - 1) factorial)
end

Result = 5 factorial
```

The analyzer starts from the base return and checks the recursive step assuming
that contract. Mutual recursion can obtain its base return from another member
of the group. A cycle with no reachable base return cannot supply a result type.
Knowing a result type does not prove that every call terminates.

Use this checklist when a return conflicts or stays unknown:

| Situation | What to do |
| --- | --- |
| The base returns `0`, while the recursive step uses `/` or a real accumulator | Use `0.0` when the intended result is real. Use `//` only when floor division is the intended calculation. |
| An empty case returns a scalar, while other cases return an array | Return an array of the same rank in the empty case. Its length may be zero. |
| A flag selects two operations with different result types or ranks | Give the operations separate functions, or use one tagged record representation for both results. |
| A tree leaf returns a value, while a branch returns a container | Use the same record fields and recursive field types for both. Include a tag and same-typed unused values, or use separate functions. |
| Different argument types select different cases | Use type guards. These cases may already have separate specializations and do not always need separate functions. |
| A helper's result is unknown | Check that helper and its call arguments first. A wrapper around an unknown result does not prove its type. |
| A recursive helper changes captured arrays or reads guarded indices | Check for an analysis limitation. A stable return contract alone does not prove cell types or safe reads. |

#### When to split a function

Suppose `N Mode calculate` computes an integer factorial for one boolean mode
and its real reciprocal for the other. Both calls have the same integer/boolean
argument signature, so the different boolean values cannot select different
return contracts. Give the operations separate entry points. Alongside
`factorial` above, define:

```rank
fun N reciprocal_factorial
  if N less 2
    return 1.0
  end
  Previous = (N - 1) reciprocal_factorial
  return Previous / N
end

Count = 5 factorial
Weight = 5 reciprocal_factorial
```

Each entry point now has one result type. Keep the choice at the call site or
return a tagged record if callers need one shared interface. A wrapper that
chooses between these two results using the original boolean flag would have
the same conflicting contract as before.

A shared recursive traversal may still be useful. It can return one record or
array representation, with separate functions extracting the required results.
Splitting a function helps when it separates contracts or makes data flow
explicit; adding another name around the same mixed return paths does not help.

#### Current limits

The analyzer can still report an unknown result for valid recursive code, for
example when effects pass through an unknown callback or a captured write cannot
be proved to preserve cell types. Rewriting a correct algorithm is optional;
report a small example when a consistent return contract remains unknown.

The original `leetcode/004_medarrs` and `cses/dynamic/021_tilings` demos now infer
results for all their test examples. Median uses the existing scalar binding
contracts after successful assignments; this does not prove every index safe.
Tilings uses a separate effect proof for scalar self-recursion with numeric
captured writes. Inline recursive arithmetic and a named intermediate result
both retain the inferred operand types.

Test the base case and recursive cases, including empty inputs and every result
variant. Passing tests check those executions; they do not by themselves prove
that all return paths have one contract. See the
[decision-tree demo](../demos/deepml/020_tree.ra) for a recursive function whose
leaves and branches share a record result.

### Single-expression functions

A lowercase name before `=` defines a function. An operation pipeline needs no
named parameters:

```rank
products = reduce * axis 1 max
multiply_abs = matmul abs
```

The entry stage supplies the complete set of supported argument counts. Thus
`positive_max = max abs` accepts either one value or two values. Calls use the
unary or binary operand positions of the entry stage. Only the entry stage receives the original
arguments; each later stage receives one result, including an array or tuple as
one value. A later stage that cannot accept one value is rejected when the
definition is analyzed: `f = abs matmul` needs an explicit second operand.

An explicit parameter declaration starts with `fun` (or `memo`). Its `=` body
implicitly returns one expression:

```rank
fun V products = V reduce * axis 1 max
fun A multiply_abs B = A matmul B abs
fun A f B = (A abs) matmul B
```

Single-line and multiline declarations have the same scope, signature and
constant binding. Defaults may precede the body delimiter:

```rank
fun X scaled .with Factor=2 = X * Factor
memo X square = X * X
```

The old `inc X = X + 1` spelling is removed; write `fun X inc = X + 1`.
Parameterless function-expression bindings, including `test = first equal 1`,
remain replaceable. A `fun` or `memo` declaration cannot be assigned another
function or redeclared within its scope. The REPL releases a declaration when
replaying its edited source; a clean restart creates fresh declarations.

A composition receives whole operands by default. Internal operations keep their
own rank rules. A call-site `rank` applies to the complete composition:

```rank
products = reduce * axis 1 max
Answer = (array (H products) (V products) (D products) (U products)) max
```

Here `axis 1` applies to `reduce *`. Each direction is passed to `products`
separately, and the final `max` compares four scalar results.
Similarly, `total = matmul sum` sums the complete multiplication result;
`A B total rank 2 2` instead sums each matrix-cell multiplication separately.

A direct alias, `f = g`, preserves `g`'s identity and all argument counts, even
when `g` takes no arguments. To evaluate a factory now and bind its returned
function, explicitly group the entire expression: `f = (10 make)`. The ungrouped
`f = 10 make` is rejected. The grouped expression must return a function.
Function bindings and function-valued parameters use lowercase names; ordinary
data bindings use uppercase names. The existing index names `i`, `j`, and `k`
remain valid.

Source imports register block declarations as before, then process `use` and
`=` function definitions in source order. They do not run ordinary data
assignments or expression statements. A function factory used during import
therefore needs its inputs to come from imports or its own arguments, rather
than an unexecuted module assignment.

### Function equality

`equal` compares function identity. Two references to the same function are equal;
separately defined functions are distinct even when their source and results match.
Reading the same standard function repeatedly returns the same object within one
interpreter:

```rank
use numbers
f = abs
f equal abs rem true
abs equal abs rem true
abs equal sqrt rem false
```

Each call that creates a local function creates a distinct closure, even when the
captured values match. Copying a function reference preserves its identity. Defining
a function again creates a new object; saved references still refer to the old one.
Functions supplied by standard-library modules are distinct across interpreter
instances. User code cannot redefine available builtin names, including through
parameters or local functions. Names from unopened modules remain available to
user functions. Aliases preserve the identity of the function they reference.

## Memoized functions

`memo` declares a value-returning function with a cache:

```rank
memo N fib
  if N less 2
    return N
  end
  return ((N - 1) fib) + ((N - 2) fib)
end
```

The header uses the same parameter rules as `fun`, without an additional
`fun` keyword. Defaults are applied before forming the cache key, so omitted
and explicit `.NA` groups share a cache entry. The complete, typed argument tuple is the
cache key. A cache hit returns the stored result without running the body.
Successful results are stored after the call completes, including its
`finally` blocks. Errors are not cached.

Arguments and results must be scalar integers, real numbers, booleans, text or
labels. Integer and real keys are distinct. Collections, functions, files and
sequences are rejected. A memoized function must not contain `yield`.
A memoized result must depend only on its arguments. Captured and module data
are forbidden, including dependencies read through other functions. Local
calculations and accumulators derived from arguments are allowed. Observable
side effects such as printing or random input are forbidden, because a cache
hit skips the body.
Mutable function aliases are external dependencies too; call a declared helper
directly so its dependencies can be checked.

The cache belongs to the function object. Aliases share it; redefining the
function creates a new cache. Each call of an outer function creates fresh
local memoized functions:

```rank
fun N solve
  return N fib

  memo X fib
    if X less 2
      return X
    end
    return ((X - 1) fib) + ((X - 2) fib)
  end
end
```

Each `solve` call starts with an empty cache. Its local function cannot escape
the call; the host garbage collector can reclaim the function and its cache
afterward. There is no size limit, expiry or explicit clearing operation.

Recursive and mutual calls use the cache and the explicit Rank call stack.
Calls into memoized functions retain the continuation that stores the result;
they do not use the frame-replacing tail-call optimization. Ordinary `fun`
tail calls keep their existing behavior.

## Local functions and closures

A function may declare functions directly inside its body. Local functions are
registered when the enclosing call begins, so their definitions can stay after
the executable lines and even after the outer `return`:

```rank
fun Base addFive
  return 5 add

  fun Value add
    return Base + Value
  end
end
```

A local function can read its enclosing parameters and bindings. Module data
is also readable. These dependencies are read-only: a function cannot rebind
them, mutate their elements or fields, or pass them to a mutating helper.
Pass mutable state explicitly as a parameter or return the updated result.

Assignments belong to the current function. A local name that collides with
an enclosing function's binding is an error; choose another name or declare an
explicit parameter of that name. Parameters may shadow enclosing names.
Blocks within the same function retain the block-scope rules above.

Name lookup follows the function's own workspace, its enclosing lexical
workspaces from nearest to farthest, then the module workspace. A function
does not see local values belonging only to its caller.

Local functions may recurse and may be passed directly to ordinary helpers,
`rank`, `filter` and `sort by`. No callback annotation is required:

```rank
fun X check predicate = X predicate
fun Limit checkFour
  fun X below = X less Limit
  return 4 check below
end
```

Helpers imported from Rank source are checked through their bodies, including
callback forwarding. An opaque host function cannot receive a nested callback,
because its retention behavior cannot be checked. Passing captured or module
state to an opaque helper is also rejected when its mutation behavior is unknown;
pass that state explicitly through the enclosing function's parameters.

A nested function cannot be returned, assigned to another name, or stored in a
container or record as a function value. A computation plan may retain a
snapshot of the function and its dependencies and leave the enclosing call:

```rank
fun Limit small
  fun X below = X less Limit
  S' = 1 to 10 filter below
  Limit = 3
  return S
end
Selected' = 6 small
Selected sum
rem 15
```

Each demand of `Selected` uses the captured value `6`. Ordinary bindings,
ordinary parameters and writes to records or containers complete nested plans
recursively. Postfix `array` also completes nested values and accepts an already
computed array. A plain `copy` does not recursively complete nested resources.

Live nested generators and opaque relations keep separate lifetime rules. A
relation retaining a local predicate cannot leave the call merely by being
stored in a tuple, record or container. Consume its neighbors or traversal
result before returning, rather than returning the live relation itself.

A named callback captured by a plan retains the current values of its external
dependencies, including module data and reads through called helpers. Later
reassignment does not change the plan. Arrays keep copy-on-write storage;
captured records and mutable containers reject writes through every alias.
Resources retain their own state and are not restarted by an apostrophe.
Ordinary direct calls read current enclosing bindings each time.

Callbacks in plans may print, use randomness or call an unannotated host function.
Each demand can repeat these effects. Bind the result without an apostrophe to
compute it once and retain it. The read-only rules for captured state still apply.

A multiline function may also be declared directly inside a `for` body:

```rank
for R in 1 till 3
  Offset = R
  fun X addOffset
    return X + Offset
  end
  10 addOffset print
end
```

This prints `11`, then `12`. A loop-local declaration becomes available when
execution reaches it, and its name does not exist after the loop. It can read
loop bindings and enclosing parameters, but cannot be saved for later calls.
The declaration remains constant within its block.

Declarations directly inside a function remain visible throughout the call.
Declarations inside `if`, `try`, `catch` and `finally` are not supported.
Test blocks may declare test-local functions directly. Local functions may
contain further direct local functions.

## Generator functions

A function containing `yield` returns a lazy sequence. Calling it creates the
sequence without running the body. `Stream' = 7 weird` preserves that instance;
`Values = 7 weird` immediately consumes it into a retained array. Execution starts
when a consumer first asks for an element.

Generators may also have no parameters:

```rank
use sequences
use numbers
fun tst
  yield 1
  yield 2
  yield 3
end

G = tst
G sum
tst array
```

`G sum` is `6`; `tst array` creates another generator and produces `1 2 3`.
Every `tst` call creates a fresh single-pass sequence. Reading `G` keeps the
saved instance. Built-in sequences such as `fibonacci` remain repeatable and
keep their identity across name reads. In the REPL, previewing `G` does not
consume it, and rewinding to a consuming statement resets its consumption.
See [generator previews](design/generator-previews.md).

A one-parameter generator follows its input:

```rank
use numbers

rem Generate the Collatz values beginning with N.
fun N weird
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
array or other collection is one item and is not flattened. The consumer
receives a value, so a generator may reuse one buffer between yields without
changing what it already emitted. Local variables retain their values between
yields. Errors in the body are raised only when
iteration reaches the failing statement.

If execution reaches no `yield`, the generator produces an empty sequence.
The edit-time analyzer reports different yielded types when it can prove them,
including from known call arguments. Unknown types are not rejected. The
interpreter does not check that yielded items have one type.

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
when that scope exits normally, returns or raises an error. A resource bound
inside an `if` or `for` block stays owned by the enclosing function, test or
program: the block ends the name, not the resource.

Returning a resource moves it into the caller's ownership scope:

```rank
fun Path source
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

`mod` is floor modulo (the remainder): a nonzero result has the divisor's sign. For integer
operands and a nonzero divisor, `A equal (A // B) * B + A mod B` is always true.
For example, `-5 mod 3` is `1`, `5 mod -3` is `-1`, and `-5 mod -3` is `-2`.
With a positive integer modulus `M`, `X mod M` is already in `[0, M)`;
`(X mod M + M) mod M` is unnecessary.

`mod=` updates a variable in place (`Total mod= 1000000007`). `N mod 3 equal 0` tests
divisibility, elementwise on an array. In a `filter` condition the filtered value is
elided before one multiplicative step, so `N filter mod 3 equal 0 or mod 5 equal 0`
keeps the multiples of 3 or 5; `*`, `/` and `//` work the same way.

Real and mixed operands use the same sign rule, subject to floating-point
rounding. A real zero result has the divisor's sign. Division or modulo by
zero raises a Rank error.

`/` always produces a real quotient. `//` is floor division and follows Python's
rounding direction for negative values:

```rank
Digit = X mod 10
X = X // 10
Ratio = 5 / 2
Floor = -5 // 2
```

---

# Sequences and arrays

## Sequences

Ranges and algorithmic sources build sequence plans. An apostrophe binding
keeps the plan; an ordinary binding computes a finite result and stores an array:

```rank
use sequences
Range' = 1 till 1000
Primes' = primes
Fib = fibonacci to 4000000
```

`sum`, printing and iteration demand values. A bounded consumer such as `take`
can stop before the source ends. Materializing a known-infinite result is an
error; use an apostrophe to keep that source as a plan.

`fibonacci` starts with `1 2 3 5 8 ...` and `primes` with `2 3 5 7 11 ...`.
Both are infinite until a bound ends them, and both support ordinary
zero-based sequence addressing:

```rank
Fib' = fibonacci to 100
SixthPrime = primes 5
```

### Recomputing and retaining results

Each demand of an explicit plan recomputes its result. An ordinary binding
retains a computed value for later use. The choice belongs to the program:

```rank
use sequences
fun X odd = X mod 2 equal 1
Candidates' = 1 to 100
Selected' = Candidates filter odd
Count = Selected len
Total = Selected sum
Saved = Selected
Again = Saved sum
```

`Count`, `Total` and `Saved` each run the filter. `Again` reads the stored array.
A plan does not retain the accepted items automatically. Finite prefix consumers
read only the values they need. Arithmetic ranges, membership queries and bounds
may use specialized implementations while preserving these observations.

Deferred clauses capture their source and the values read by their bounds or
conditions. For example, `View' = Values till Limit` keeps the current values
of `Values` and `Limit`; finding an array's endpoint waits until demand.
Rebinding either name does not retarget `View`. The same capture rule applies
to `from`, `after`, `take`, `drop` and `first where`.

Callbacks may perform effects, including printing or calling an unannotated
host function. A later demand repeats those effects. Ordinary function bodies
execute at the call; an outer apostrophe does not postpone their eager local
bindings. Named callbacks retain their creation-time data dependencies as
specified under [local functions](language/control-functions.md#local-functions-and-closures).
Writes to captured record or container state remain forbidden through every
alias. Purity can justify an optimization; it is not required to construct a plan.

A failed computation does not retain its successful prefix. A later demand
starts the computation again and may repeat the effects before the failure.
Cancellation also leaves no computed result for later reuse. Single-pass
resources keep their own consumption state: an apostrophe does not reopen an
input stream or restart a generator.

Use postfix `array` when an operation needs a sequence's array shape or indexing
interface. It completes nested plans too; applying it to an existing array
preserves its shape and completes any remaining cells. Use an ordinary binding
to keep the computed result.

## Open numeric ranges

`#` in a range endpoint means that no boundary is supplied. It is a contextual
marker, not a numeric infinity. Both `to #` and `till #` construct the same
lazy, replayable sequence:

```rank
N = 1 to #
Odd = 1 to # by 2
Down = 0 to # by -1
First = N take 4
rem 1 2 3 4
```

The start and step must be integers; the default step is `1` and zero is an
error. The step determines direction. Indexing calculates `Start + Index * Step`
without reading earlier items. Independent consumers restart their own traversal;
the range does not retain a history of generated items. Elementwise arithmetic
and rank-0 mapping stay lazy.

A range has infinite cardinality until it is bounded. `take K` on the original
range terminates for a finite nonnegative count. `first where` stops at the first
match, and `till Condition` stops when the condition holds; either search may run
indefinitely when its condition never holds. After a filter, even `take K` can
wait indefinitely for another matching item. Such searches remain interruptible.
Full consumption (`sum`, `max`, `len`, or `array`) rejects a source known to be
unbounded. A filtered infinite source retains a conservative full-consumption
guard; that does not prove that its matching result has infinite cardinality.

Value bounds keep their usual meaning, including for descending sequences:

```rank
Down = 0 to # by -1
Empty = Down to -10
rem Empty: the first value already exceeds -10.
Prefix = Down till less -10
rem 0 -1 ... -10
```

Numeric `infinity` is not a range endpoint. Elsewhere `#` keeps its existing
meanings of whole-axis selection and discarded bindings.

### Open slice selectors

An open range used as a selector ends at the selected axis boundary. Naming the
selector preserves this behavior:

```rank
A = array 10 20 30 40
Tail = 2 to #
A Tail
rem 30 40
A (2 to #)
rem 30 40
M # (2 to #)
rem Every row, columns from index 2 onward.
A (3 to # by -1)
rem 40 30 20 10
```

Starts must be nonnegative. A start equal to the axis size selects nothing,
including index zero on an empty axis; a greater start is an out-of-bounds
error. Positive steps stop before the axis size and negative steps stop before
index zero. Explicit index collections still fail for invalid indices rather
than clipping them. Finite sequence slices require an exact axis size, as
existing index collection selection does. Over an infinite source, a positive
open selector remains a lazy infinite sequence; a negative-step selector ends
at index zero. Unknown-size sources retain the existing exact-size requirement.

## Bounds

Four words bound a sequence, an array or text by value. `to` and `till` end
it; `from` and `after` start it. `to` and `from` include the bound, `till` and
`after` exclude it:

| Boundary | Inclusive | Exclusive |
|---|---|---|
| Upper | `to X` (≤ X) | `till X` (< X) |
| Lower | `from X` (≥ X) | `after X` (> X) |

```rank
Fib = fibonacci to 89
rem 1 2 3 5 8 13 21 34 55 89
Small = primes till 20
rem 2 3 5 7 11 13 17 19
Large = primes from 101 take 3
rem 101 103 107
Next = primes after 101 take 3
rem 103 107 109
Window = primes after 100 till 130
rem 101 103 107 109 113 127
```

After a number, `to` and `till` build a range instead: `1 to 10` counts from
1 through 10 and `1 till 10` from 1 through 9. A bound is a value rather than
an item to find, because a sequence need never equal it.

`till` and `from` also take a condition. `till` stops before the first item
that meets it; `from` starts at the first item that meets it and keeps it:

```rank
Leading = fibonacci till greater 50
rem 1 2 3 5 8 13 21 34
Big = primes from greater 100 take 3
rem 101 103 107
Word = "hello world" till equal " "
rem hello
Run = Values till not even
```

The condition's subject is the item, as in [`filter`](#filter-clause): a
comparison with its right operand (`greater 50`), a predicate (`even`), a
function of one argument, `not` and the logical words over those, or a mask.
Text asks the condition of each character. `to` and `after` take only a value.

Bounds continue a pipeline, so they chain with filters and each other in any
order:

```rank
Answer = fibonacci to Limit filter even sum
Even = fibonacci filter even till 1000
Middle = fibonacci from 8 to 100
```

Bounds read items in order and work on any rank-1 value. An ordered source
seeks instead: `primes from 100` starts its sieve at 100, `fibonacci` advances
its recurrence to the bound, and a filter over such a source keeps the
ability. Seeking applies to a plain bound and to `greater` and `at least`
conditions, and gives the same items as reading. Repeated bounds intersect:
`to` and `till` cannot widen a previously bounded native source. Each demand
of a deferred source begins an independent evaluation.

Sequence sources may also accept filters and reductions in their own plan.
For example, filtering `fibonacci` by `even` lets the source produce only
`2 8 34 ...`. A source that has no specialized implementation uses the general
lazy operation with the same observable result.

## Take and drop

`take` and `drop` count items. `take` keeps at most the requested number of
leading items; `drop` skips that many and returns the tail:

```rank
FirstFive = primes take 5
NextFive = primes drop 5 take 5
Prefix = "abcdef" take 3
Tail = "abcdef" drop 3
```

The count must be a nonnegative integer. Counts larger than a finite source
are clamped: `take` returns all its items and `drop` returns an empty result.
`take 0` reads nothing; `drop 0` preserves all items. Text counts Unicode code
points. Arrays return lazy views along their leading axis, preserving the
remaining dimensions. Writes to the source are visible through those views;
use `copy` for an independent snapshot.

Sequences remain lazy, including user generators. `take` stops without
requesting an extra item and closes its reader. A shared pure replay source
remains available to other readers. `drop` traverses the
skipped prefix when demanded. Neither operation makes a single-pass source
replayable. `take` bounds an infinite source by count; `drop` alone leaves it
infinite. Materializing a bounded sequence uses postfix `array`.

## Array construction

Prefix `array A B ...` constructs an array from its items. Scalar items form
one leading axis. Array-valued items must have the same shape and are stacked:
two matrices of shape `3 4` give a tensor of shape `2 3 4`. Their cells remain
lazy; construction checks shapes without reading every cell.

```rank
A = array 1 2 3
B = array 4 5 6
M = array A B
M shape               rem 2 3
M 1                   rem 4 5 6
```

Different array shapes, or mixing arrays and non-arrays, raise
`DimensionMismatch` at construction with zero-based item positions and shapes.
There is no padding. Use `tuple A B` for a fixed group of differently shaped
arrays. Streams and collections can hold array items without constructing a
rectangular tensor; materializing them still requires matching cell shapes.

With explicit `array shape ...` item lists, the declared dimensions describe
the frame: the item count must match that frame, and array items add their
trailing cell axes. `array shape ... fill Value` keeps its allocation contract:
it repeats `Value` as a cell and retains its type even for an empty frame.
Postfix `array` materializes items eagerly as described below.

## Explicit materialization

Ordinary bindings complete finite results, but explicit `array` can still make
an example clearer. Both forms are supported without redundancy warnings:

```rank
use io
Value = stdin .integer
Values = stdin .integer N array
```

`Values` reads an array of `N` integers. The trailing `array` makes that
intent visible even though ordinary `=` would also complete the finite input
sequence. Prefix `array` constructs an array from elements; postfix `array`
converts or materializes a supported source.

Postfix `array` consumes a sequence and stores its yielded items in a dense
array:

```rank
Values = 3 weird array
```

Stored integer `+`, `-`, `*`, `//`, and `mod` can evaluate eagerly over proven
storage and trusted views, including concat segments. This creates fresh results
and preserves earlier aliases; it bounds numeric recurrences without requiring
an explicit `copy` at every iteration. Unsafe readers, inspection, and operations
with deferred failures keep their ordinary path.

Unmaterialized array expressions are limited to 8192 reader layers. Constructing
a deeper chain raises `ResourceLimit` with a suggestion to use `copy` on an
intermediate array. The check reads dependency metadata only and never forces a
cell. Metadata-only dependency nodes add no reader layer, so a balanced concat
rope is not counted as one nested reader per append. Materialization starts a new
chain; retaining old array values intentionally still retains their storage.

Materialization is eager. Scalar or record items produce a rank-1 array.
Array items with the same shape are stacked along a new leading axis: `N`
items of shape `3` produce shape `N 3`, and `N` items of shape `2 3` produce
shape `N 2 3`. Different item shapes, or a mixture of arrays and non-arrays,
raise `DimensionMismatch`. An empty sequence has shape `0`. A single-pass
generator is consumed, and each yielded array is copied before requesting
the next item.

A sequence known to be infinite is rejected. A sequence whose finiteness is
unknown is evaluated until it ends, so materialization may raise a delayed
error or fail to terminate. No module import is required because `array` is the
core array constructor and conversion. A SQLite-backed table view also uses
postfix `array` to execute its query and produce a rank-1 array of object rows;
see [Tables](language/tables.md#sqlite).

Postfix `array` also copies a queue, stack, deque, set or multiset into a
rank-1 array (or a stacked array when every element is an array of one shape),
in the order `for` visits the container: front to back for queues and deques,
insertion order for stacks and sets, ascending order for multisets and
ordered sets. The source is not consumed and later writes to it do not reach
the copy. An empty container gives shape `0`. Postfix `array` is not supported
for counters or heaps and raises an error. This lets
`Reversed array reverse` turn a queue into a reversed array.

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

When `array` has following words, the first of them decides. A function, or a
higher-order word such as `reduce` or `scan`, makes `array` postfix: the source
materializes and the call goes on, so `Values filter Odd array sum` and
`Values array reduce + with 0` work as written. Data after `array` forms a
selector, which keeps `A array 2 0` unchanged; write `(Values array) 0` to index
a materialized sequence.

Postfix `copy` accepts a material or lazy array, eagerly evaluates all of its
cells and returns independent writable dense storage with the same shape:

```rank
use sequences
Writable = Source copy
```

Changing the copy does not change the source. Ordinary array binding already
provides this independence: `Saved = Source` is enough. Use `Saved = Source copy`
when explicitly naming the snapshot operation makes the code clearer.

`copy` also consumes a finite sequence, using the same stacking rule as
postfix `array`:

```rank
fun rows
  yield array 1 2 3
  yield array 4 5 6
end
Rows' = rows
Matrix = Rows copy
Matrix shape          rem 2 3
Matrix transpose      rem requires an array
```

`Rows` retains a stream plan because of its apostrophe binding. `Matrix = Rows`
would also complete it; the explicit `copy` is optional. Before completion, it
is a stream of row values. Iteration can consume one row at a time, including
rows with different shapes. `shape` on the stream describes its one-dimensional
sequence length; `Matrix shape`
describes the materialized tensor. `transpose` does not implicitly consume a
sequence: first bind its finite result with `=`, or use postfix `array` or
`copy` within the expression. User generators remain single-pass.

An array whose cells are arrays or finite sequences stacks them the same way,
with the new axes after its own. Every cell must then be an array or sequence
of one shape; a different shape, or a mixture with scalar cells, raises
`DimensionMismatch`. Series computed as separate vectors become the columns of
a matrix:

```rank
Series = (array Month Interest Balance) transpose
Series shape          rem 360 3 for 360 months
```

Prefix `stack A B ... axis N` is the lazy counterpart of that rule. It joins equally
shaped arrays or sequences along a new axis (axis 0 by default): cells are read from the
arguments on demand rather than copied. Assignment keeps its value semantics,
so writing to an argument name later does not change the stack built from it.
Shapes are checked when `stack` is applied.

```rank
Series = stack Month Interest Balance transpose   rem lazy, shape 360 3
Dense = Series copy                               rem eager, same shape
```

If the arguments are already held in a rank-1 array or tuple,
`stack unpack Items` spreads them into the constructor. This is the replacement for the
former postfix `Items stack` form.

Sequences with an exact size stack lazily; a sequence of unknown size (a
generator or `filter`) raises `TypeError` and points to `copy`, an infinite
sequence is an error, and items of different shapes, or arrays mixed with
scalars, raise `DimensionMismatch`. To materialize a sequence of arrays, use
`copy`.

Prefix `concat A B ... axis N` joins same-rank arrays along an existing axis.
Axes are zero-based and the default is axis 0. The dimensions on every other
axis must match. The selected lengths are added, preserving the input rank
and order: shapes `2 4` and `3 4` give `5 4` on axis 0; shapes `2 4` and `2 3`
give `2 7` on axis 1. Invalid axes or mismatched ranks or other dimensions
raise `DimensionMismatch`. Axis selection never flattens or merges axes.
Its cells are read from the chosen source on demand. With rank-one sequences, including
ones of unknown length, the result is a lazy sequence; mixing rank-one arrays
and sequences also returns a sequence. An array or tuple of arguments can be
spread with `concat unpack Items axis N`.
Repeated same-axis concatenation shares array parts without reading their cells.
Deep concat chains can be read without recursion through every earlier concat;
this also applies to nested sequence concatenation.

## Sliding windows

`window` produces every overlapping, contiguous cell of a fixed size. The
source precedes `window`, and the size follows it:

```rank
Pairs = Text window 2
Windows' = Values window Width
```

Text windows are text values, so ordinary text comparison and addressing keep
working. Windows over a finite numeric vector form a rank-2 tensor whose first
axis selects the window and whose trailing axis contains the window cell. The
deferred expression reads overlapping cells on demand. `Windows = Values
window Width` completes and stores every window cell. An unbounded sequence
may produce windows indefinitely and needs a deferred binding or a finite
consumer.

Exact sequence windows keep their tensor shape. For a source without direct
indexing, full collection and sequential whole-array traversal use a fresh
rolling reader: overlapping cells share source values only within that pass.
The next pass starts the source again. Individual indexed reads may replay a
prefix; indexed sources keep their direct-access algorithms. Strides leave an
unused source suffix unread, and early termination closes the current reader.

For a tensor, write one size per selected axis directly, pass a rank-1
integer array, or unpack a vector of sizes. These forms produce the same windows:

```rank
Blocks = M window 2 3
WindowShape = array 2 3
Blocks = M window WindowShape
Blocks = M window unpack WindowShape
```

Sizes may be variables or grouped computations: `M window Height Width` or
`M window (Height + 1) Width`. Group a function call used to compute a size.
Each size is evaluated once. The size list ends at `stride`, `padding`, `axis`,
or the next operation, so `M window 4 4 diag` reads matrix diagonals directly
from each window. A following `array` still materializes sequence windows.

Without `axis`, the sizes must cover every tensor axis. If `M` has shape
`4 5`, the example has shape `3 3 2 3`: window-position axes come first and
window-cell axes are appended last.

`axis` selects and orders a subset of source axes:

```rank
Columns = M window 3 axis 1

WindowShape = array 2 3
Blocks = T window WindowShape axis 0 2
```

There must be one size for each selected axis. Nonnegative axis numbers are
zero-based; negative numbers count from the right (`-1` is last). After
normalization, axes are unique. Source axes retain their original order in the
position frame; appended window axes follow the stated `axis` order. A scalar size without `axis` is
valid only for a rank-1 value.

`stride` moves by more than one position and `padding` adds symmetric zero
padding before positions are chosen:

```rank
Blocks = M window WindowShape stride 2
Blocks = M window WindowShape padding 1
Blocks = M window WindowShape stride 2 padding 1
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

`default` fills every cell with one evaluated value and therefore needs no block:

```rank
Dist = array shape Rows Columns fill -1
```

The dimensions follow the same nonnegative-integer rule. A zero dimension
creates an empty material array with the declared shape.

A single dimension may instead be a vector of integers, such as the result of
`shape`, so the rank follows the vector's length:

```rank
Dims = A shape
Dist = array shape Dims fill -1
```

`reshape` changes an array's shape while preserving flat row-major indices:

```rank
Shape = array Rows Columns
M = Values reshape unpack Shape
```

It is provided by `use sequences`. Dimensions must be nonnegative integers;
`unpack` expands a rank-1 shape array. Values follow row-major order, and their count
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

Repeated indices in an ordinary compound assignment read the original cells;
the last replacement for each cell wins. For example, `H (array 1 1) += 1`
increments cell 1 once.

Use a trailing `.accumulate` to include every update at repeated indices:

```rank
H = array shape 5 fill 0
Ix = array 1 1 2 1
H Ix += 1 .accumulate
rem H is 0 3 1 0 0
Weights = array 2 3 4 5
H Ix -= Weights .accumulate
H Ix *= 2 .accumulate
```

The modifier applies only to indexed numeric-array `+=`, `-=` and `*=` writes.
For each destination cell, `+=` adds the sum of its updates, `-=` subtracts
their sum, and `*=` multiplies by their product. A scalar RHS broadcasts;
an array RHS must match the selected shape. Repeated indices work along any
selected axis. Selectors and RHS values are captured before any write, including
when they refer to the destination. Bounds, shape and type errors leave the
array unchanged; cancellation during a commit can leave partial updates.

Reduction order is unspecified, allowing parallel implementations. Integer
arithmetic remains exact, including results outside fixed-width storage.
Real-number results may differ in rounding between reduction orders or backends.
Other assignment operators reject `.accumulate`; plain `=` keeps its
last-replacement behavior.

Deferred results of `outer` and `window` are read-only recipes. An ordinary
binding such as `Saved = Plan` completes a finite result and makes it writable;
no trailing `copy` or `array` is required.

A range selects a contiguous run. Arbitrary positions use an integer array as
the selector:

```rank
Part = A (2 till 6)
Picked = A array 4 1 1
Columns = M # (1 to 3)
```

A range preserves one axis; an integer array replaces the selected axis with
its shape. A scalar integer removes its axis. The complete selector rules are defined in
[Values and addressing](language/values-addressing.md).

## Selection with boolean masks

Selection uses Rank's normal addressing model.

```rank
Mask = A greater 0
B = A Mask
```

The mask is an ordinary first-class value. It can be named, reused and combined
before it is applied.

```rank
Mask = N mod 3 equal 0
Mask or= N mod 5 equal 0

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

Applying an array mask fixes the selected positions. Later writes to a
materialized mask do not change an existing selection; a retained mask uses
copy-on-write. Combining masks with `and=`, `or=` or `xor=` binds a new value
and also leaves existing selections unchanged. Lazy array masks cannot be
written by index; bind a finite mask with `Saved = Mask` to obtain a writable
array. An explicit `copy` is optional.

An array selected by a full-shape array mask remains lazy in its selected
values, but knows its exact length. `len` therefore does not read those
values or raise errors deferred in their readers; iteration still does.

A mask contains one boolean per source item. Display, iteration, indexing,
`count`, `any`, `all`, `copy`, and postfix `array` all consume those booleans.
Selection is explicit:

```rank
Mask = Fib even
Selected = Fib Mask
Answer = Selected sum
```

A mask is positional. Its first flag selects the first item of whatever it is
applied to, so a mask built from one value can select from another, and masks
of different values combine flag by flag. The value and the mask are read in
lockstep. A mask shorter than the value ends the selection where the mask
ends, which lets a finite mask bound an endless source. A value that ends while
the mask still has flags is an error.

```rank
Mask = fibonacci till 1000 even
Even = fibonacci Mask
rem 2 8 34 144 610
```

A mask is a predicate, not a bound. `Fib (Fib less 1000)` never ends when `Fib`
is endless: after 987 every flag is `false`, and nothing proves that no later
one is `true`. Bound the sequence with `till` instead.

Predicates and comparisons always produce boolean masks, whether inline,
parenthesized, or stored in an ordinary or deferred binding. Extracting a mask
into a variable does not change what a reduction reads.

Select the source values explicitly before a numeric reduction:

```rank
Answer = Fib filter even sum
Answer = Fib (Fib even) sum
Mask = Fib even
Answer = Fib Mask sum
```

All three forms give 44 for `Fib = fibonacci till 100`. For an array,
`A filter greater 2 sum` adds the cells greater than 2.

`sum`, `lcm`, `mean`, `median`, `std`, `variance`, `skewness`, `quantile` and
`percentile` reject boolean cells. Their diagnostics suggest `filter`, explicit
mask selection, or `count`. Thus both `Fib even sum` and `Mask sum` are errors;
parentheses do not turn flags into source numbers. Empty reductions retain their
ordinary identities or empty-input errors.

`min` and `max` accept booleans and compare the flags themselves (`false` before
`true`), consistently with ordinary boolean arrays. They do not read selected
source numbers. Use `Fib filter even max` for the largest even number.

Use `count` from `sequences` to count true flags. `any`, `all`, `array`, and
iteration also read the boolean flags:

```rank
use sequences
Sv = array shape 5 fill 0
Sv 2 = 1
(Sv equal 0) count       rem 4 true flags
Sv filter equal 0 sum   rem 0 selected sum
(Sv equal 0) max         rem true
```

The runtime may remember a mask's source so that selecting from that same
source pushes the test into it without allocating booleans. This never changes
a result.

Reusing a mask does not promise that its computed bits are cached. A mask
captures the logical values of its operands when it is created, rather than
looking up later assignments to their variable names. This snapshot rule does
not require copying the underlying storage.

Expressions deferred inside a mask must be pure. Operations with observable
side effects are not allowed there, so an implementation may change evaluation
order, fuse operations or recompute values without changing program meaning.

Addressing does not mutate `A` or `N`.

## Filter clause

`filter` selects from a value without naming it twice. The filtered value is
the elided subject of the condition, so a leading comparison operator takes it
as the left operand:

```rank
Large = N filter greater 5
Ordinary = N filter not equal 5
Known = N filter in primes
```

A function condition is a predicate applied to each selected cell:

```rank
Even = N filter even
First = Candidates filter palindrome first
Palindromes = Products filter palindrome rank 0
```

Without a modifier, `filter` passes each sequence item or each array cell
along the leading axis to the predicate. For a matrix, those cells are rows;
the predicate's declared rank does not change this default. `rank R` chooses
cells with R axes. For an array with N axes, the remaining N - R axes form the
frame traversed by the filter. `axis` names the cell axes directly; their
complement is traversed in natural source order. An optional `rank R` must
equal the number of cell axes. Without `axis`, the frame uses the first N - R axes. The predicate returns one
boolean per cell. A predicate over whole rows or columns keeps the other array
axis:

```rank
rem M has shape 3 2
Heavy = M filter row_total
rem Heavy has shape 2 2: the rows the predicate kept

Wide = M filter column_total axis 0
rem Wide has shape 3 1: the columns the predicate kept
```

`Products` above is a matrix, so `rank 0` deliberately tests individual
products and returns a rank-1 selection. A leading comparison on a matrix
produces an atom mask, not one boolean per row; write
`M filter (M greater 3)` to select those atoms explicitly. When a filter
traverses several axes, the retained cells are collected in traversal order;
those frame axes become one axis at their first original position. For an array
with shape `2 3 4`, `filter P rank 1` sends six vectors of length 4 to P
and returns shape `k 4`. `filter P axis 0` sends twelve vectors of
length 2 and returns shape `2 k`. Here k is the number of accepted cells.
Conditions in one filter block must traverse the same axes.

Conditions combine with `and`, `or` and `xor` inside one line. A block combines
complete lines with `and`, as a table condition block does:

```rank
Kept = N filter
  greater 2
  even
end
```

A condition that supplies its own operands is left alone, so an existing mask
or a full comparison still works:

```rank
Kept = N filter (N greater Limit)
```

A bare name is a predicate when it names an operation and the mask itself when
it names data, so a mask computed earlier reads the same with or without
parentheses:

```rank
Mask = N greater 5
Kept = N filter Mask
```

A named function of one argument is a predicate too:

```rank
fun X big
  return X greater 10
end
Kept = N filter big
```

`filter` over a table keeps the table form even when its condition names no
column, because only that form returns rows that are still a table. A table is
a SQLite view or a rank-1 value of rows, and filtering one needs `use tables`.

Filtering a sequence or array builds a lazy result. An ordinary binding such
as `Kept = Values filter even` completes it into an array. An apostrophe binding
keeps the plan. Postfix `array` or `copy` can explicitly materialize a finite
result within a larger expression.

A condition is one predicate, so the pipeline goes on after it. A comparison
takes one operand, a predicate takes its `rank` and `axis` modifiers, and a
function after data takes that data as its data-first arguments (`5 near`).
Everything after the condition applies to the filtered result:

```rank
Total = N filter even sum
Values = N filter greater 5 array
Early = N filter even till 100 take 3
```

`filter` is source syntax over the mask model above, not a separate kind of
value, and it does not change its input. It does not replace a named mask: a
mask can be built from one value and applied to another, which a filter
condition cannot express, because the condition's subject is the filtered
value itself.

```rank
Mask = Labels equal Wanted
Cluster = Points Mask
```

A condition that names a column is a table query instead; see
[Tables](language/tables.md). Filtering a plain array or sequence needs no `use tables`.

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

Directions are symbols and may be written for the whole sort or for individual keys:

```rank
Sorted = Values sort .descending
Order = Values argsort .descending
Rows = Events sort by .cost .descending .name
```

`.ascending` is the explicit spelling of the default direction. In `sort by`
and `argsort by`, a direction belongs to the preceding field or function key.
Descending reverses comparison, preserving the order of ties in arrays. It
works for text and date keys as well as numbers. Plain directions also compose
with intrinsic rank, explicit rank, and `argsort axis`; put direction after
the modifiers. Named array tables retain their header through field sorting.
SQLite emits DESC for descending keys and still needs explicit tie-breakers
for a deterministic order among equal keys. Keep sorting as the final SQL
operation before output when order is required.

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
an unbounded sequence is an error. Field sorting requires object rows or records.
Absent cells sort after present cells; a field absent from every row and from
the table schema reports `.Missing`. A compound source expression must be
parenthesized.

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
M = array shape 2 3 fill 1
Row = array 10 20 30
Result = M + Row
rem Result shape is 2 3
```

A deferred broadcast computes on demand; an ordinary binding stores the
completed result. Repeated plan demands recompute. Incompatible shapes raise
`.DimensionMismatch`. Scalar broadcasting is the rank-0 case of the same rule.
Two sequences retain their lazy elementwise zip behavior, ending at the shorter
input. A sequence mixed with an array uses the shape and broadcasting rules of
its materialized array, in either operand order:

```rank
Q = array shape 3 fill 10
Q + (3 till 0 by -1)
rem 13 12 11, just like Q + (3 till 0 by -1 array)
```

This also applies to elementwise comparisons and scalar numeric functions such
as `max`. A length-3 range broadcasts across the last axis of a `2 3` matrix.
Incompatible shapes raise `.DimensionMismatch`; mixed arithmetic never silently
truncates the array or forms all pairs. Use `outer` explicitly for all pairs.

The mixed operation currently materializes the sequence to determine its full
shape, including any yielded array cells. The source must terminate; a known
infinite sequence is rejected before iteration. Bound streaming sources with
`take` or `till` first. This can use additional memory and runs generator effects
when the operation is constructed. Scalar/sequence operations remain lazy.
Membership (`in` / `not in`) and whole-collection ranked operations keep their
own rules.

Because scalar `+` concatenates two text values, the same array rule provides
elementwise text concatenation and scalar broadcasting:

```rank
Labels = (array "A" "B") + "!"
rem A! B!
```

`**`, `mod` and comparisons are also elementwise over compatible arrays:

```rank
M3 = N mod 3 equal 0
```

## Operation modifiers

Two kinds of trailing words change how an operation is applied.

**Call parameters** say how a function is applied to cells. They follow the
function: `A F rank 0`, `M sum axis 0`.

**Higher-order operations** (`reduce`, `scan`, `segment`, `outer`) take a
function as their argument. The function is the word or symbol right after
the operation, with the other parameters, as in `sort by .field`:

```rank
Total = A reduce + with 0
Prefix = A scan + with 0
Tree = A segment +
Products = A B outer *
States = Steps scan next with Start
Cells = A F rank 0
```

The function is a symbol (`+`, `*`, `and`, `less`), or a name that holds a
function, builtin or user-defined. An operator symbol directly after one of
these four words is its argument, never an infix operator. `scan`, `segment`
and `outer` need the function; the old orders `A + scan with 0` and
`Steps next scan` are rejected with a message that shows the new spelling.
`reduce` also accepts a binary function. If a program binds `scan`, `reduce`, `segment` or
`outer` itself, the symbol form (`A scan +`) is rejected; the name form
follows the binding.

The operation takes everything on its left: `Start + Y scan +` scans
`Start + Y`. In `A B outer *`, `A B` is not evaluated first as addressing.
A completed modified operation can feed the next operation in the same chain:

```rank
Total = "1203" integer rank 0 sum
Prefix = A scan + with 0
Total = Prefix sum
Total = A B outer * sum rank 1 sum
Total = M sum axis 0 sum
```

`rank` consumes its integer argument, or two for `rank L R`; `axis` consumes its axis numbers (and
an optional `rank R`). The following operation receives the modified result.
`with` consumes one seed or identity operand before the chain continues.
For example, `A scan + with 0 sum` sums the scan results. `segment`
constructs the algorithmic collection described in
[Collections](language/collections.md). Operands are evaluated once.
Parentheses remain available to make grouping explicit.


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
A negative rank counts down from the operand's own rank, as in J: `-1` selects
the items of the operand (its rows, for a matrix) without knowing its rank,
`-2` the items of those items, and a rank below a scalar cell is a scalar cell.
`A F rank -1` therefore applies `F` to every item of `A`. In `rank L R` each
operand resolves its own rank.

Infix arithmetic accepts the same two cell ranks as the postfix operator call:
`Scores - Tops rank 1 0` is equivalent to `Scores Tops - rank 1 0`. Each row
of `Scores` pairs with its corresponding scalar in `Tops`; frames broadcast
independently of cells. Both ranks are required. The modifier applies to that
operator before surrounding arithmetic, so `A + A * B rank 1 0` ranks only
the multiplication. Group compound right operands with parentheses. Ordinary
arithmetic without the modifier keeps trailing-axis broadcasting.

```rank
Totals = Matrix sum rank -1
rem one sum per row, for any rank of Matrix
```

An explicit `axis` list names the cell axes passed to a unary function. The
remaining axes form the frame in natural source order. Cell axes follow the
written order: `axis 2 0` passes axis 2 first and axis 0 second, whereas
`axis 0 2` passes axis 0 first. Nonnegative axes count from zero on
the left; negative axes count from the right (`-1` is last). Normalized axes
must be distinct and in bounds. `rank` is optional alongside `axis`; if supplied,
it must equal the number of selected cell axes:

```rank
rem T has shape 2 64 128
A = T F rank 2
rem frame 2, cells 64 128

B = T F axis 0 2
rem frame 64, cells 2 128
```

For shape `2 3 4 5`, `T F axis 0 2` passes `2 4` cells to `F` over a `3 5`
frame. If `F` returns an array of rank 2, its two axes occupy source positions
0 and 2, even when their lengths change. For example, a result cell of shape
`6 7` produces shape `6 3 7 5`. A scalar result leaves shape `3 5`; an array
of a different rank appends its axes after the frame. Text, tuples and sequences
remain boxed cell values. With `axis 2 0`, the same `6 7` result cell instead
produces shape `7 3 6 5`: result axis 0 maps to source axis 2 and result axis 1
to source axis 0. This also applies when all source axes are selected.
Bare `rank` retains frame-then-cell assembly. Operations whose result axes are
new axes, such as `covariance`, `correlation` and `corr`, declare append placement:
their feature-by-feature matrix always follows the batch frame. Order-invariant
reductions keep their existing axis-set semantics.

Every cell result must have the same shape. Scalar results leave only the frame
shape; array results append their shape to the frame. Source cells and the
assembled result are native readers. Shape facts can survive a read, but
computed cell values are retained only within one traversal. Ordinary binding
completes the result; deferred binding recomputes on demand.

Selecting a result cell also demands its producer when the cell has no scalar
elements. Indexing, gathers and ranked loop bindings preserve this boundary;
they do not demand unrelated frame cells. Repeated indices are repeated
observations, and an empty selection calls no producer. A loop completes its
selected cell before entering the body, so an early `break` leaves later cells
unevaluated.

Ranked and axis reductions preserve this producer boundary. The identity of an
empty reduction does not replace the callback that produces its input cell.

An empty application frame makes no call to its operation, but keeps the result
cell axes, so its rank does not depend on whether the input is empty. A declared
result shape takes precedence. If a pure standard-library function has no result-shape
hook, the runtime may call it once on a zero cell of the argument cell shape
when that cell is small enough; only the resulting shape is kept. A user
function is not called. Its result shape comes from the analysis of its body,
or from the return rank that earlier calls settled. Lengths that neither fixes
are zero. With no such knowledge the cell is a scalar:

```rank
M = array shape 0 3 fill 1
Sorted = M sort rank 1
rem shape 0 3
```

An operand can still contain nonempty producer frames of empty cells. Completing
the new result observes the selected upstream producers without calling the new
operation. Producer axes retained by framing remain selectable; consumed axes
are observed together within a result cell. A genuinely empty combined producer
frame makes no calls. This does not force unused nonempty operands.

`integer` converts a complete text value by default and maps arrays while
preserving their shape. Explicit `rank 0` converts individual Unicode code
points and returns a rank-1 array:

```rank
Value = "1203" integer
Digits = "1203" integer rank 0
rem Value is 1203; Digits are 1 2 0 3
```

Rank-0 application over text uses Unicode code points, including non-BMP
characters as single elements. A one-code-point operand broadcasts across a
longer text frame:

```rank
Open = "((2×3)+4)" "(" equal rank 0
Delta = Open integer
rem Open is a boolean array; Delta contains 1 or 0
```

Text remains a scalar cell within an outer array, so `Words len rank 0`
measures whole words. Rank-0 application over a lazy sequence remains lazy.

### Binary comparison rank

Infix comparisons keep their elementwise behavior. Postfix comparisons accept
an explicit cell rank and return one boolean for each pair of cells:

```rank
A equal B
A B equal rank 0
A B equal rank 1
A B equal rank 2
```

`rank 0` compares individual array elements. `rank 1` compares whole vectors,
or corresponding trailing rows of matrices. `rank 2` compares whole matrices.
A rank at least as large as an operand's array rank uses that operand whole.
`equal` and `not equal` compare cell shapes and nested values. `less`, `greater`,
`at least` and `at most` order cells lexicographically by their items in storage
order: the first difference decides, a matching shorter prefix comes first,
and shape dimensions break ties when all items match. Incompatible scalar
families still raise `.TypeError`. Text remains an atomic value in these binary
comparisons.

The leading frame shapes use trailing-axis broadcasting. For example, a
matrix and a vector with `rank 1` compare every matrix row with that vector.
Incompatible frame shapes raise `.DimensionMismatch`. Different cell shapes
are unequal; they are not broadcast inside a whole-cell comparison. Results
are computed on demand over array frames. Ordinary binding stores their values;
deferred binding keeps the captured inputs and recomputes.

An explicit `axis` list names cell axes for **both** array operands. The
remaining axes form each frame in natural source order:

```rank
A B equal axis 1
A B equal axis 0
A B less axis 0 count
```

For matrices these compare rows, columns, and count columns of `A` that sort
before the corresponding columns of `B`. Axis numbers must be unique and in
bounds. A redundant `rank R` must equal the number of selected axes.
Explicit axes require arrays on both sides.

Sequences stay lazy at `rank 0`; a higher rank materializes a bounded sequence
for comparison as one vector. Known infinite sequences are rejected for a
whole-vector comparison. These explicit binary forms currently apply to the
six comparison operators above; general binary function rank remains deferred.

## Reduce

`reduce` is a left fold. The combining function receives the accumulator and
next input cell, and returns the next accumulator:

```rank
Total = A reduce +
Total = A reduce + with 0
Best = M reduce pick rank 1 axis 0
```

`axis` selects one or more distinct source axes to traverse. Remove those axes
first, then `rank R` selects the trailing `R` remaining axes as the input cell,
in source order. The earlier remaining axes form independent folds. The default
is `rank 0`, so ordinary reduction consumes individual elements. The input cell
rank plus the number of traversal axes must not exceed the source rank. With
neither modifier, all scalar elements are folded in row-major order. An explicit
`rank R` always requires an explicit `axis`, including `rank 0`.
The order of an explicit axis list does not change traversal order.
`rank` and `axis` may appear together, in either order, before optional `with`.
Reduction ranks are nonnegative integer literals. Axis literals may be negative:
`-1` selects the last source axis and `-2` the second-to-last. A negative axis
is normalized by adding the source rank before checking bounds, uniqueness,
and selecting input-cell axes. For a rank-2 matrix, `axis 1 -1` is a
duplicate and `axis -3` is out of bounds. Write a space after the minus for
subtraction after a modifier: `M reduce + axis 1 - 1`.

```rank
RowTotals = M reduce + axis 1
ColumnTotals = M reduce + axis 0
CombinedRow = M reduce add rank 1 axis 0
CombinedColumn = M reduce add rank 1 axis 1
BatchRows = T reduce add rank 1 axis 1
BatchColumns = T reduce add rank 1 axis 2
CombinedPlane = T reduce add rank 2 axis 1

fun Acc add Cell = Acc + Cell
```

For a matrix, `rank 1 axis 0` passes whole rows to the function, while
`rank 1 axis 1` passes whole columns. For shape `Batch Rows Columns`,
`rank 1 axis 1` folds rows independently in each batch and `rank 1 axis 2`
folds columns independently in each batch. `rank 2 axis 1` folds
`Batch × Columns` planes along the rows axis.
The result stacks each independent fold's result beneath the remaining frame;
those results must have matching shapes. The accumulator can have a different
type or rank from the input cells. A rank equal to the source rank leaves no
traversal axis and is rejected.

**`with Seed` is optional.** Without it, the first input cell initializes the
accumulator. With it, the seed is combined with the first cell. The seed
expression is evaluated once and reused independently for each fold. An empty
fold returns the seed unchanged. Without a seed, symbolic `+`, `*`, `and`,
`or` and `xor` use identities `0`, `1`, `true`, `false` and `false`, respectively,
filled to the input cell shape. Other empty folds require a seed. An empty
frame never invokes the callback; its result uses the seed shape when supplied,
otherwise the input cell shape.

The symbolic reducers are `+`, `-`, `*`, `**`, `/`, `//`, `mod`, `and`, `or`
and `xor`. Named binary operations and user functions accept the same modifiers.
Callbacks use their normal intrinsic rank rules, as in a direct call; those
rules do not choose the reduction input cell rank.
Positive input cell rank requires an array. Scalar inputs and finite sequences
support rank-0 reduction; an unbounded sequence cannot be reduced.

This replaces the earlier meaning of `reduce rank R`, which reduced atoms
inside each rank-R region. To sum each matrix row, use `reduce + axis 1`.
To reduce each trailing two-dimensional block, use `reduce + axis -2 -1`,
regardless of the number of leading frame axes.
`scan` uses the same input-cell rank and traversal-axis contract, returning all
states. For a matrix, `M sum rank 1` sums each row, while `M reduce + rank 1 axis 0`
passes rows to `+` and combines them. Use `M reduce + axis -1` for row sums.

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

`all` is equivalent to `reduce and with true`; `any` is equivalent to
`reduce or with false`.
`count` returns the integer number of `true` values. All three operations
require boolean cells. `all` and `any` short-circuit as soon as the result is
known, while `count` examines the complete cell. An empty collection produces
`true` for `all`, `false` for `any` and zero for `count`. All three support
`rank` and `axis`. A known unbounded sequence is rejected.

A lazy sequence mask is also accepted by `count`. It counts its `true` values,
just as it does for a boolean array.

A finite lazy source may define a direct cardinality count. The numbers module
uses this hook for `N divisors count`; other numeric sequences still fail the
boolean-cell requirement.

`indices` returns the zero-based positions of `true` values in a rank-1 boolean
array. The result is an integer vector, and an empty or all-false mask produces
an empty vector:

```rank
Places = (array true false true false) indices
rem 0 2
```

For a boolean tensor of rank `k >= 2`, `indices` returns an integer matrix of
shape `N × k`: one coordinate row per true cell, in zero-based row-major order.
No matches produce `0 × k`; one match produces `1 × k`. Rank-1 masks continue
to return vectors, including an empty vector when there are no matches.

```rank
Mask = array shape 2 3
  false true false
  true false true
end
Where = Mask indices
rem Rows: 0 1; 1 0; 1 2
Rows = Where # 0
Columns = Where # 1
```

Scalars and non-boolean cells are rejected; empty arrays have no cells to
validate and are accepted. The operation reads every cell once in logical
row-major order, including computed cells, and stores `N * k` coordinate
integers for tensors. Coordinate matrices are not directly usable as array
selectors: extract their columns as above; integer-array selectors require
rank 1.

`Values find Target` returns the zero-based position of the first equal array
element or matching text substring. It raises `.Missing` when no value matches, so `default` supplies
a fallback. `Values findall Target` returns every matching position and returns
an empty vector when there are none. Both accept rank-1 arrays and text, whose
positions count Unicode code points. For text and a text target, they search
for a substring; `findall` includes overlapping matches. An empty target has
no matches. Matching is case-sensitive and does not normalize Unicode.
Array sources still compare whole elements. Arrays of targets keep their frame;
`findall` requires the same number of matches for each target.

`min` and `max` with one argument reduce one finite collection. With two
arguments they choose between numeric values and broadcast over arrays.
Both take their second operand after the function name:

```rank
Largest = A max
Bound = Low max High
Clamped = Values max 0
Best = Best min Now .spent
```

`A 0 max` reduces the selected element or row, and `M # 0 max` reduces the
selected column. The optional right operand may also be addressed:
`A max B 0` means `A max (B 0)`. A following known function starts the next
pipeline step, so `A max B sum` means `(A max B) sum`. Group a completed
call before supplying another independent operand: `(Low max High) Limit min`.
Use parentheses around arithmetic operands, as in `0 max (Limit - Used)`.
`axis` and `rank` modify the reduction; the binary form broadcasts elementwise.

A named builtin (`op = max`) uses the same operand sides and lazy binary
broadcasting. Core names cannot be redefined. `max` can still be passed as a
combining function in `Values scan max`, `Values reduce max`, or `A B outer max`.
Equal numeric operands preserve the left operand, including its integer/real
representation.

## Scan

Prefix accumulation:

```rank
Prefix = A scan + with 0
```

`scan with Seed` returns the seed followed by every left-to-right accumulated
value. Its result therefore has one more item than the source; an empty source
returns an array containing only the seed. This form makes prefix tables start
at index zero without a separate allocation or mutation. Without `with`, the
first result remains the first source value and an empty source returns an empty
array for compatibility.

`scan` accepts a rank-1 array, queue, text or sequence. An array, queue or text
produces a material rank-1 array. A sequence produces another lazy sequence, so
an unbounded source is valid when a later operation requests only a finite
prefix or a particular position. Without modifiers, higher-rank arrays are
rejected. Tensor scans accept `rank R axis N`, in either order, before `with`:

```rank
Columns = M scan + axis 0 with 0
Rows = M scan add axis 1 with 0
RowStates = M scan add rank 1 axis 0
```

`axis N` selects the source axis to traverse. Remove it first, then `rank R`
selects the trailing `R` remaining axes as the input cell, just as in `reduce`.
The earlier remaining axes form independent scans. The default is rank 0
(individual elements). The input cell rank plus one must not exceed the source
rank. An explicit `rank` always requires an explicit `axis`, including `rank 0`.
Thus `M scan add rank 1 axis 0` combines whole rows along axis 0.
For shape `Batch Rows Columns`, use
`rank 1 axis 1` to scan rows independently in each batch. A rank equal to the
source rank leaves no traversal axis and is rejected. For lazy sequences and
text, omit `rank` for scalar folds; explicit axes require an array.

Without a seed, the first input cell initializes each scan and the traversal
length stays unchanged. With a seed, the traversal axis grows from `D` to `D + 1`,
with the seed prepended to each scan. The seed expression is evaluated once. All states,
including the seed, must have matching shapes; a mismatch raises
`.DimensionMismatch`. The accumulator may have a different shape from the
input cell. The output keeps the frame and traversal axes in their original
source order, with the accumulator shape appended. For a matrix of shape
`Rows Columns`, `scan add rank 1 axis 1` scans columns and produces shape
`Columns Rows`; a seed grows this to `(Columns + 1) Rows`. For example, a
scalar accumulator over rows of a matrix produces a vector of states.

An empty traversal has length 1 with a seed and remains empty without one.
Empty frames stay empty. The result uses the seed shape when supplied,
otherwise the input-cell shape. Only one axis may be scanned. Symbols, named
builtins and user functions accept the same modifiers and use normal function
application on the selected cells.

This replaces the earlier `scan rank R` axis shorthand. Use `scan axis -1`
for scalar prefixes within rows and `scan axis 0` for scalar column prefixes.

A binary user function can also accumulate states:

```rank
States = Steps scan next with Start
Prefixes = Steps scan next
```

`next State Step` receives the previous state and the next source item. The
seed is the first result. Without a seed, `Steps scan next` starts from the
first source item. The function is resolved once when the scan is created;
sequence sources remain lazy.

## Short-circuiting selection

`first where` and `first index where` take a condition, as `filter` does, or
an aligned boolean mask:

```rank
Match = Values first where greater 10
Position = Values first index where Mask

```

`first where` returns the first value that meets the condition. `first index
where` returns its zero-based position. Both stop reading at the first match,
so they work on an unbounded source. If nothing matches, they raise `.Missing`,
so `default` can provide a fallback. Known unequal source and mask lengths are
errors.

The leading run that meets a condition is `till not Condition`; see
[Bounds](#bounds).

## Outer

`outer` is a higher-order modifier. It applies the operator or named binary
function immediately after it to every pair of cells:

```rank
Sums = A B outer +
Products = A B outer *
Remainders = A B outer mod
Grid = Values Values outer bxor
operation = min
Smallest = A B outer operation
```

Cell ranks belong to the operation; `outer` combines the remaining frames.
Symbolic binary operations have intrinsic ranks `0 0`. The named functions
`band`, `bor`, `bxor`, `shl`, `shr`, `min`, `max`, `atan2`, `binomial`, `gcd`,
`lcm`, `bit` and `round` also declare ranks `0 0`. User-defined
binary functions currently default to `all all`; syntax for declaring their
intrinsic ranks remains deferred.

The result shape is the concatenation of the left and right frame shapes.
Therefore, if `A` has shape `2 3` and `B` has shape `4 5`, the result of atom
pairing `A B outer *` has shape:

```text
2 3 4 5
```

`outer` combines axes. `matmul` contracts axes.

Broadcast arithmetic and axis permutations preserve the logical producer cells
of a native result. Completing an empty view still observes those selected
producers; selecting one frame does not evaluate unrelated frames. A transpose
can move frame axes among empty cell axes without erasing these observations.

The left frame axes come first and the right frame varies fastest. The operation
must accept two arguments and currently must return a scalar for every pair.
Both operands must be finite.

A range operand is addressed by arithmetic (`Start + Index * Step`), and so is arithmetic over ranges
(`Range * 2 + 1`, `Range - Range`), so building the table reads nothing from them, however long they are. Any other operand of known size is read only as far as a demanded
cell reaches and the values read are kept; an operand of unknown size is read whole when the table is
built. A table whose cell count is not exactly representable (beyond 2^53 - 1) raises
`outer result is too large`.

A lazy array of a million cells or more is reduced one cell at a time by `sum` (also through `rank`), `min`, `max`,
`mean`, `count`, `any` and `all`, so `A A outer * sum rank 2` holds no cells however large the table is; it still has to
compute each of them. An operation that must hold the whole array, such as `copy`, raises
`array is too large to hold in memory` past 4294967295 cells.

Ordinary binding completes the result; use `Pairs' = A B outer operation` to
keep a recipe. Each observation recomputes the demanded pairs, including
callback effects. An ordinary `Saved = Pairs` binding retains the completed
result. A deferred assignment does not make a single-pass operand restartable;
bind its completed data before reusing it.

Explicit binary comparison rank and cell axes are supported as described
in the Rank section. General binary function rank overrides remain deferred.

A future axis-qualified cell view could select cells independently for each
operand of `outer`, allowing rows of one tensor to be paired with columns of
another without an explicit transpose. The
expression syntax is deferred because `axis` already introduces selection;
`outer` itself does not permute axes.

Applying a same-shaped boolean mask to a tensor returns a rank-1 lazy sequence
of the selected atoms in iteration order. Tables retain their separate
row-selection rule.

---

# Collections

`use algo` provides standard algorithmic collections. Use `new` for empty
named structures and `Size groups` for bounded integer groups. There are no
implicit per-function instances.

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

`new Kind Items` fills the new structure from the items of one collection:
a queue, stack, deque or heap is pushed in order (a heap uses each item as its
own priority), and a set, counter or multiset is added to:

```rank
Pending = new queue (1 to 5)
Seen = new set "hello"
Counts = new counter (array 1 1 2)
```

`new heap Priorities Values` builds a heap from two arrays with the same leading
length. `Priorities` must be a vector of comparable scalar values. Each leading
cell of `Values` becomes one payload, so a matrix supplies one row per entry.
The constructor builds the heap in linear time. The default order pops the
smallest priority; `.descending` pops the largest. The direction is fixed at
construction and also applies to later insertions. Equal priorities retain
input order:

```rank
Priorities = array 2 9 1
Payloads = array "a" "b" "c"
Work = new heap Priorities Payloads .descending
Work pop                     rem "b"
```

`new heap Items .descending` uses each item as its own priority, and
`new heap .descending` creates an empty max-heap.

An index addressed by an array or a finite sequence of keys gathers: it
answers one value per key, in the shape of the keys. A missing key raises,
or takes the `default` when one follows:

```rank
Labels = Part Nodes default 0
```

Assignment and argument passing preserve the structure's reference.
`Alias = Seen` shares `Seen`. The assignment does not create a copy. Named structures can be captured by local
functions and returned from functions.

Named sets and counters accept `Name add Value`. A set keeps one equal
element; a counter increments that element's frequency. The whole expression
after `add` is evaluated once. The same form can be used in an expression;
`add` returns the receiver. Named
queues accept `Name push Value`; named indices use addressed assignment.

The first insertion into a set, counter, queue, stack, deque or heap fixes the
outer type of its elements for that instance. Later insertions must match even
after the collection becomes empty. An array element also fixes the number of
axes, but its cells are not type-checked by this contract. Heap priorities
retain their separate comparable-type rule.
Sets and counters still hash array contents for equality, so inserting a lazy
array into either may evaluate its cells independently of the type check.

A function that needs a structure creates its own with `new`; separate and
recursive calls each get a fresh one. To share a structure with another
function, pass or capture its name. The bare words `index`, `queue`, `set` and
`counter` no longer name an instance and are an error that suggests `new`.

`push` appends one value to a queue, stack, deque or heap, even an array.
`push unpack Items` appends each item of a rank-1 array or tuple instead.

## Index

An index is a sparse keyed structure, created with `new index`.

```rank
use algo
Cache = new index
Cache Value = Position
```

Read:

```rank
j = Cache Need
```

Membership:

```rank
if Need in Cache
  ...
end
```

Default:

```rank
Last = Cache C default -1
```

Multi-dimensional keyed addressing:

```rank
Cache A B C = Value
X = Cache A B C
```

The complete tuple is the key, so an index can represent a sparse matrix or
higher-dimensional tensor. It does not infer rectangular dimensions or carry a
dense shape; programs keep those dimensions separately when needed. The key
and value types are inferred from uses within the function.

An index is a reference structure. Passing it to a function preserves that
reference, so every name sees the write:

```rank
use algo
Cache = new index

fun Cache K V store
  Cache K = V
  return 0
end

X = Cache 7 99 store
Cache 7 rem 99
```

An index supports reads, membership, padded reads and writes with complete
tuple keys. Compound writes such as `Cache K += 1` require an existing
entry. Keys may be integers, real numbers, booleans, text or labels. An index
can also be captured by a local function.

Index values may have different types, and replacing an entry may change its
type. The collection element contract below does not apply to an index.

### Bounded integer groups

`Size groups` creates an append-only collection of integer groups under keys
`0` through `Size - 1`. It requires `use algo`. Empty keys allocate no individual
containers. For example:

```rank
use algo
Groups = 10000001 groups
Groups 5 3 insert
Groups 5 4 insert
Saved = Groups 5
Groups 5 3 insert

for Value in Saved
  rem Visits 3, 4; later insertions are outside this snapshot.
end
Values = Groups 5 array       rem 3 4 3
Empty = Groups 6 array        rem Empty integer vector.
```

`Groups Key Value insert` appends one integer and returns `Groups`. Repeated
values are retained in insertion order. Keys and values must be integers;
real numbers are rejected. Values retain arbitrary integer precision. `Size`
must be between zero and 4294967295. An out-of-bounds key raises `.Missing`,
which `default` can handle.

`Groups Key` returns a finite sequence snapshot. Reading a group does not copy
its values: the snapshot shares storage and fixes its last inserted element.
Later insertions do not change its contents, including during iteration.
Use postfix `array` to make an independent array. Assignment and function
arguments share the groups collection's reference; snapshots remain read-only.
The runtime type of the collection is `.groups`.

### Mutable collection element types

Each `set`, `counter`, `queue`, `stack`, `deque` and `heap` has an element
contract. The first successful insertion fixes the runtime type of its values
(`counter` keys and `heap` payloads). Integer and real are distinct types.
Aliases and function arguments share the same contract, which remains after
the collection becomes empty. An incompatible insertion raises an error
before storing the new value. No constructor type annotation is required.

An array element also fixes its number of axes and its cell types. Axis lengths
may vary. For example, after inserting `array 1 2`, inserting `array 3 4 5`
succeeds, while a text array, a real array or a rank-2 array fails. If the first
array contains several cell types, later arrays may use those types but cannot
introduce another one. The same rule applies recursively to nested arrays.
Empty arrays fix their rank but defer their cell contract until cells are
inserted. Record fields and the contents of nested mutable collections do not
form part of this contract.

Insertion reads array cells, including lazy cells, to validate their types.
This adds work proportional to the number of cells inspected. A failed read
does not establish or widen the contract; side effects performed by the read
itself still take place. Static analysis reports proven incompatibilities and
retains element facts through safe reads and direct aliases. Unknown calls or
aliasing discard facts that cannot be proved; runtime checks still apply.

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
Ends pushback 2
Ends pushfront 1
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
Binary functions use postfix syntax, such as `Ends pushfront Value`.

A heap is a stable priority queue, smallest first unless created with
`.descending`. `Heap push Value` uses the value itself
as its priority. `Heap Priority Value enqueue` accepts a separate payload
subject to the heap's element contract. Priorities must be comparable scalars of one ordering family;
integer and real priorities can mix. NaN priorities are rejected. Equal
priorities preserve insertion order. `pop` and `peek` return payloads, not
priorities.

Empty `pop` and `peek` operations raise a missing-value error, so
`Pending pop default -1` supplies a fallback. `len` counts remaining entries.
Queue, stack and deque indices start at zero at the current front/bottom.
They retain queue-style array operations. Heap iteration visits payloads in
internal heap order, not sorted order; repeatedly call `pop` to get priority order.
Queue iteration can observe entries appended during the loop. Do not remove
entries while iterating a container; use a conditional `for` with `pop` instead.

Apart from element validation, end operations use constant expected time with numeric-keyed storage; heap
insertion and extraction use O(log n) comparisons and `peek` takes O(1).
Materializing a queue-family container as an array takes O(n). Named containers
are shared references when assigned, captured or passed to functions. Their
runtime types are `.queue`, `.stack`, `.deque` and `.heap`.

### Queue methods

```rank
Pending = new queue
Pending push X
return Pending
```

A queue is ordered, zero-based, iterable and addressable after it is returned.
For elementwise operations, a queue behaves as a rank-1 array. This lets a
function return a queue and a test compare it directly with an array literal.

`push` takes one argument, so the rest of its line is one complete expression:

```rank
Pending push A i + Carry
```

Structure methods place the receiver first and the method second. A method with
no arguments ends after its name; a method with one argument consumes the rest
of the line. The block syntax for methods with two or more arguments is not yet
settled. The earlier `with ... end` proposal is disputed and is not current
syntax.

Addressed mutation uses assignment rather than a `put` method:

```rank
Cache Row Column = Value
A Row Column = Value
```

An index writes a sparse tuple key. An array write requires one in-bounds
index per dense axis and changes the array this name holds; a second name that
was given the same array keeps what it was given. An index is a reference
structure, so every name for it sees the write. See
[values and sharing](values-addressing.md#values-and-sharing).

### Set

```rank
Seen = new set
Seen add X
Seen remove X
if X in Seen
  ...
end
Count = Seen len
```

`add` is idempotent: adding an equal value again leaves the set
unchanged. `remove` deletes that value and raises `.Missing` when it is absent.
Scalars, arrays and records can be elements. Array equality includes
both shape and contents; record equality includes field names and recursively
equal values. `in` tests membership, and `len` returns the number of unique
elements.

Separate and recursive function calls each create their own set.
A set is iterable in insertion order. Adding an existing value does not move
it. An array is useful for a composite value such as a coordinate:

```rank
Seen add array X Y
```

A numeric set is a finite collection for `sum`, `min` and `max`:

```rank
Total = Seen sum
Smallest = Seen min
Largest = Seen max
```

Each distinct value contributes once. An empty set sums to zero; `min` and
`max` reject it as an empty reduction.

### Sorted integer insertion indices

With `use algo`, `Values lowerindex Target` returns the first index whose value
is at least `Target`; `Values upperindex Target` returns the first index whose
value is greater than `Target`. Both return `Values len` if no value qualifies,
and zero for an empty vector. Indices are zero-based; duplicate values are
supported, and integer comparisons retain arbitrary precision.

The input must be an ascending rank-1 integer array, and the target must be an
integer. Sortedness is a caller precondition and is not checked. Each query
reads and checks only O(log n) cells; it does not materialize the vector or
linearly rescan it. Scalar targets return an integer; array targets follow the
default ranks `all 0`. For an inclusive interval `[Low, High]`, its count is
`(Values upperindex High) - (Values lowerindex Low)`.

### Ordered multiset

`new orderedset` creates the unique-value variant of a multiset: repeated
`add` calls for an existing value have no effect. It shares multiset operations
and the `.multiset` runtime type.

`Bag lowerbound X` (also `Bag X lowerbound`) returns the smallest value >= X;
it is an alias for `ceiling`. `Bag upperbound X` returns the smallest value > X.
These return values, not iterator positions. If no value qualifies, they raise
a missing-value error that can be handled with `default`. Both use the multiset's
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
program may define and call `fun A ceiling B` as `3 ceiling 4`.

`remove` deletes one equal occurrence. Removing an absent value raises
`.Missing`. `floor` returns the greatest value at most its argument;
`ceiling` returns the least value at least its argument. When no such value
exists they also raise `.Missing`, so ordinary `default` supplies a fallback:

```rank
Best = Tickets floor Limit default -1
```

The query has intrinsic rank 0: an array of queries gives one answer per
element, in the shape of the queries. A missing answer raises `.Missing` when
that cell is read; `default` replaces only the missing cells.

```rank
Limits = array 3 7 12
Bests = Tickets floor Limits default -1
```

`Bag I` addresses the occurrence at zero-based position `I` in sorted order.
Equal values occupy separate positions. A negative or out-of-bounds position
raises `.Missing`, so it also composes with `default`.

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
`default`. Cell access is constant time; assignment and prefix sums take
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
Tree = Values segment min
Sums = Values segment +
Tree = Values segment Operation
```

`segment` is a higher-order operation, like `scan` and `reduce`. The named form
resolves `Operation` once when the tree is built. It therefore honors a
user-defined `min` or any other binary function. Rank does not try to prove
that the operation is associative.

User-defined record states can supply an explicit neutral element:

```rank
Tree = Values segment combine with Identity
```

Each input element is already a state. `combine Left Right` must return a
state, be associative, and leave both operands unchanged. `Identity` must
satisfy `fun Identity combine X = X` and `fun X combine Identity = X`; these laws are
part of the caller's contract and are not checked at runtime. The function
and identity are evaluated once during construction.

Ranges remain inclusive. With an explicit identity, `Tree I (I - 1) query`
returns the identity for `0 <= I <= Tree len`. An empty tree therefore accepts
`Tree 0 (-1) query`. Other reversed ranges and out-of-bounds positions are
errors. Without an explicit identity, the existing range rules apply.

A [flat record array](language/sequences-arrays.md#flat-record-arrays) makes the tree
store its nodes in a compact buffer with the same schema. Reads return record
copies. Replace a whole leaf with `Tree Position = State` to recompute its
ancestors. A schema mismatch or overflow during an update leaves the stored
tree unchanged. Flat identities are copied on construction and on empty reads.
Ordinary record trees retain the existing reference semantics. Eligible pure
integer `combine` functions use a scalar kernel without intermediate records.
Query intermediates keep arbitrary-precision integer semantics; only stored
nodes are checked against the signed 64-bit limit.

Only point updates are supported for user-defined operations. Lazy range
updates need an additional action algebra and are not inferred from `combine`.

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
numeric `segment +` tree:

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
Out-of-bounds positions raise `.Missing` and compose with `default`. No identity
value is required because an empty range is not a valid query. Empty trees may
be constructed but cannot be queried or addressed.

`firstatleast` finds the first position where the aggregate of the prefix
reaches a numeric target:

```rank
Position = Tree firstatleast Target
```

It returns `-1` when no prefix reaches the target. An array of targets gives one
position per target. Prefix aggregates must be
monotone relative to the target. Typical valid trees use `max`, or `+` with
nonnegative values. Rank does not attempt to prove this condition.

`maxsum` is the native numeric profile for prefix and subarray sums:

```rank
Tree = Values segment maxsum
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
One = Data missing (array Left Right)
Answers = Data missing Queries
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
for Pair in Values combinations 2
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
for Pair in Values multicomb 2
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
Counts = new counter
Counts add X
Count = Counts X
Kinds = Counts len
```

`add` increments the frequency by one. Addressing an absent key returns zero,
and `len` returns the number of distinct keys. Scalar and array keys use the
same equality as `set` elements. Separate and recursive calls receive separate
counters. `counter` is a first-class value with runtime type `.counter`.

An array query gathers integer frequencies in the query's shape; a finite
sequence query produces a rank-1 array. Text, scalar, tuple and record queries
address one key. Use tuple/record keys for single composite-key reads, changing
both insertion and lookup when migrating array keys.

Counter iteration yields distinct keys in insertion order. Direct frequency
assignment is not defined. See the
[counter contract](language/collections.md#counter) for the complete rules.

## Design rule

These are general data structures, not puzzle-specific shortcuts. Candidate
additions are tracked in the
[competitive-programming library roadmap](design/competitive-programming-library.md).

---

# Graphs

`use graph` provides mutable explicit graphs, finite predicate graphs and directed successor graphs.
Its public behavior does not expose adjacency-list, CSR or other physical storage.

`new graph Domain with Predicate .directed` (or `.undirected`) snapshots a finite
scalar domain and evaluates its binary Boolean predicate on demand. `Graph U V
adjacent` tests one pair; membership in `Graph U` tests only the requested candidate.
Predicate graphs support BFS, DFS and unit-weight Dijkstra, and reject mutation and
other graph algorithms. `Neighbors = Graph U` materializes neighbor values;
`Neighbors' = Graph U` preserves the query plan. For callback lifetime, symmetry, iteration and complexity
contracts, see [predicate graphs](language/graphs.md#predicate-graphs).

`new graph with Successor .directed` creates an open, unweighted state space.
Use `Graph Start Goal bfs Limit` with a scalar goal and nonnegative successor-entry
budget. The result adds `.status` (`.reached`, `.exhausted`, `.limit`), `.path` and
`.examined`; distance and parent indexes can be partial. Unbounded traversals and
`len` reject successor graphs. See [bounded successor search](language/graphs.md#bounded-successor-search)
for exact budget boundaries, callback and termination contracts.


## Construction

A closed graph receives its complete finite vertex domain. This includes
isolated vertices and makes an unknown endpoint an error:

```rank
use graph

Nodes' = 1 to NodeCount
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

Address an explicit graph with one vertex to obtain a finite lazy sequence of its
neighbors:

```rank
Queue = new queue
for Next in Graph Current
  Queue push Next
end
```

The sequence is a snapshot of that vertex's neighbors when `Graph Current` is
evaluated. Later graph mutations do not change an existing sequence. Neighbor
order follows edge insertion order.

The contextual `edges` method returns the same outgoing entries as lazy
tuples `tuple Next Cost`. `unpack` gives readable access without changing
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
Root = Union findroot A
Same = Union connected A B
Count = Union components
```

`merge` uses union by size and returns true only when it combines two previous
components. `findroot` returns the representative value selected by the structure;
`connected` compares representatives. `components` returns the current number
of components, while `len` returns the number of registered values.

`new dsu` without a collection creates an open DSU. `findroot`, `merge`, and
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
Weighted = Next weighted Cost
State = Weighted Start Limit upto
```

`jump` follows exactly the requested nonnegative number of transitions and
accepts arbitrarily large integers. Its cached binary-lifting table grows only
to the largest requested bit. `distance` returns the minimum number of forward
transitions from `From` to `To`; an unreachable target is missing and composes
with `default`:

```rank
Steps = Planets distance From To default -1
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

`Next weighted Cost` prepares the same increasing successor path with one
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

`Tree root Root` prepares an immutable rooted view of a connected undirected
tree. The source graph may use any supported scalar vertices. Preparation
validates that the graph is a tree, takes `O(N log N)` time and snapshots its
current edges:

```rank
Rooted = Tree root 1
Boss = Rooted Employee K ancestor
Common = Rooted A B lca
Length = Rooted A B distance
```

The query words use the same data-first postfix form as
`Tree Left Right query`. `ancestor` returns the vertex `K` parent edges above
the requested vertex. An ancestor above the root is missing and composes with
`default`. `lca` returns the lowest common ancestor, and `distance` returns the
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
Lengths' = Tree pathlengths
Exact = (Lengths equal K) count
Mask' = (Lengths at least Low) and (Lengths at most High)
Within = Mask count
```

The deferred binding captures `Tree` read-only. Ordinary binding instead stores
all pair distances.

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

`Graph bfs Start` traverses outgoing unweighted edges in breadth-first order;
`Graph dfs Start` uses depth-first order without consuming the host call stack.
`Graph dijkstra Start` computes shortest distances for nonnegative numeric
weights and rejects a negative edge. All three return a record with three fields:

- `.distance`: an index from every reached vertex to its distance;
- `.parent`: an index containing the search-tree parent of each reached vertex
  except the start;
- `.order`: vertices in discovery order for BFS and settlement order for
  Dijkstra.

```rank
Result = Graph dijkstra Start
Distance = Result .distance
Answer = Distance Target default infinity
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
parents remain missing values, so existing `default` handling applies.

`Graph cycle` returns one cycle from either a directed or undirected graph as a
rank-1 array. The first vertex is repeated at the end, so each adjacent pair is
an edge in traversal order. An acyclic graph returns an empty array. Search is
iterative; self-loops and cycles formed by parallel undirected edges are
preserved.

`Graph euler Start` returns an Euler trail that begins at `Start` and uses every
edge exactly once. It works for directed and undirected graphs, infers the end
vertex from the degree balances, and returns an empty rank-1 array when no such
trail exists. A graph without edges returns `array Start`. Parallel edges and
self-loops remain distinct, edge weights do not affect the trail, and equal
inputs produce insertion-order-stable results. The iterative search takes
`O(V + E)` time and does not mutate the graph.

`Graph bellmanford Start` accepts negative weights. Its `.distance` and
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
  flows aggregated and absent pairs readable through `default 0`;
- `.cut`, the set of vertices reachable from `Source` in the final residual
  graph, which is the source side of a minimum cut.

---

# Tables

Tables reuse Rank's normal addressing model.

Ordinary bindings complete tables and columns, including plans in nested cells.
Completion preserves columnar storage, column order and absent cells, sharing
ready columns. `Ages' = Data .Age` retains a projection plan instead. Table writes
produce new versions; nested records and containers retain shared identities
and cannot be mutated through any alias after capture.

## SQLite

With `use tables`, an existing SQLite database can be opened read-only:

```rank
Db = "demos/pgexercises/data/club.sqlite3" sqlite
Facilities' = Db .facilities
Query = Facilities sql
Rows = Facilities array
```

To inspect the SQL and plan in a program, add `use io` and print
`Query .text` or `(Facilities explain) .detail`.

`Db .facilities` validates the table name and returns a SQLite-backed table
view without loading rows. `Facilities' = Db .facilities` retains the query;
`Rows = Facilities` executes it and stores a ready row array. Ordinary column
bindings and nested record/container values also materialize. Repeated demand
of an explicit query plan reads the current database state without retaining
previous rows. The database handle remains a resource.
`Query` is a record with `.text` (parameterized SQL) and `.params` (an ordered
array of bound values). `Facilities explain` runs `EXPLAIN QUERY PLAN` and
returns an ordinary Rank table of plan rows. Postfix `array` executes the query
and returns a rank-1 array of object rows; after that, normal Rank table
operations apply. SQLite `NULL` becomes an absent object field, integer 0/1
stays integer, and row order is unspecified unless the SQL query orders it.

SQLite table views support lazy field projection, comparisons and boolean
masks, `innerjoin by/on`, `leftjoin by/on`, `select`, `reach by`, `unique` and field-keyed `sort by`.
`Mask choose TrueValues FalseValues` selects only the demanded branch of each
array cell, broadcasting array operands by trailing axes. A missing mask cell
gives a missing result cell. SQLite expressions from the same view compile to
parameterized `CASE WHEN ... THEN ... WHEN NOT ... THEN ... END`; a SQL `NULL`
condition leaves the result `NULL`. A nonboolean mask or mismatched array
shapes are errors.
`Index choose Choices` selects among more than two branches: each integer index
cell names a leading-axis cell of `Choices`, with trailing-axis broadcasting
and only the chosen value read. An index outside the choices raises `.Missing`.
`M' = Db .members alias .m` gives a table view a join role without reading or
renaming columns. Two aliased operands must have distinct names and both be
rank-1 array tables or SQLite views. Their join keeps each row's fields under
the corresponding nested label, for example `J .m .firstname` and
`J .r .firstname`; an unmatched right scope is absent and can be filled with
`default` after materialization. The join SQL remains lazy until a terminal read.
Aliasing an already scoped SQLite join is currently an error.
An ordinary alias binding materializes its source and preserves the role name.
`RightRows = J .r` materializes a join scope, with missing cells for unmatched
right rows; an apostrophe keeps that scope query deferred.
`Out' = View select ... end` builds an ordered, named projection without
reading rows. SQLite expressions must belong to `View`; constants become bound
parameters. Ordinary record fields complete SQL columns, so use the contextual
`select` block to retain their expressions. The projection returns a flat query
view without changing its source. An array source produces lazy rank-1 object rows from scalar fields or
same-length rank-1 columns. Missing array cells and SQLite `NULL` omit the
corresponding output field. Boolean SQL expressions materialize as Rank
booleans. A final `sort by` after `select` orders the exported rows.
`Ids Keys Values lookup` returns the first source value whose key equals each
requested ID. Array source keys and values are aligned rank-1 arrays or finite
sequences; array
requests produce a lazy rank-1 result, while a scalar request returns one
value. Missing or unmatched IDs produce missing cells, and array source order
decides repeated keys. With SQLite expressions, the key and value come from
one view of the same database as the request. It compiles a correlated scalar
subquery with bound parameters; no match or SQL `NULL` returns an absent field.
Without an explicit source order, repeated SQLite keys have no stable first
match. The view is read only and the lookup does not execute until demanded.
`Edges Starts reach by .source .target` traverses directed edges from one scalar
start or a rank-1 array/column of starts. Its two-column result pairs each
start with every distinct reachable endpoint other than itself. Missing
endpoints, duplicate edges and cycles do not add rows indefinitely. Array
sources return a table; SQLite sources compile to a lazy `WITH RECURSIVE`
query with bound scalar starts. A SQLite start column must come from the same
database. The source is unchanged, and output order requires `sort by`.
`len` runs `COUNT(*)`, and `sum` of a lazy column or arithmetic column
expression runs SQL `SUM`. `group by` on a SQLite view is lazy; grouped
`select` returns a view with key columns and named aggregates. A following `filter` narrows the
totals, and `sort by` defines their output order. `View (0 till N)` adds
SQL `LIMIT` after checking bounds with `len`. Field names are schema-checked and quoted; values
are bound parameters. Joining requires views of the same database. Numeric
join keys compare by numeric value, while text and numeric keys do not match.
`Db Start calendar End` produces an inclusive daily SQLite view, while
`Start calendar End` produces an array table. `N rolling by .field` orders
rows and applies named `select` reductions over the current row and up to
`N-1` predecessors; on SQLite this compiles to an ordered `ROWS` window.
`sql` exposes the current query and ordered parameters; `explain` inspects its
SQLite plan. Ordinary binding, `array`, `print` or CSV output materializes a view. SQLite-backed views are
read-only; derived-column assignment and operations beyond this set require
materialization. An expression used as a mask must belong to that exact view.

For a query that cannot yet be expressed through Rank's table operations, use
an explicit read-only SQL source with positional bound parameters:

```rank
Text = "SELECT * FROM facilities WHERE facid = ?"
Params = array FacilityId
Result' = Db Text Params sqlquery
Rows = Result array
```

`sqlquery` requires exactly one `SELECT` or read-only `WITH` query and a rank-1
parameter array, including an empty array when there are no placeholders.
Values are bound by the SQLite driver, never interpolated into SQL text. Wrong
parameter counts, duplicate result column names and unsupported parameter
types are errors. Table names are selected with labels, checked against the
schema and quoted as identifiers. A materialized view is separate; changing
its materialized array never writes to the database. `sqlquery` remains the
escape hatch for queries not yet expressible through Rank's SQLite views.

### SQLite writes

`F insert Spa Squash` inserts named records into a base SQLite table.
`T update ... end` changes named columns in a base table or a `filter` of it;
the right sides use the old row's columns. `T delete` removes those rows.
These operations execute immediately and return an affected-row count.
Projections, joins and sorts are not write targets. Column names are checked
against the schema, and values are bound as parameters. Prefix the same write
with `sql` to get its `.text` and `.params`, or with `explain` to get SQLite
query-plan rows. These forms do not execute the write. A one-column SQLite
view on the right of `in` or `not in` stays a subquery; `max` on a SQLite
column executes in SQLite. See [Updates](../demos/pgexercises/updates/README.md).

## CSV

Current I/O form:

```rank
Data = "train.csv" csv
```

Add `check` after a read to validate the requirements inferred from later,
unconditional uses at that read:

```rank
Data = "train.csv" csv check
Total = Data .price sum
```

This requires the `price` header and numeric or missing column cells before
`Total` runs. A missing header or an incompatible cell raises `.InputContract`
at the read line, with the column path and cell index. Additional columns are
allowed. An empty table still needs every required header; cell type checks
are vacuous when there are no rows. Empty CSV cells remain absent fields and
may satisfy a use that accepts `missing`.

`check` also follows `Text json` and `Text xml`, including their `.flat` forms.
It validates required object fields, XML attributes, ranks, dimensions and
cell types against the parsed value. XML attribute values remain text; a
numeric use needs an explicit conversion. A field used only through `default`,
on a conditional path, or through an unresolved callback does not become an
unconditional requirement. Checked reads inside functions receive independent
requirements from each known call. The check occurs when the value is parsed,
not when a later use reaches it. Without `check`, reads keep their existing
runtime behavior; analysis still reports contradictions it can prove from
program text. After a successful check, analysis can use validated CSV column
and JSON/XML field facts until a possible mutation invalidates them. XML node
fields are fixed even without a check; XML attribute keys are input-defined.
If a later operation requires columns from separate checked CSV reads to have
equal lengths, the second read checks their row counts and reports a mismatch
there. Columns from one CSV share its row count. Source-imported reader
functions use the requirements of their known callers.
Defining a function named `check` makes it an ordinary call.

`csv` reads UTF-8 comma-separated data with a header row and returns a rank-1
array of object rows. Quoted fields may contain commas, line endings and escaped
double quotes. Every data row must have the same field count as the header;
empty and duplicate header names are errors.

Rank infers one fixed type for each column from its nonempty cells. A column is
integer when every value is an integer without ambiguous leading zeroes, real
when every value is numeric, and boolean when every value is exactly `true` or
`false`; otherwise it is text. Empty cells are absent fields and therefore
compose with `default` when the column is projected:

```rank
Age = Data .Age default Median
```

Writing mirrors assignment:

```rank
Out csv "submission.csv"
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
Out csv "submission.csv"
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

`default` is used instead of a table-specific `fill`:

```rank
Median = Data .Age median
Data .Age = Data .Age default Median
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

`filter` returns another table using a predicate over the input columns:

```rank
Adults = Data filter .Age greater 18

Selected = Data filter
  .Age greater 18
  .Score greater 0
end
```

The input is evaluated once. A leading field path in a condition reads that
input: `.Age` means `Data .Age`. Each condition line uses normal precedence;
the complete lines are combined with AND. An explicit OR stays within its
line. Parentheses allow an expression to span several lines. Empty filter
blocks and assignment in a condition are errors.

The array predicate must be a rank-1 boolean mask with one value per row.
Applying it fixes the matching row positions, as ordinary array masks do.
The result is a rank-1 array view whose rows remain lazy; it retains the table
header, including when no row matches. The input rows are not copied or
changed. SQLite extends its parameterized WHERE plan without reading rows.
A row whose condition has no value (`.NA`, from an absent cell) is not kept, as
in SQL. SQL `NULL` predicate behavior is unchanged.

The same clause filters a plain array or sequence, where the elided subject is
the value itself rather than a column; see
[Sequences and arrays](language/sequences-arrays.md).

Use `Data = Data filter ...` to keep the next step under the same variable
name. Other references to the input retain the preceding table. The earlier
wiki sketch with `filter` on a separate line after a completed assignment
has been replaced by the forms above.

## Select columns

A short list selects a rank-1 named table, including the one-column case:

```rank
Names = Data select .firstname .surname
One = Data select .surname
```

This is different from a multi-column address such as
`Data (array .Age .Fare)`, which produces a rank-2 numerical matrix.

A block names computed output columns and may use local calculations:

```rank
Out = Rows select
  Guest = .memid equal 0
  GCost = .slots * .guestcost
  MCost = .slots * .membercost
  .member = .firstname + " " + .surname
  .cost = Guest GCost MCost choose
end
Out = Out filter .cost greater 30
```

The input is evaluated once. Field paths at the start of operands read it;
`.m .firstname` reads a nested alias. Explicit receivers such as
`Other .firstname` keep ordinary addressing. Function arity establishes the
argument boundaries before implicit receivers are inserted. Literal labels
used as data can be bound outside the block and passed through a variable.

Uppercase local names see earlier calculations and outer variables, then
shadow them within the block. Their types stay fixed and the bindings do not
escape. Output field definitions all read the original input: defining
`.cost` does not change what `.cost` means later in the same block. Use a
local `Cost` to share its expression, or a following table step to read the
output column. Defining a field changes neither the input nor the database.

Expressions support arithmetic, comparisons, parentheses, arrays, field
access, and pure standard-library calls such as `choose` and `lookup`.
Arbitrary Rank function calls, I/O, random operations, mutation, and nested
query blocks are not supported inside contextual expressions. Function aliases
are checked against the resolved function, so renaming an effectful function
does not bypass the rule. SQLite aggregates inside these expressions are not
supported yet; they must not cause an implicit early query.

Fields may be scalars or rank-1 columns aligned with the input. SQLite column
expressions must come from that input view. Missing source cells stay absent;
scalar values broadcast. Empty output schemas, duplicate names and mismatched
column shapes are errors. Column order follows the source text. Array rows
are lazy and follow source revisions; SQLite builds a bound SELECT plan.

For dynamic columns in an array table, use an ordered record of completed columns:

```rank
Cols = record
  .name = Rows .firstname
end
Out = Rows select Cols
```

`Rows select Cols` uses the same projection implementation as the block form.
For SQLite, use the contextual block to retain SQL column expressions.
It replaces the former postfix `Rows Cols select` function call; `select` is
now table syntax. General `record`, `choose`, `lookup`, aliases and boolean
addressing retain their independent uses.

Named array tables also preserve their header through `unique` and field-keyed
sorts. `unique` compares the named cells, treats absent cells alike, and keeps
the first matching row. Field sorting accepts object rows as well as records.

## Grouping

```rank
G = Data group by .Sex .Pclass
Totals = G select
  .visits = count
  .survived = .Survived sum
  .rate = .Survived mean
end
```

`group by` takes one or more field labels separated by spaces and returns a
grouped view. A `select` block produces a flat table with the key fields and
named aggregate columns. `count` counts rows; `.field count` counts present
cells. `.field sum`, `min`, `max`, `mean`, `median`, and `std` reduce one field
within each group. A bare reduction of a grouped column is not table syntax.
Ordinary reductions outside this block retain their scalar or tensor meaning.

`G = Source group by .key` stores completed grouping inputs, including nested
values. The same rule applies to `rollup by` and `rolling by`. When `Source` is
a SQLite query, this reads its rows; a later `select` uses the retained data.
Use explicit plans to keep both stages in SQL:

```rank
G' = Source group by .key
Totals' = G select
  .total = .value sum
end
Rows = Totals
```

The ordinary `Rows` binding runs the aggregate query. Repeated demand of the
explicit stages recomputes; it does not reuse earlier grouping or sorting results.

Array groups appear in first-seen order. Missing key cells form one group per
key combination. Missing aggregate cells are skipped; `sum` yields zero and
`count` yields zero when no cells are present. Other reductions leave the
result cell missing. Keys must be scalar and cannot be NaN; repeated keys and
output names are errors.

With explicitly deferred SQLite grouping stages, `select` builds one `GROUP BY`
query for all requested columns. `count`, `sum`, `min`, `max`, and `mean`
translate to SQLite. `median` and `std` currently require array tables; SQLite reports an error rather than
reading rows early. Use `sql` and `explain` to inspect the generated query,
`filter` for conditions on totals, and `sort by` for a defined output order.
SQLite grouping does not promise first-seen order.

`rollup by` takes the same ordered key list and adds one subtotal for each key
prefix plus a grand total. For `.facid .month`, it groups by both fields, by
`.facid`, and by no fields. Keys omitted at a subtotal level are absent in the
result, including on an empty input: the grand total still has `count` and
`sum` equal to zero. A real missing source key and a subtotal remain separate
groups even when their visible keys are both absent. Explicit SQLite query
stages build grouped queries joined with `UNION ALL`; bound source
parameters are retained for every branch. `sort by` places absent key cells
last for both array tables and SQLite views, in ascending and descending order.

```rank
G' = Rows rollup by .facid .month
Totals' = G select
  .slots = .slots sum
end
Totals' = Totals sort by .facid .month
```

`N rolling by .field` yields one trailing group per ordered row. `N` is a
positive integer, and a grouped `select` retains the ordering field. Ordinary
bindings retain the ordered inputs and completed results; source writes do not
update them. Explicit SQLite query stages use
`ROWS BETWEEN N-1 PRECEDING AND CURRENT ROW` for `count`, `sum`, `min`, `max`
and `mean`; `median` and `std` are not yet available there. Missing values are
skipped, and an empty `sum` is zero. Equal keys preserve source order on arrays;
SQLite needs a unique key for stable ties. Filter after the rolling `select`
when preceding rows must contribute to the displayed window.

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
can be projected with `default`. A nonexistent key field raises `.Missing`.

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
Cabin = Train .Cabin default "U/0/U"
Parts = Cabin split "/"

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

`date` converts a datetime to its calendar day. On a SQLite datetime column,
`datetime date` generates SQL `date(...)`. `Start calendar End` builds an
ordinary rank-1 table of inclusive daily `.date` values; with a database as
the first operand it builds the corresponding lazy SQLite view. Bounds must be
valid ISO dates or Rank dates; reversed bounds give an empty table.

---

# Tensors

Rank's array model is intended to scale from ordinary vectors to dense tensors
used in numerical computing and ML.

An atom has shape `[]`. A tensor stores a flat sequence of atoms with a
rectangular shape `[D1, D2, ...]`. Lazy dimensions may have an exact, unknown
finite, or infinite size; asking for an unknown finite shape is a demand point.

An array variable keeps the number of axes of its first value. Axis lengths may
change, but assigning a different rank raises `DimensionMismatch` and leaves
the previous value in place. Use a new variable for a reshape that changes rank:

```rank
use sequences
A = array 1 2 3 4
A = array 5 6 7 8 9 10
M = A reshape 2 3
```

`A` stays a vector; `M` is a matrix. Assigning `M` back to `A` is an error.
Function parameters and local variables establish their rank per call.

## Core operations

The current implementation includes dense construction through `array shape`
and dynamic row-major `reshape`:

List values followed by `shape` to create a tensor on one line:

```rank
M = array 1 2 3 4 shape 2 2
Zeros = array shape 2 2 fill 0
```

Values use row-major order. Their count must equal the product of the dimensions.
The `shape` suffix needs no import. Use `(shape)` to store the function itself
as an array element.

Reshape an existing value with:

```rank
M = Values reshape Rows Columns
```

One dimension may be `#`, inferred from the total number of elements:

```rank
Col = Values reshape # 1
Row = Values reshape 1 #
Pairs = Values reshape # 2
Flat = Values reshape #
```

The other dimensions must have a positive product that divides the element
count exactly. An empty source can reshape to `# 1` (shape `0 1`), but `# 0`
is ambiguous and raises `DimensionMismatch`. Only one `#` is allowed, written
directly among the reshape dimensions; it is not a value to store in a shape
array. Negative dimensions, including `-1`, remain invalid.

For an array, `reshape` checks its shape and preserves flat row-major indices
without reading its cells. Stored scalar arrays share copy-on-write storage;
computed arrays remain views. Ordinary assignment, ordinary parameters, writes
and explicit `copy` complete the value. Plans compute again on separate
observations; cell errors occur when the affected cells are read.

Text, queues and finite sequences are read once to build indexable storage.
Transpose keeps its existing axis-permutation behavior.

Inside a function, private integer expressions using `outer +`, `outer -` or
`outer *` can fuse with reshape, a bit-mask filter and a following reduction.
The candidates are read in row-major order without storing the product or
mask. A following `copy` stores only selected values. This still visits every
candidate; it does not skip whole branches of the product. Sources with
observable reads or potentially failing arithmetic keep ordinary evaluation.


Dense storage may also be allocated with a fill value and updated in place:

```rank
M = array shape Rows Columns fill 0
M Row Column = Value
M # Column = Values
```

An ordinary binding completes a finite array expression and makes its result
writable. Arrays have value semantics: changing `Writable` does not change
`Source`, including when `Source` is already stored.

```rank
Writable = Source
```

`Writable = Source copy` is also valid with `use sequences`. Keep `copy` when
it helps express the intent to take a snapshot; it is not required for array
independence or writability.

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
Loss = Pred mse Target
RowLoss = Pred mae Target axis 1
```

An axis list is treated as a set, so its written order does not affect the
result. Every axis must exist and may appear only once. Empty `sum` and `count`
cells return zero; empty `all` and `any` cells return `true` and `false`; an
empty `mean`, `median`, `std`, `min` or `max` raises `.EmptyReduction`. `mean`,
`median` and `std` always return real values. `std` uses the population
denominator `N`.

`all` and `any` stop within each reduced cell as soon as its result is known.
Later elements of that cell are not read or checked. Each new demand of a
deferred axis reduction computes its cells again.

`rank` and `axis` answer different questions. `rank` chooses trailing cells and
applies the whole operation to every cell in the leading frame. `axis` names
the coordinate dimensions that the operation consumes.

The binary error metrics `mse` and `mae` first broadcast their two operands to
one shape. Without `axis` they average every squared or absolute difference.
With `axis` they average only the named axes and preserve the remaining frame:

```rank
Loss = Pred mse Target
PerSample = Pred mse Target axis 1
```

Their framed results are lazy. Empty reduced cells raise `.EmptyReduction`.
Standard binary functions may declare intrinsic ranks. Rank splits array
arguments into trailing cells, broadcasts their leading frames, and applies
the function to corresponding cells. An atomic or whole-value argument has an
empty frame and is reused for every cell of the other argument. `rank L R`
overrides both ranks explicitly.

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
Planes = T det axis 0 2
```

Integer-only cells produce exact `integer` results. A cell containing any
`real` value produces a `real`. A singular cell returns zero, and the
determinant of a `0` by `0` matrix is one. A non-square cell raises
`.DimensionMismatch`; a nonnumeric element raises `.TypeError`. An ordinary
binding completes batched results; `BatchDeterminants' = Batch det` keeps a
recipe that recomputes on demand.

## Linear solve

`solve` from `use linalg` solves the equation `A * X = B` directly:

```rank
X = A solve B
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
Planes = T inverse axis 0 2
```

The second expression applies to every trailing matrix cell. The third uses
axes 0 and 2 for each matrix, preserving axis 1 as its frame. The result
keeps the original axis positions. A
non-square cell raises `.DimensionMismatch`; a singular cell raises
`.SingularMatrix`. Ordinary binding completes every ranked matrix result;
`BatchInverse' = Batch inverse` keeps a recipe. Repeated demands recompute the
matrix results rather than retaining them implicitly.

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
earlier axes are independent batches. Its intrinsic monadic rank is 2; a cell
has shape `[features, observations]`:

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
observation axis. Negative axes count from the end; normalized axes must be valid
and distinct. All remaining axes
become batch axes in their original order. This uses ordinary ordered unary
cell selection; `rank 2` may accompany `axis`, and `covariance rank 2` uses
trailing cells. `correlation` and its alias `corr` use the same contract.
Both output axes represent features, so these operations declare append
placement rather than restoring input-axis positions: the result is always
`[batch axes..., features, features]`. For example, input shape `2 3 4`
with `axis 0 2` produces shape `3 2 2`; `axis 2 0` produces `3 4 4`.

Covariance divides by `N - 1`, always returns real values, and raises
`.InsufficientData` when the observation axis has fewer than two items. The
ordinary result is completed by `=`. Use `Cov' = Features covariance` to keep a
recipe; each observation recomputes. A full traversal shares feature means only
within its current batch. Independent cell reads, later traversals and retries
after failure start fresh. Assigning `Saved = Cov` retains the completed matrix.

## Sliding windows

Multidimensional `window` creates overlapping tensor cells without eagerly
copying them:

```rank
WindowShape = array 2 3
Blocks = M window WindowShape
Scores = Blocks reduce + axis 2 3 with 0
```

For source shape `4 5`, `Blocks` has shape `3 3 2 3`. The trimmed source axes
form the leading window-position frame and the requested window axes are
appended as trailing cells. The reduction selects axes 2 and 3 to sum each `2 3` block.

Selected axes follow the operation:

```rank
Columns = M window 3 axis 1
Blocks = T window WindowShape axis 0 2
```

There must be one window size for every selected axis. The appended cell axes
follow the explicit axis order.

Stride and symmetric zero padding are contextual modifiers:

```rank
Blocks = M window WindowShape stride 2
Blocks = M window WindowShape padding 1
Blocks = M window WindowShape stride 2 padding 1
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

An explicit axis list selects the cell, so non-trailing and non-contiguous
cells do not require a transpose:

```rank
rem T has shape 2 64 128
Rows = T normalize rank 2
rem two cells of shape 64 128

Planes = T normalize axis 0 2
rem 64 cells of shape 2 128
```

For shape `2 3 4 5`, `T F axis 0 2` passes `2 4` cells to `F` over a `3 5`
frame. If `F` returns an array of rank 2, its two axes occupy source positions
0 and 2, even when their lengths change. For example, a result cell of shape
`6 7` produces shape `6 3 7 5`. A scalar result leaves shape `3 5`; an array
of a different rank appends its axes after the frame. Text, tuples and sequences
remain boxed cell values. With `axis 2 0`, the same `6 7` result cell instead
produces shape `7 3 6 5`: result axis 0 maps to source axis 2 and result axis 1
to source axis 0. This also applies when all source axes are selected.
Bare `rank` retains frame-then-cell assembly. Operations whose result axes are
new axes, such as `covariance`, `correlation` and `corr`, declare append placement:
their feature-by-feature matrix always follows the batch frame. Order-invariant
reductions keep their existing axis-set semantics.

Source cells and assembled results are lazy read-only views. Deferred binding
recomputes demanded cells; ordinary binding completes the result.

A binary operation takes one cell rank per operand with `rank L R`. The left
operand is split into cells of rank `L`, the right into cells of rank `R`, and
their frames broadcast by trailing axes. Arithmetic operators `+`, `-`, `*`, `/`,
`//`, `mod`, `**` and logical operators `and`, `or`, `xor` accept the explicit
form `A B * rank L R`, with both ranks required. For example,
`Weights Batch * rank 0 2` scales each matrix in a batch by its scalar weight:
shapes `B` and `B N M` produce `B N M`, including an empty batch. The operator
broadcasts within each cell; array result axes follow the broadcast frame.
Ordinary infix arithmetic keeps trailing-axis broadcasting, and general binary
calls do not accept explicit `axis` lists.
Ranked logical calls evaluate both operands; scalar infix `and`/`or` guards
retain their short-circuit behavior.

Keeping one side whole and taking the
other item by item finds several values in one vector at once:

```rank
Kinds = "SAMFL" split ""
Index = Kinds find (Ops split "")
rem one position for every code
```

`find` has intrinsic ranks `all 0`, so the explicit `rank 1 0` is the same.
Other built-ins with a binary intrinsic rank:

| Ranks | Functions |
| --- | --- |
| `0 0` | `band`, `bor`, `bxor`, `shl`, `shr`, `atan2`, `binomial`, `gcd`, `lcm`, `bit`, `round`, `min`, `max` |
| `all 0` | `find`, `findall`, `findroot`, `floor`, `ceiling`, `lowerbound`, `upperbound`, `lowerindex`, `upperindex`, `firstatleast` |
| `1 0` | `join`, `percentile`, `quantile` |

`Rows "," join` joins each row of a text matrix. `Values findall Targets` has
array cells that stack under the frame. `Values reshape unpack Shapes` also
stacks a result for each row of a shape matrix: every result must have one shape, or the call raises
`DimensionMismatch`. A built-in without intrinsic binary ranks also accepts
array cell results under an explicit `rank L R`, so `Matrices solve Columns rank 2 1`
solves a batch of systems. For other built-ins each cell result must still be a
scalar. `startswith` keeps whole-operand ranks, because a byte view is an array
that must be compared whole. `take` and `drop` are sequence operators, not
functions, and have no ranks. `rank N` keeps its meaning.

A function whose result length depends on the values, such as `unique`,
`split` or a mask selection, can differ in length from cell to cell. Lifting
it with `rank` over several cells (`M unique rank 1`) works only when every cell
happens to give the same length; the analyzer (and `rank check`) warns on the `rank` word, for
`unique`, `findall`, `words`, `split`, `readlines` and a one-parameter function that returns one of them or a parenthesized boolean-mask selection (`Row (Row greater 0)`), and the
runtime error names the function and the two cell shapes. Reduce inside the
function you lift (`fun Distinct Row` returning `Row unique sum`), pad to a
fixed width, or iterate rows with `for` to keep ragged results.

## Iteration along selected axes

Without `axis`, `for` walks axis 0: a matrix yields rows. Explicit axes name
coordinates to enumerate, not the axes inside each value:

```rank
for Row i in M axis 0
  Row print
end
for Col j in M axis 1
  Col print
end
for Value i j in M axis 0 1
  Value print
end
```

A `3 5` matrix gives 3 rows, 5 columns, or 15 scalar elements respectively.
The value has the selected axes removed; remaining axes keep source order.
For shape `A B C`, `for S j in T axis 1` yields `B` arrays of shape `A C`.
`for Row i j in T axis 0 1` yields `A * B` vectors of length `C`.

Axes are a set: `axis 1 0` and `axis 0 1` both walk row-major in source-axis
order. Negative axes count from the end; duplicates (including normalized
ones) and out-of-range axes are errors. Use nested loops for another order.

The first binding receives the value. Subsequent bindings receive zero-based
coordinates of the selected axes in source-axis order. Indices may be omitted
from the right, and `#` skips a binding: `for V i in M axis 0 1` binds only the
row index; `for V # j in M axis 0 1` binds only the column index. Too many
bindings are rejected even for empty sources. `rank` is not a loop modifier.
Iteration stays lazy; bound values have the usual copy-on-write semantics.

Loop axes differ from function cell axes: `M F axis 0` passes whole columns
to `F`, while `for Row in M axis 0` yields rows. `M sum axis 0` gives the same
result as adding those rows elementwise, producing one total per column.
Ordinary operations in the source retain their modifiers, for example
`for Mean in (M mean axis 0)`. Parenthesize a computed source before adding
loop axes: `for Col in (M + 1) axis 1`.

A range selects a slice and an integer array selects arbitrary positions;
`#` keeps a whole axis, so positional selectors can address any axis:

```rank
Rows = M (1 till 4)
Columns = M # array 0 2 5
```

A range preserves one axis with the selected length. An integer index array
replaces the selected axis with its full shape. For example, a `2 3` index
array applied to axis 1 of a `4 5` matrix returns shape `4 2 3`. All other
axes keep their order and size.

## Outer

`outer` is a higher-order modifier: the operator or named binary function
immediately after it is applied to every pair of cells:

```rank
Sums = A B outer +
Grid = Values Values outer bxor
operation = min
Smallest = A B outer operation
```

Cell ranks belong to the operation, while `outer` combines the remaining
frames. Symbolic binary operations have intrinsic ranks `0 0`. The named
functions `band`, `bor`, `bxor`, `shl`, `shr`, `min`, `max`, `atan2`,
`binomial`, `gcd`, `lcm`, `bit` and `round` also declare ranks
`0 0`.

A user-defined function declares its own ranks with a `rank` tail on the
header, one entry per positional data operand, in declaration order:

```rank
fun X inc Y rank 0 1
  return X + Y
end

memo Row norm rank 1
  return Row sum
end
```

An entry is an integer (negative counts down from the operand's rank), as in a
call-site `rank L R`, or `all` for the whole operand. Without a clause the
ranks are `all all` and nothing changes. The clause needs exactly one entry per
positional data operand, and a function takes it only with one or two data
operands. Function operands and optional configuration do not receive ranks. A
call-site `rank` still overrides the declaration. A function with a declared
rank stacks array results under the frame, and every recursive call inside its
body maps over cells too. Each cell calls a `memo` function on its own, and an
effectful function runs once per cell in cell order. Static analysis does not
describe a call to such a function: its facts stay unknown.

The result shape is the concatenation of the left and right frame shapes. Thus
atom-pairing operations preserve all operand axes. Left frame axes come first
and the right frame varies fastest. The operation must accept two arguments and
currently must return a scalar for every pair.

Both operands must be finite. Ordinary binding completes the result; use
`Pairs' = A B outer operation` to keep a recipe. Each observation recomputes
the demanded pairs, including callback effects. An ordinary `Saved = Pairs`
binding retains the completed result. A deferred assignment does not make a
single-pass operand restartable; bind its completed data before reusing it.

Repeatable sequences with an exact size retain no item history between
observations. Their equally shaped array items are stacked before pairing, so
trailing item axes participate just as they do after an ordinary binding.
Determining the shape can read the first item; indexing reads only the prefix
needed to reach its selected item when direct addressing is unavailable.
A full traversal owns and closes its cursors, including when stopped early.
Unknown-size operands and single-pass resources are completed by the current
`outer` evaluation; this does not make the original resource restartable.

An empty pair frame makes no call to the pair operation. Operands can still
produce empty cells, whose selected producers must run when the result is
completed. Arithmetic and axis permutations preserve these observations;
selecting no producer positions makes no producer calls. Unused nonempty
scalar operands are not evaluated for an empty product.

Explicit binary comparison rank and cell axes are supported as described
in the Rank section. General binary function rank overrides remain deferred.

A future axis-qualified cell view can be passed to `outer`: `axis` order will
define frame order and `rank` will define its cells. This will support pairings
such as every row of one matrix with every column of another as lazy views.
The expression syntax remains deferred because `axis` already introduces
selection. `outer` itself does not permute axes.

## Matrix multiplication

`matmul` from `use linalg` contracts one axis from each numeric array:

```rank
C = A matmul B
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
C = A matmul B axis 2 0
```

Both axes are zero-based. Exactly two axes are required, and out-of-range axes
are errors. Scalar or nonnumeric operands are errors; unequal contracted
dimensions raise `.DimensionMismatch`.

A deferred binding such as `C' = A matmul B` computes output elements on
demand. Repeated demands recompute them; `C = A matmul B` stores the completed
array explicitly.
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
factorsieve
divisors
min
max
infinity
```

`mod` with `equal 0` is an elementwise divisibility test and returns a boolean value
or mask:

```rank
Mask = N mod 3 equal 0
```

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
root of a nonnegative `integer`. A bounded floating-point estimate is verified
using exact integer arithmetic; larger inputs use integer Newton iteration:

```rank
Root = Value isqrt
Roots' = Values isqrt
Saved = Roots
Perfect = Root ** 2 equal Value
```

It maps lazily over arrays and sequences. A negative integer raises
`.DomainError`, and a `real` raises `.TypeError`. The computation uses only
integer arithmetic, so large values do not lose precision.

Ordinary binding stores all roots; a deferred binding recomputes on demand.
For an array, the known scalar-map result shape is available without reading
its cells. Domain errors arise when a selected cell or the full result is read.

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
Angle = Y atan2 X
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
sequences. Mixed array/sequence operands use the shape of the materialized
sequence and the same array broadcasting rule. It can also be supplied to
`outer`.

`factors` accepts a positive integer and returns its prime factors as a finite
lazy sequence in ascending order, including repeated factors. Repeated calls
reuse an automatically grown smallest-prime-factor table within the interpreter,
shared with `divisors`. The table retains at most 4 MiB and covers integers below
`2 ** 20`; larger integers retain trial division without growing the table
beyond this cap. No explicit setup is required:

```rank
Factors = 12 factors
rem 2 2 3
```

Factoring zero or a negative integer is an error. Factoring one produces an
empty sequence.

`Limit factorsieve` prepares the same shared table once and returns an owned
integer array indexed from zero through the inclusive bound. Each cell at
index `N >= 2` contains the smallest prime factor of `N`; cells 0 and 1 are
zero. The bound must be an integer from 0 through 1048575. Changing the returned
array does not change the shared table or another returned snapshot. Each
snapshot takes four bytes per cell, in addition to the retained shared table.

```rank
Spf = 1000000 factorsieve
Rest = 360
for Rest greater 1
  P = Spf Rest
  P print
  Rest //= P
end
rem 2 2 2 3 3 5
```

Exact square residues below `2 ** 64` are factored through their roots, reusing
the bounded table when the root fits it. Their prime multiplicities are doubled.

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
G = 54 gcd 24
L = 8 lcm 12
```

`lcm` also acts as a named reduction over a finite sequence:

```rank
Answer = (1 to 20) lcm
```

Both operations return nonnegative integers. `0 gcd 0` is zero, an `lcm`
containing zero is zero, and the `lcm` of an empty sequence is one.

`powmod` raises an integer base to a nonnegative integer exponent while reducing
every step modulo a positive integer:

Scalar and array operands may be mixed in any of the three positions. Arrays
broadcast as in arithmetic and return integer cells; sequences are not implicitly
materialized. Invalid or missing cells raise when the corresponding result is read.

```rank
Value = Base Exponent Modulus powmod
```

The result is normalized from zero through `Modulus - 1`. The implementation
uses repeated squaring, so it does not construct the potentially huge value
`Base ** Exponent` first.

`binomial` returns the exact binomial coefficient for nonnegative integers
with `0 at most K at most N`:

```rank
Exact = N binomial K
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

The core functions `min` and `max` require no `use numbers`. One operand
reduces a collection. Binary `max` takes its second operand on the right;
binary `min` uses the same operand sides:

```rank
Smallest = Values min
Left = A max B
Bound = (Low max Limit) min High
```

Both broadcast over arrays using the ordinary trailing-axis rules.
Addressing binds within each `max` operand: `A 0 max` reduces the selected
row and `A max B 0` compares A with the selected element of B. A following
known operation continues the pipeline: `A max B sum` sums their elementwise
maximum. Parenthesize arithmetic operands, as in `0 max (Limit - Used)`.
A direct alias (`operation = max`) uses `A operation B`, and `max` can still
be passed to `outer`, `scan`, or `reduce`.

`infinity` is the positive infinite `real` value. Unary negation produces
`-infinity`.

`nan` is the real not-a-number value, printed as `nan`. Every ordering
comparison and `equal` with it is false. `Value isnan` is a boolean mask over
numbers, arrays and sequences; other element types raise `.TypeError`.

## Sequences

`all`, `any` and `count` are named boolean reductions:

```rank
Every = Mask all
Some = Mask any
TrueCount = Mask count
Rows = Flags all axis 1
RowCounts = Flags count axis 1
```

`all` and `any` are equivalent to `reduce and with true` and
`reduce or with false`, respectively.
`count` returns the integer number of `true` values. All three accept only
boolean cells and support `rank` and `axis`. `all` and `any` short-circuit;
`count` examines the complete cell. Empty collections produce `true`, `false`
and zero, respectively. Known unbounded sequences are rejected.

A lazy sequence mask is also accepted by `count`. It counts its `true` values,
just as it does for a boolean array.

A finite lazy source may also define a direct cardinality count. For example,
`N divisors count` returns the number of positive divisors without enumerating
them. Other numeric sequences still fail the boolean-cell requirement.

`divisors` has default cell rank `0`: on an array or sequence of integers it
returns one lazy divisor sequence per integer. The result cells may have different
lengths because they are sequences, not array axes. Count each result separately:

```rank
Counts = (array 6 12) divisors count rank 0
rem 4 6
```

`count` still consumes one complete collection by default, so its `rank 0`
is required here. Scalar `12 divisors count` remains unchanged.


## Random

`use random` provides random sampling operations:

```rank
State = 42 seed
Shuffled = Values shuffle
Repeatable = Values shuffle 42
Sample = Values choices 10
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

`Values choices Count` independently draws `Count` values with replacement
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

`diag` constructs a matrix from a numeric vector or extracts a diagonal from
a numeric matrix. An optional `.anti` mode selects the anti-diagonal; an optional
integer offset follows the mode (or `diag` when no mode is given):

```rank
Matrix = Values diag
Values = Matrix diag
MainAbove = Matrix diag 1
MainBelow = Matrix diag -1
Other = Matrix diag .anti
OtherAbove = Matrix diag .anti 1
OtherBelow = Matrix diag .anti -1
```

Extraction visits rows from top to bottom. In ordinary mode, selected cells
satisfy `column - row = offset`. In `.anti` mode, apply that rule to the matrix
with its columns conceptually reflected: source column is
`Columns - 1 - virtualColumn`. No reflected matrix is allocated. At offset zero,
a rectangular matrix returns `min(Rows, Columns)` values, starting at the
upper-left corner in ordinary mode or upper-right corner in `.anti` mode.
Offsets outside the matrix return an empty vector.

For a vector of length `N`, construction creates a square matrix of side
`N + abs(offset)`, places the vector in extraction order, and fills other cells
with numeric zero. Construction and extraction with the same parameters recover
the vector. Empty inputs are valid, including an empty vector with an offset
(which constructs an all-zero matrix of side `abs(offset)`).

`diag` has intrinsic rank 2: `[B M N]` produces `[B min(M,N)]` at offset
zero. `[B N]` is one matrix, while `Rows diag rank 1` constructs a batch
of diagonal matrices with shape `[B N N]`. No batch interpretation is guessed.
Empty frames preserve every shape-determined result axis, including offsets.

Parameters configure the unary operation before `rank`; they are not ranked
data operands. Explicit cell-axis selection applies after diagonal configuration:

```rank
Lines = Windows diag .anti 1
Total = Matrix diag .anti -1 sum
Offset = -1
Dynamic = Matrix diag .anti Offset
Computed = Matrix diag (Offset + 1)
```

An offset can be an integer literal, a bound value, or a parenthesized expression.
Parenthesize compound expressions to separate them from the following pipeline.
The only mode is `.anti`. Offsets must be integers whose absolute value does not
exceed `9007199254740991`; vector construction also requires a safe matrix cell
count no greater than `4294967295`. These are representation limits, not a
promise that every matrix fitting them can be allocated. Invalid modes or
offset types raise `.TypeError`; excessive offsets or matrix sizes and other
input ranks raise `.DimensionMismatch`. A nonnumeric selected element raises
`.TypeError`. Extraction reads only the selected cells, including lazy windows.

Offsets also construct a tridiagonal second-difference matrix:

```rank
use linalg

Center = (array (-2) (-2) (-2) (-2)) diag
Upper = (array 1 1 1) diag 1
Lower = (array 1 1 1) diag -1
L = Center + Upper + Lower
rem -2  1  0  0
rem  1 -2  1  0
rem  0  1 -2  1
rem  0  0  1 -2

X = array 1 4 9 16
Y = L matmul X
rem 2 2 2 -23
Boundary = array 0 0 0 25
D2 = Y + Boundary
rem 2 2 2 2
```

`X` samples `x ** 2` at positions 1 through 4 with unit spacing. The matrix
product uses zero for missing neighbors; `Boundary` supplies the actual values
0 and 25 at positions 0 and 5. With spacing `H`, divide the corrected second
differences by `H ** 2` to approximate the second derivative.

`det` has intrinsic rank 2 and returns the determinant of a square numeric
matrix:

```rank
D = A det
BatchDeterminants = Batch det
Planes = T det axis 0 2
```

Integer-only matrices produce exact `integer` results; matrices containing a
`real` produce `real`. A singular matrix returns zero, and the determinant of a
`0` by `0` matrix is one. A non-square matrix raises `.DimensionMismatch`; a
nonnumeric element raises `.TypeError`. Higher-rank inputs use the ordinary
trailing-cell and explicit cell-axis rules.

`solve` directly solves `A * X = B`:

```rank
X = A solve B
BatchedVectors = As solve Bs rank 2 1
BatchedMatrices = As solve Bs rank 2 2
```

Both default operands are whole values. Explicit ranks distinguish vector
right sides from matrices containing several right sides. Empty ranked batches
retain the right-side cell axes; incompatible cell shapes still raise a shape
error without solving nonexistent systems.

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
C = A matmul B
C = A matmul B axis 2 0
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
An explicit pair of cell axes selects matrices on other axes:

```rank
Planes = T inverse axis 0 2
```

A non-square cell raises `.DimensionMismatch`; a singular cell raises
`.SingularMatrix`. In a higher-rank result, matrix cells are computed only when
demanded, and each demanded result is cached. Individual matrix inversion uses
partial-pivoting Gauss-Jordan elimination and does not round its real results.

`eigh` has intrinsic rank 2 and decomposes trailing real symmetric matrices:

```rank
unpack Values Vectors = A eigh
```

For `[B N N]`, the result is an array of shape `[B]`, each element holding
one tuple of eigenvalues `[N]` and eigenvectors `[N N]`. Tuple fields remain
boxed, using the same assembly rule as user functions returning tuples:

```rank
use linalg
use sequences
Batch = array 2 1 1 2 4 0 0 5 shape 2 2 2
Results = Batch eigh
unpack Values Vectors = Results 0
rem Values is 1 3; Vectors has shape 2 2
Empty = (array shape 0 2 2 fill 0) eigh
rem Empty has shape 0 and no tuple elements
```

`[0 3 4]` is invalid even though its frame is empty: cell shapes must be
square. Symmetry and element constraints are checked only for existing cells.
The empty batch does not invoke the decomposition.

Eigenvalues are ascending, and the corresponding eigenvectors are columns of
`Vectors`. The operation accepts a square rank-2 numeric matrix and returns
eager real arrays. Asymmetric input raises `.NotSymmetric`; shape, element and
convergence errors use `.DimensionMismatch`, `.TypeError`, `.DomainError` and
`.ConvergenceError`. The current implementation uses Jacobi rotations.

## Bits

`use bits` provides bitwise operations over arbitrary-precision integers:

```rank
A band B
A bor B
A bxor B
A bnot
A shl N
A shr N
A bit N
A popcount
X binary
X binary Width
```

`bnot` follows infinite two's-complement semantics, so `A bnot` equals
`-A - 1`. Fixed-width code makes its width explicit with a mask:

```rank
Word = Value bnot band 65535
```

Shifts require a nonnegative bit count. `shr` is an arithmetic right shift.
`bit` tests a zero-based position and returns a boolean. `popcount` returns the
number of set bits as an integer, including zero for zero. Its work is linear
in the input bit length, with temporary storage proportional to that length.
`bit` and `popcount` require a nonnegative input value.
The module does not introduce a separate bit-mask type: bit masks are ordinary
integers and remain distinct from boolean array masks.

The two-argument forms of `band`, `bor`, `bxor`, `shl` and `shr` have intrinsic
ranks `0 0`, so they can be passed to `outer`:

```rank
Grid = Values Values outer bxor
```

`binary` formats a nonnegative integer as text. With one argument it uses the
shortest representation, including `"0"` for zero. A positive integer width
pads with leading zeroes and raises an error when the value does not fit:

```rank
Bits = 10 binary
Padded = 3 binary 5
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
storage while preserving its shape. On a numeric `segment +`, it creates an
independent persistent version that shares unchanged nodes. On a finite
sequence, it materializes values and stacks equally shaped array items along
a new leading axis, like postfix `array`. An array whose cells are arrays or
finite sequences of one shape stacks them after its own axes. `transpose` requires an array, so
first complete a finite sequence with an ordinary binding, postfix `array`,
or `copy` before transposing it. Ordinary array bindings already provide
independent writable values; `copy` remains available to express snapshot intent.

Both are infinite lazy sources until bounded. `primes` yields ascending prime
integers beginning with `2`, and may seek to a zero-based position through
normal sequence addressing:

```rank
BelowTwenty = primes till 20
SixthPrime = primes 5
```

`from` and `till` with a plain value or a `greater` or `at least` condition
let the source seek instead of enumerating the discarded prefix:

```rank
Candidates = primes from 100
First = Candidates 0
rem First is 101
```

`fibonacci from Lower` uses the same plan interface. A lower-bounded source is
still infinite until `till` supplies an upper boundary.

`in` performs optimized primality testing on this source without enumerating
an unbounded prefix:

```rank
if Candidate in primes
  ...
end
```

The test is exact up to about `3.3e24`. Above that it is a Miller-Rabin
probable-prime test, wrong for a composite with probability below `4 ** -14`.

Prime enumeration uses an odd-only segmented bit sieve for values below
`2 ** 40`. Each traversal owns its buffer and prepares only the next demanded
segment; a huge upper bound does not trigger an eager sieve through its square
root. Larger starting points use the direct primality path. Segment storage and
the base-prime table have fixed limits, so an infinite traversal does not retain
every prime it has yielded.

Membership in a bounded prime source uses an on-demand sieve segment in that
same numeric region, with one cached segment per source plan. Unbounded prime
membership and larger values use direct primality testing. Bounds, integer-valued
real inputs and the primality guarantees above are unchanged.

For repeated primality queries over a known finite range, `Limit primesieve`
eagerly builds an odd-only bitmap and returns a stored finite prime sequence.
The bound is inclusive and must be an integer from `0` through `4294967295`.
Membership takes O(1) time after construction:

```rank
Sieve = 100000001 primesieve
IsPrime = 99999989 in Sieve
Window = Sieve from 100 till 130
rem Window is 101 103 107 109 113 127
```

Ordinary binding retains this completed bitmap, including inside records and
tuples. It does not expand the sequence into an array of primes. Bounds share
the same bitmap; `copy` or postfix `array` explicitly materializes the prime
values. Sequence addressing, such as `Sieve 5`, still selects a prime by its
zero-based position; use `N in Sieve` to test primality. Negative numbers,
nonintegral reals and numbers above the bound are not members. Integer-valued
reals follow ordinary numeric membership rules.

Storage is one bit per odd value, rounded up to whole bytes: the bound
`100000001` uses `6250001` bitmap bytes (about 5.96 MiB), and the maximum bound
uses 256 MiB. Construction takes O(Limit log log Limit) time and supports host
cancellation. No smallest-prime-factor table is built. An apostrophe binding,
such as `Sieve' = Limit primesieve`, retains its usual expression replay
semantics and rebuilds the table when demanded; use ordinary `=` to build once.

A boundary remains part of membership, so `23 in (primes till 20)` is false.
`fibonacci` also supports membership without an upper bound: its plan advances
only as far as the queried value and respects lower and upper boundaries.
Scalar membership in another bounded sequence uses a finite linear scan;
batch membership builds a lookup once. An unbounded sequence without its own
membership plan is rejected.

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
rollup by
leftjoin by
innerjoin by
leftjoin on
innerjoin on
```

`labels` returns the ordered column labels of a rank-1 table. CSV headers are
retained even for empty columns and zero data rows. For object arrays without
CSV headers, it unions keys in first-appearance order. `group by` builds a
grouped view from one or more named fields. A grouped `select` block names
aggregates and produces a flat table with the keys. SQLite translates grouped
`count`, `sum`, `min`, `max`, and `mean` in one lazy query; `median` and `std`
currently require an array table. `rollup by` adds prefix subtotals
and a grand total to the grouped result.
`leftjoin` and `innerjoin` match shared fields after `by`, or differently named
field pairs after `on`. These are table operations distinct from text `join`.
`sqlite` opens an existing database; `Db .table` returns a lazy table view
that postfix `array` materializes. `sql` inspects its parameterized statement,
`explain` returns SQLite plan rows, and `sqlquery` creates a read-only query
with bound positional parameters. Direct `insert`, `update` and `delete` write
to a base table or its filtered view. Prefix a write with `sql` or `explain`
to inspect it without executing it.

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
Loss = Pred mse Target
Rows = Pred mae Target axis 1
Cov = Features covariance
Cov = Samples covariance axis 1 0
```

`mean`, `median` and `std` accept a numeric array or finite sequence and always
return a `real`. They skip missing cells in a projected table column. An empty
input, including a column containing only missing cells, raises
`.EmptyReduction`. `median` sorts a copy, selects the middle value for an odd
count and averages the two middle values for an even count. `std` divides by
the population denominator `N`. All three operations support `rank` and `axis`;
tensor behavior is described in [Tensors](language/tensors.md). `median` and
`std` reject nonfinite cells with `.DomainError`.

`mse` and `mae` calculate mean squared error and mean absolute error between
two numeric values, finite sequences or arrays:

```rank
Loss = Pred mse Target
FeatureLoss = Pred mae Target axis 0
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
observations. Ordinary binding stores the completed result. Deferred binding
recomputes on demand; a traversal may share feature means within its current
batch, but later observations start fresh.

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
Parts = "2x3x4" split "x"
Fields = Text split (array "," ";")
Characters = "A😀Б" split ""
```

`Text words` returns lowercase Unicode letter-and-number runs as a rank-1 text
array; punctuation and whitespace separate words. `Texts vocab Limit` accepts
a rank-1 text array and a nonnegative integer limit. It counts all words,
orders them by descending frequency and then ascending Unicode code point
order, and returns at most `Limit` terms. An empty input or zero limit returns
an empty array. These operations require `use text`; wrong element types raise
`.TypeError`, and an invalid limit raises `.DomainError`.

`parse` matches a complete text value against a text pattern and returns the
captured values as an array when all captures have the same type, or a tuple
when their types differ. It is normally combined with `unpack`:

```rank
Pattern = "/word to /word = /integer"
unpack From To Distance = Line parse Pattern
```

Patterns use `/integer`, `/real`, `/word` and `/text`. Integers and reals are
converted to their corresponding scalar types. `/word` captures one or more
non-whitespace characters. `/text` captures as little text as possible while
allowing the following literal pattern to match. `//` matches one literal
slash. All other characters, including spaces, match exactly:

```rank
Pattern = "/integerx/integerx/integer"
unpack Length Width Height = "2x3x4" parse Pattern

Spaced = "/integer x /integer"
unpack A B = "2 x 3" parse Spaced
```

An unknown directive raises `.InvalidFormat`. Input that does not match the
complete pattern raises `.InvalidText`, with the original pattern or input
available as the error value respectively.

`startswith` tests an exact, case-sensitive prefix:

```rank
Ready = Text startswith "Rank"
```

Two bytes values use a direct byte comparison with no text conversion or
slice allocation. An empty prefix matches any value; a longer prefix never
matches. Text and bytes cannot be mixed implicitly.

```rank
Signature = (array 137 80 78 71) bytes
IsPngPrefix = Header startswith Signature
```

`lower` converts Unicode text to lowercase. `startswith` broadcasts over text
arrays; `lower` maps over them lazily. Both compile to SQLite expressions for
database columns. `"part" in Text` tests an exact substring and also works on
SQLite columns.

`Text Width Fill lpad` adds characters on the left until the result reaches
`Width` Unicode code points. `Width` is nonnegative, `Fill` is nonempty, and a
value already at least that wide is unchanged. A multicharacter fill repeats
from its first character and may be cut at the requested width.

`Text Chars Replacement translate` maps each Unicode character in `Chars` to
the corresponding character in `Replacement`; characters without a replacement
are deleted. Characters not listed in `Chars` remain unchanged. On arrays, the
three arguments broadcast scalars against same-shaped arrays and stay lazy.
On SQLite views, these operations stay in the query and preserve missing cells
as SQL `NULL`.

```rank
Quiet = "RANK" lower
Zip = "234" 5 "0" lpad
Digits = "(844) 123-4567" "-() " "" translate
```

`hex` converts `bytes` to lowercase hexadecimal text without a prefix:

```rank
Encoded = Bytes hex
```

`integer` parses optional `+` or `-` followed by decimal digits. A complete
text value is converted at once. Explicit `rank 0` converts each Unicode code
point and produces a rank-1 array:

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
A format variable or an alias such as `text_fn = text` does not accept the modifier.
Formatted arrays keep their shape; formatted sequences are lazy.
Plain `text` and `print` keep their existing behavior.

`join` takes a rank-1 array, queue-family collection or finite sequence followed
by a text separator. It converts scalar elements as plain `text` does and
returns one string. An empty collection produces empty text. An empty separator
concatenates the elements directly:

```rank
(array 1 2 3) join ", " print
rem 1, 2, 3
(array "ab" "cd") join "" print
rem abcd
```

A nontext separator, nonscalar element or higher-rank array raises
`.TypeError`. Join matrix rows explicitly instead of flattening the matrix:

```rank
for Row in Matrix
  Row text join ".6f" " " print
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

`reshape` from `sequences` changes an array's shape in row-major order:

```rank
M = Values reshape Rows Columns
```

One dimension may be `#`, inferred from the total number of elements:

```rank
Col = Values reshape # 1
Row = Values reshape 1 #
Pairs = Values reshape # 2
Flat = Values reshape #
```

The other dimensions must have a positive product that divides the element
count exactly. An empty source can reshape to `# 1` (shape `0 1`), but `# 0`
is ambiguous and raises `DimensionMismatch`. Only one `#` is allowed, written
directly among the reshape dimensions; it is not a value to store in a shape
array. Negative dimensions, including `-1`, remain invalid.

For an array, `reshape` checks its shape and preserves flat row-major indices
without reading its cells. Stored scalar arrays share copy-on-write storage;
computed arrays remain views. Ordinary assignment, ordinary parameters, writes
and explicit `copy` complete the value. Plans compute again on separate
observations; cell errors occur when the affected cells are read.

Text, queues and finite sequences are read once to build indexable storage.
Transpose keeps its existing axis-permutation behavior.


Dimensions are nonnegative integers; `unpack` expands a rank-1 shape array. The source may be an
array, queue, finite sequence or text, and its element count must exactly match
the requested shape. An infinite source is an error.

`window` returns overlapping fixed-size cells lazily:

```rank
Pairs = Text window 2
Windows' = Values window Width
WindowShape = array 2 3
Blocks = M window WindowShape
Columns = M window 3 axis 1
Strided = M window WindowShape stride 2
Padded = M window WindowShape padding 1
```

Tensor window sizes correspond to all axes unless `axis` selects a subset.
`stride` and `padding` accept a scalar for all selected axes or one integer per
axis. Their defaults are one and zero. Strides are positive; padding is
nonnegative, symmetric, array-only and filled with integer zero. The modifiers
precede a final `axis` clause when combined. Results remain lazy and contain
only complete windows of the conceptually padded source.

## JSON

`use json` decodes a complete JSON document from text into Rank values:

```rank
Data = Text json
FileData = Path read json
```

JSON integers become arbitrary-precision `integer` values. Decimal and
exponent forms become `real`; strings and booleans become the corresponding
Rank scalars; homogeneous arrays become Rank arrays and heterogeneous arrays
become tuples; objects become keyed `object` values;
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

A list of text keys reads each key in the order listed, and a missing key raises
`.Missing`:

```rank
Values = Data (array "name" "age")
```

### Flat table of nodes

`.flat` after `json` decodes the same document into a rank-1 table with one row
per value, in document order, so a container precedes its contents:

```rank
Nodes = Text json .flat
Numbers = Nodes filter .kind equal "integer"
Total = Numbers .value integer rank 0 sum
```

Every row is an object with the same fields, shared with `xml .flat`:

| Field | Meaning |
| --- | --- |
| `.depth` | Nesting depth; the document value is at 0. |
| `.parent` | Row number of the enclosing container; -1 for the document value. |
| `.kind` | `"object"`, `"array"`, `"integer"`, `"real"`, `"text"`, `"boolean"` or `"null"`. |
| `.name` | The key of an object entry; `""` for array items and the document value. |
| `.value` | Text representation of a leaf; `""` for objects and arrays. |

`.kind` is text rather than a label because a label inside a table condition
names a column. The tree suits documents whose shape is known, where a path
names what to read; the table suits a search at any depth, which is an ordinary
filter. `.parent` reaches the enclosing row without a recursive walk.

## XML

`use xml` decodes a complete XML document from text into a tree of nodes:

```rank
Doc = Text xml
Params = Doc .children 0 .attributes
```

A node is an object with `.kind`, `.name`, `.value`, `.attributes` and
`.children`. Elements have `.kind` `"element"`, their tag name and their
attributes as a keyed object; their text and comments are children with `.kind`
`"text"` or `"comment"` and their content in `.value`. `.children` is an array of
nodes in document order.

`.flat` decodes the document into a table of nodes with the fields of the JSON
table and `.attributes`, as `⎕XML` does in APL:

```rank
Nodes = Text xml .flat
Found = Nodes filter .name equal "BuyRentParams"
Values = Found 0 .attributes Fields real rank 0
```

Attribute values stay text; convert them explicitly. The decoder accepts
elements, attributes, text, comments, CDATA sections, the five predefined
entities and character references. The XML declaration, processing
instructions and a document type declaration are skipped, adjacent text and
CDATA form one text node, and text that is only whitespace between markup is
dropped. Namespace prefixes are not resolved, so `a:b` is an ordinary name.
Malformed input raises `.InvalidXml`. Filtering the table by a field needs
`use tables`, as it does for any table.

## Cryptography

`use crypto` provides hash and related byte operations. `md5` hashes bytes
directly or the UTF-8 encoding of text and returns 16 `bytes`; formatting
remains an explicit step:

```rank
Digest = Text md5
Hash = Digest hex
```

The CLI uses Node's native MD5 implementation. Browser and other hosts use the
portable implementation unless they supply an `InterpreterOptions.md5` callback.
Both accept text or bytes and return the same 16-byte digest.

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
consumed, so input and conversion errors are delayed too. A late error names the
item and the line of the `stdin` that declared it (`invalid integer input: x (item 3
of 3, read by stdin .integer at line 3)`). Use postfix `array`
when the complete input must be validated or traversed more than once:

```rank
Values = stdin .integer Count array
```

Line-oriented input is not part of the current language yet.

`use io` provides one-shot UTF-8 text operations for the common case:

```rank
Text = Path read
Lines = Path readlines

Text write Path
Text append Path
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
Bytes = Path Offset readbytes Count
```

`bytes` is a specialized rank-1 tensor whose atoms are integers from 0 through
255. It formats as hexadecimal text such as `0x52616e6b`. Offsets and counts are
nonnegative integers, and a block ending past the file returns the available
bytes.

Repeated and stateful I/O uses a `file` value:

```rank
File = Path open

Header = File 64 readbytes
File seek 1024
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
Output writebytes Bytes
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

`date` accepts exactly `YYYY-MM-DD` text or a `datetime`, discarding its time.
`datetime` accepts exactly `YYYY-MM-DD HH:MM:SS` or
`YYYY-MM-DDTHH:MM:SS` text, a `date` (converted to midnight), or an existing
`datetime` (unchanged). Both use the proleptic
Gregorian calendar and years `0001` through `9999`. `datetime` is a local
wall-clock value without a time zone or UTC offset. Invalid syntax, dates and
times raise `.InvalidDate`; other input types raise `.TypeError`.

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
A missing projected table cell is `.NA`, which `date` and the date parts
reject with `.Missing`; `default` fills it before parsing.

Subtracting two `datetime` values produces an immutable `duration` containing
an exact signed integer number of seconds. `duration seconds` returns that
integer, distinct from `datetime second`, which extracts a clock component.
The difference is computed from local wall-clock fields using the proleptic
Gregorian calendar, with no time-zone or daylight-saving conversion. `duration`
prints as `N days` when it has whole days, otherwise with an `HH:MM:SS` part;
negative values carry a leading minus sign. `datetime` subtraction broadcasts
over arrays and sequences as ordinary subtraction does. Subtracting a `date`
or mixing date, datetime and numeric operands raises `.TypeError`.

`Seconds duration` converts exact integer seconds to a `duration`; applying it
to a duration returns that value. Nonintegral or unsafe real seconds raise
`.TypeError`. A duration can be multiplied by a number in either order if the
result has exact integer seconds. Adding a duration to a datetime in either
order moves the local wall-clock value by that many seconds. The result must
remain within years `0001` through `9999`, otherwise it raises `.InvalidDate`.
These operations broadcast over arrays and sequences with their usual lazy
behavior. Months and years are calendar operations, not fixed durations.

On a SQLite column, `date` or `datetime` followed by `year`, `month` or `day`
builds a lazy `strftime` expression. This path expects canonical date text;
unlike array parsing it does not validate each source cell when building the
query, and invalid SQLite date text produces a missing result. Casting a typed
SQLite `date` expression with `datetime` builds `datetime(value)` in the same
plan, retaining its bound parameters and producing midnight timestamps.
For two SQLite expressions marked `datetime`, subtraction generates
`unixepoch(left) - unixepoch(right)` with bound scalar timestamps. `seconds`
keeps the duration expression in the SQL plan and yields integer values on
materialization. Invalid SQLite timestamp text yields a missing result.

On a SQLite view, converting a numeric column with `duration` and scaling a
duration by a numeric column keep the signed second count in the SQL plan.
Adding it to a typed datetime emits a guarded `datetime(moment,
printf('%+d seconds', seconds))` with bound scalar values; nonintegral SQL
seconds become missing rather than being rounded. The result is a typed
datetime expression that can be projected, sorted and limited before rows are
read.

`monthstart` and `nextmonth` accept a `date` or `datetime` and return a
`datetime` at midnight on the first day of the current or next month. They
preserve lazy array and sequence mapping, including invalidation after tracked
array mutations. `nextmonth` past December 9999 raises `.InvalidDate` on an
ordinary value. On a typed SQLite date or datetime expression, they compile
to `datetime(value, 'start of month')` and
`datetime(value, 'start of month', '+1 month')` respectively, without reading
source rows. SQLite invalid dates yield missing cells.

```rank
Days = (Train .date default "2024-01-01") date
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
Tree = Values segment min
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
Pairs = Values combinations 2
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
See [collections](language/collections.md) for examples and empty-container rules.

`Values multiset` constructs a populated ordered multiset; `new multiset`
creates an empty one. A multiset preserves duplicates. `Bag I` selects a sorted
occurrence by zero-based index. Its lookup and mutation operations take expected
`O(log N)` time. Missing indexed, `floor` and `ceiling` results raise `.Missing`
and therefore compose with `default`. The complete collection semantics are defined
in [Collections](language/collections.md).

`Size fenwick` constructs a fixed-size integer Fenwick tree. It supports
zero-based cell access and assignment plus inclusive prefix sums through
`F sum I`, all as specified in [Collections](language/collections.md).
This middle use of `sum` dispatches by the receiver's Fenwick type and does not
reserve the word in other application chains.

`Values segment Operation` builds a segment tree for an associative binary
operation. `Tree Left Right query` reduces an inclusive range, and addressed
assignment performs a point update. Construction, bounds and error behavior
are specified in [Collections](language/collections.md).

`Tree firstatleast Target` finds the first monotone numeric prefix that reaches
the target. `Values segment maxsum` selects the native prefix/subarray summary
profile. `Values wavelet` prepares immutable inclusive range counts through
`Data Left Right Low High within`. Numeric wavelets also provide `sumwithin`
for range-value sums and `Data missing Bounds` for positive coin values.

Numeric `Values segment +` trees also accept `Tree Left Right = Value` and
`Tree Left Right += Delta` with lazy `O(log N)` range updates.

## Graph profile

`use graph` provides the `new graph` constructor, graph-specific `add` and
`edges` dispatch, and the `bfs`, `dfs`, `components`, `bipartite`, `dijkstra`,
`bellmanford`, `floyd`, `cycle`, `euler`, `topological`, `scc`, `mst`, and `maxflow`
algorithms. It also provides the experimental `Next functional` prepared value
with `jump`, `distance`, `lengths`, and the increasing-path `upto` query.
`Next weighted Cost` adds numeric edge sums to that path. Their inputs and
results are specified in [Graphs](language/graphs.md).
An undirected tree can be prepared with `Tree root Root`; its postfix
`ancestor`, `lca`, and `distance` queries and traversal fields follow the
rooted-tree rules above. `Tree pathlengths` provides a lazy unordered-pair
distance sequence with planned exact and bounded-range counts.
The same module provides closed and open `new dsu` structures with contextual
`merge`, `findroot`, and `connected` methods plus `components` and `len` queries.

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

N = 1 till 1000

Mask = N mod 3 equal 0
Mask or= N mod 5 equal 0

Answer = N Mask sum

Answer print
```

This example demonstrates:
- the ordinary/lazy sequence `1 till 1000`;
- the `mod` operator tested against zero for divisibility;
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
Mask = Fib even
Answer = Fib Mask sum
```

The bounded Fibonacci source stays lazy. Explicit selection with `Fib Mask`
lets the planner push the predicate into the Fibonacci source, which can
generate only even terms. The mask itself contains boolean values.

## 3. Largest prime factor

```rank
rem Project Euler 3
rem Largest prime factor of 600851475143
rem https://projecteuler.net/problem=3

use io

N = 600851475143
D = 2
Step = 1
for N greater 1
  Rest = N // D
  if D greater Rest
    break
  elif Rest * D equal N
    N = Rest
  else
    D += Step
    Step = 2
  end
end
N print
```

The loop divides out each prime factor, trying 2 and then odd divisors.
When the divisor exceeds the remaining quotient, `N` is the largest prime factor.

## 4. Largest palindrome product

```rank
rem Project Euler 4
rem Largest product of two N-digit numbers
rem https://projecteuler.net/problem=4

Lower = 10 ** (Digits - 1)
Upper = Lower * 10 - 1

Factors = Lower to Upper
Products = Factors Factors outer *
Palindromes = Products filter palindrome rank 0
Answer = Palindromes max
```

`outer` constructs the multiplication table lazily. Ranked `palindrome` checks
each scalar product, and `filter` selects the candidates for `max` without
naming the table twice.
The helper reverses decimal digits with integer arithmetic in a local loop
and compares the result with its input.

## 5. Smallest multiple

```rank
rem Project Euler 5
rem Smallest number divisible by 1..20
rem https://projecteuler.net/problem=5

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

arg Count integer = 10001

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

arg Width integer = 13

Digits = Number integer rank 0
Windows = Digits window Width
Products = Windows reduce * axis 1
Answer = Products max
```

Explicit `rank 0` converts the text atoms into a rank-1 digit array. The loops
are unnecessary: `window` exposes each adjacent rank-1 digit cell and the
ranked multiplication reduction produces one value per cell. The default width
13 produces `23514624000`; width 4 produces `5832`.

## 9. Special Pythagorean triplet

```rank
rem Project Euler 9
rem https://projecteuler.net/problem=9

use numbers

arg Target integer = 1000

ALast = (Target - 1) // 3
BLast = (Target - 1) // 2
A = (1 to ALast) array
B = (2 to BLast) array
PairSums = A B outer +
C = Target - PairSums

Increasing = A B outer less
Increasing and= B less C

ASquares = A ** 2
BSquares = B ** 2
SquareSums = ASquares BSquares outer +
Valid = SquareSums equal C ** 2
Valid and= Increasing

PairProducts = A B outer *
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

arg Limit integer = 2000000

Primes = primes till Limit
Answer = Primes sum
```

The bound becomes part of the lazy prime-source plan, and `sum` consumes that
finite plan. The default limit produces `142913828922`; limit 10 produces `17`.

## 11. Largest product in a grid

```rank
rem Project Euler 11
rem https://projecteuler.net/problem=11

products = reduce * axis 2 max
H = Grid window 4 axis 1 products
V = Grid window 4 axis 0 products
D = Grid window 4 4 diag products
U = Grid window 4 4 diag .anti products

Answer = (array H V D U) max
```

The grid is one dense rank-2 array. Horizontal and vertical products reduce
sliding windows of four values. The `D` and `U` products take the diagonal of
each 4-by-4 window; `.anti` selects the other direction from the same windows. The full
example produces `70600674`.

[Explore how the windows, diagonals, and result axes work](visualizations/euler-11-windows.html).

## 12. Highly divisible triangular number

```rank
rem Project Euler 12
rem https://projecteuler.net/problem=12

use numbers
use sequences
arg Min integer = 500
N = 1 to #
Triangles = N * (N + 1) // 2
Counts = Triangles divisors count rank 0
Ans = Triangles (Counts greater Min) first
```

`divisors count` computes the number of positive divisors from prime exponents
without enumerating the divisors. The unbounded range generates triangular
numbers lazily, and `first` stops at the first number whose divisor count
exceeds the threshold. No arbitrary search limit is needed. The first triangle
with over 500 divisors is `76576500`; with over 5 divisors it is `28`.

## 13. Large sum

```rank
rem Project Euler 13
rem https://projecteuler.net/problem=13

Total = Numbers sum
Text = Total text
Prefix = Text (0 till 10)
Answer = Prefix integer
```

Rank integers keep all 50 decimal digits, so the program can sum the original
values directly. Text slicing then selects the requested leading digits. The
answer is `5537376230`.

## 14. Longest Collatz sequence

```rank
rem Project Euler 14
rem https://projecteuler.net/problem=14

Limit = 1000000
Lengths = array shape Limit fill 0
Lengths 1 = 1
for Start in 2 till Limit
  N = Start
  Steps = 0
  for N at least Start
    if N mod 2 equal 0
      N = N // 2
    else
      N = 3 * N + 1
    end
    Steps += 1
  end
  Lengths Start = Steps + Lengths N
end

Answer = Lengths max .index
```

Starting values are processed in ascending order. Once a chain reaches a
smaller starting value, its remaining length is already stored in the dense
array. Each length is stored at its starting value's index, so the maximum's
index directly gives the answer, `837799`.

## 15. Lattice paths

```rank
rem Project Euler 15
rem https://projecteuler.net/problem=15

Top = (Size + 1) to Size * 2
Bottom = 1 to Size
Numerator = Top reduce *
Denominator = Bottom reduce *
Answer = Numerator // Denominator
```

Two products evaluate the numerator and denominator of the central
binomial coefficient with exact integers. Empty ranges retain the identity, so
a zero-sized grid has one path. A 20 by 20 grid has `137846528820` paths.

## 16. Power digit sum

```rank
rem Project Euler 16
rem https://projecteuler.net/problem=16

Digits = (2 ** 1000) text
Values' = Digits integer rank 0
Answer = Values sum
```

Exponentiation remains exact. Explicit rank 0 parses each character as one
digit, and `sum` reduces the resulting sequence to `1366`.

## 17. Number letter counts

```rank
rem Project Euler 17
rem https://projecteuler.net/problem=17

Numbers' = 1 to Limit
Counts' = Numbers letters rank 0
Answer = Counts sum
```

The program creates the small English length tables once. Its `letters`
helper reads those retained tables. Rank-0 application converts every
number to a letter count, and `sum` adds the counts. The helper
implements British `and` without constructing the spelled-out text. The total
is `21124`.

## 18. Maximum path sum I

```rank
rem Maximum Path Sum I
rem https://projecteuler.net/problem=18
rem Find the largest top-to-bottom path
rem sum through a number triangle

use io
use sequences

Triangle = array shape 15 15
  75  0  0  0  0  0  0  0  0  0  0  0  0  0  0
  95 64  0  0  0  0  0  0  0  0  0  0  0  0  0
  17 47 82  0  0  0  0  0  0  0  0  0  0  0  0
  18 35 87 10  0  0  0  0  0  0  0  0  0  0  0
  20  4 82 47 65  0  0  0  0  0  0  0  0  0  0
  19  1 23 75  3 34  0  0  0  0  0  0  0  0  0
  88  2 77 73  7 63 67  0  0  0  0  0  0  0  0
  99 65  4 28  6 16 70 92  0  0  0  0  0  0  0
  41 41 26 56 83 40 80 70 33  0  0  0  0  0  0
  41 48 72 33 47 32 37 16 94 29  0  0  0  0  0
  53 71 44 65 25 43 91 52 97 51 14  0  0  0  0
  70 11 33 28 77 73 17 78 39 68 17 57  0  0  0
  91 71 52 38 17 14 91 43 58 50 27 29 48  0  0
  63 66  4 68 89 53 67 30 73 16 69 87 40 31  0
   4 62 98 27 23  9 70 98 73 93 38 53 60  4 23
end

fun Low pick Up = Up + (Low max (concat (Low drop 1) (array 0)))
Rev = Triangle reverse axis 0
Best = Rev reduce pick rank 1 axis 0
Answer = Best 0
Answer print
```

The triangle is padded to a rectangular matrix. Reverse axis 0 to visit rows
from bottom to top, then fold whole rows with `rank 1 axis 0`. Each step adds
the upper row to the larger of its two possible children. The first element
of the final row is `1074`.

## 19. Counting Sundays

```rank
rem Project Euler 19
rem https://projecteuler.net/problem=19

Years = (1900 to 2000) array
Leap = Years mod 4 equal 0
Leap and= (
  not Years mod 100 equal 0
  or Years mod 400 equal 0
)
Base = array shape 12
  31 28 31 30 31 30
  31 31 30 31 30 31
end
Feb = (0 till 12) equal 1
Extra' = Leap Feb outer and
Lens' = Extra integer + Base
Flat = Lens reshape #
Start' = Flat scan + with 1
Cent' = Start drop 12 take 1200
Answer = Cent mod 7 equal 0 count
```

An outer `and` of the leap-year mask with a February mask adds the leap day
to a 101 by 12 table of month lengths. Its running sum from the stated 1900
Monday gives the weekday of every month start; `drop 12` skips 1900 and
`take 1200` drops the extra start of January 2001. The twentieth-century
count of Sundays is `171`.

## 20. Factorial digit sum

```rank
rem Project Euler 20
rem https://projecteuler.net/problem=20

Factorial = (1 to 100) reduce *
Digits = Factorial text
Values' = Digits integer rank 0
Answer = Values sum
```

The symbolic product reduction computes the exact factorial; the same ranked
text conversion as problem 16 gives the digit sum `648`.

## 21. Amicable numbers

```rank
rem Project Euler 21
rem https://projecteuler.net/problem=21

Candidates = (2 till Limit) array
Partners = Candidates proper_divisor_sum rank 0
Reverse' = Partners proper_divisor_sum rank 0
Amicable = Partners not equal Candidates
Amicable and= Reverse equal Candidates
Values' = Candidates Amicable
Answer = Values sum
```

`proper_divisor_sum` selects divisor pairs only through the square root and
reduces their two sums. Rank-0 application computes every partner and reverse
partner, then a boolean mask selects the amicable values. Their seeded sum is
`31626` below 10000.

## 22. Names scores

```rank
rem Project Euler 22
rem https://projecteuler.net/problem=22

Text = Input read
Names = Text names_from_text
Sorted = Names sort
Values' = Sorted name_value rank 0
Count = Sorted len
Positions' = 1 to Count
Scores' = Values * Positions
Answer = Scores sum
```

The program accepts the official names file as a path argument. It removes the
outer quotes and splits the CSV text. Rank-0 application derives every name's
letter value, array multiplication applies the one-based positions, and a
named `sum` reduction adds the scores. The official input is embedded only in the
test; the program tree needs no fixture file. The answer is `871198282`.

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
Remainder = Remainder * 10 mod Denominator
```

Long division repeats exactly when a remainder repeats. A sparse `index`
records the first position of each remainder, giving denominator `983` below
1000.

## 27. Quadratic primes

```rank
rem Project Euler 27
rem https://projecteuler.net/problem=27

for A in (-Limit + 1) till Limit by 2
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

Layers' = 1 to (Size - 1) // 2
Sides' = Layers * 2 + 1
Corners' = 4 * Sides ** 2 - 6 * (Sides - 1)
Answer = 1 + (Corners sum)
```

Each concentric layer contributes its four corners. Deferred arithmetic feeds
the sum without retaining each named stage, and the separate `1` includes the center cell even
when there are no outer layers. The formula gives `669171001` for a 1001 by
1001 spiral without constructing the matrix.

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
Digits' = Text integer rank 0
Powers' = Digits ** Power
Sum = Powers sum
```

Rank-0 conversion exposes decimal digits, scalar extension raises every digit,
and a reduction checks their sum. The fifth-power answer is `443839`; the same
function gives `19316` for fourth powers.

## 31. Coin sums

```rank
rem Project Euler 31
rem https://projecteuler.net/problem=31

Ways = array shape (Target + 1) fill 0
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

Candidates' = primes till Limit
Circular' = Candidates circular_prime rank 0
Answer = Circular count

for Shift in 1 till Length
  Left = Text (Shift till Length)
  Right = Text (0 till Shift)
  Number = (Left + Right) integer
end
```

Rank-0 application tests the bounded prime sequence, and `count` reduces its
boolean results. Inside one candidate, decimal slices form each rotation and
the loop returns at the first failure. `Number in primes` performs optimized
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

LeftText = Text (Drop till Length)
RightText = Text (0 till Last)
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

Digits' = Positions champernowne_digit rank 0
Answer = Digits reduce *

for Remaining greater Digits * Count
  Remaining -= Digits * Count
  Digits += 1
  First *= 10
  Count *= 10
end
```

Rank-0 application finds all requested digits, and a reduction multiplies
them. Inside one position, the loop retains the four related block-location
states; whole blocks of equal-width integers are skipped arithmetically, so the
program never constructs the million-character prefix. The product is `210`.

## 41. Pandigital prime

```rank
CandidateTexts' = Digits permutations
Candidates' = CandidateTexts integer rank 0
Prime' = Candidates in primes
Answer = (Candidates first where Prime) default 0
```

Descending digits make lazy permutations arrive from largest to smallest. The
integer conversion and prime mask remain lazy, so `first where` stops at the
first match. The first prime is `7652413`.

## 42. Coded triangle numbers

```rank
Values' = Words word_value rank 0
Discriminants = 8 * Values + 1
Roots' = Discriminants isqrt
Triangular' = Roots ** 2 equal Discriminants
Answer = Triangular count
```

Inside `word_value`, rank-0 `codepoint` and a seeded sum reduce each word to its
alphabetic value. Another rank-0 application handles all words. Exact `isqrt`
builds a boolean mask of triangular values, and `count` returns `162` for the
official file.

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
Modulus = 10 ** Digits
Numbers' = 1 to Limit
Powers' = Numbers Modulus modular_self_power rank 0 0
Total = Powers sum
Answer = Total mod Modulus
```

A local rank-0 operation computes each modular self power. `sum`
adds them, and one final remainder keeps the requested decimal suffix. Modular
exponentiation avoids large intermediate powers. The final ten digits are
`9110846700`.

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
Prefix = Primes scan + with 0
Length = (Prefix till Limit) len - 1

Total = Prefix End - Prefix Start
if Total in primes
  return Total
end
```

A seeded scan builds the zero-based prefix table. `till Limit` finds
the longest prefix whose sum stays below the limit without a mutable
accumulator. Every
interval sum is then constant time, and lengths are tried from largest to
smallest. The result below one million is `997651`.

## 51. Prime digit replacements

```rank
Places' = 0 till (Digits len - 1)
Same = (Digits Places equal Digit) indices

for Pick in Same combinations 3
  Family = Prime Pick replacement_family
  if (Family in primes) count at least 8
    return true
  end
end
```

`indices` turns the equality mask into candidate positions, while fixing the
last digit avoids replacements that are necessarily even or divisible by 5.
Each family is formed by adding the combined decimal place weight, and planned
membership in `primes` checks the whole family. The smallest match is `121313`.

## 53. Combinatoric selections

```rank
Top' = (N to 1 by -1) scan * with 1
Bottom' = (1 to N) scan * with 1
Choices' = Top // Bottom
```

The two seeded scans build the numerator and denominator products for every
binomial coefficient in a row, including the initial coefficient `1`. Applying
the row function with `rank 0` and reducing its counts with seed `0` gives
`4075` values above one million.


---

# LeetCode examples

These examples use only the current Rank design.

## 1. Two Sum

```rank
rem LeetCode 1: Two Sum
rem Return indices of two values
rem whose sum equals Target.

fun A two_sum Target
  Index = new index
  for Value i in A
    Need = Target - Value

    if Need in Index
      J = Index Need
      return array J i
    end

    Index Value = i
  end
end
```

This demonstrates:
- `array 2 7 11 15` construction and `A i` addressing;
- explicit value/index binding `for Value i in A`;
- user-defined functions and `return`;
- a named `index` created with `new index`;
- keyed membership and lookup.

## 2. Add Two Numbers

```rank
rem LeetCode 2: Add Two Numbers
rem Add reverse-order digit arrays.

fun A add_two B
  Queue = new queue
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
    Queue push Sum mod 10
    Carry = Sum // 10
    I += 1
  end

  if Carry greater 0
    Queue push Carry
  end

  return Queue
end
```

This uses condition-controlled `for`, ordinary array addressing and one
function-local queue. It does not require padded stacking.

## 3. Longest Substring Without Repeating Characters

```rank
rem LeetCode 3: Longest Substring
rem Find the longest window containing
rem no repeated character.

fun Text longest
  Index = new index
  Start = 0
  Best = 0

  for C i in Text
    if C in Index
      Last = Index C

      if Last at least Start
        Start = Last + 1
      end
    end

    Index C = i
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
Python-style `//`, real `/`, and the binary forms `A min B` and
`A max B`. Array boundaries are handled explicitly, so the algorithm does not
need sentinel infinities even though `use numbers` provides `infinity`.

## 5. Longest Palindromic Substring

The runnable example in `demos/leetcode/005_longestpal.ra` expands around every
possible odd and even center. It uses ordinary conditional `for` loops rather
than adding `break`, and extracts each better result directly:

```rank
Best = Text (L to R)
```

Text slices count Unicode code points. The example runs in quadratic time and
constant auxiliary space apart from the returned text value.

## 9. Palindrome Number

Text version:

```rank
rem LeetCode 9: Palindrome Number
rem Check whether X reads the same
rem forward and backward.

fun X palindrome
  Text = X text
  Back = Text reverse

  return Text equal Back
end
```

Follow-up without text conversion:

```rank
rem Follow up:
rem Do not convert X to text.

fun X palindrome
  if X less 0
    return false
  end

  if X mod 10 equal 0
    if X not equal 0
      return false
    end
  end

  Back = 0

  for X greater Back
    Digit = X mod 10
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
Rate = Groups select
  .rate = .Survived mean
end

Rate print
```

Baseline feature preparation:

```rank
Median = Train .Age median
Train .Age = Train .Age default Median
Test .Age = Test .Age default Median

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
Cabin = Train .Cabin default "U/0/U"
Parts = Cabin split "/"

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
Texts = Train .text default ""
Vocab = Texts vocab 128

Model = Texts Vocab tfidf_fit
X = Texts Model tfidf_transform
Xtest = (Test .text default "") Model tfidf_transform
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
Means = Groups select
    .sales = .sales mean
  end

Forecast = Test Means leftjoin by .store_nbr .family .weekday
```

The [runnable Store Sales baseline](../demos/kaggle/006_storesales.ra)
uses these table operations. An unseen test key falls back to the global
training mean through `default`. `use dates` computes Monday-first weekdays from
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
X = Pixels reshape (Train len) 192
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
Windows = Digits window Width
Products = Windows reduce * axis 1
Answer = Products max
```

Keep lines short enough to read on a narrow screen, aiming for roughly 40
columns. Use fewer parentheses by giving intermediate results short,
meaningful names. Name the value or its role, such as `Range`, `States` or
`DigitCounts`; avoid placeholders such as `Temp` or `Result2`. Split a long
expression into named steps when that makes the computation easier to follow.
Keep parentheses where they are needed to express the intended grouping, but
observe the strict **parenthesis budget of at most one pair of parentheses per
line** to avoid mobile keyboard friction.

```rank
Range' = 1 till 1000
States' = Range scan next with Start
```

Here `Start` is the first state, so the 999 range items produce 1000 states.

### Intentional vs. redundant variables

Intentional intermediate variables give domain identity to algorithmic states
or keep lines within the 40-column and <= 1 parenthesis budget. In contrast,
**redundant procedural aliases** should be avoided:
- Do not create single-use aliases for trivial scalar math (e.g. `Diff = A - B; Jump = Diff abs` -> `Jump = (A - B) abs`).
- Do not create single-use boolean flags immediately consumed by a single `if` (e.g. `Fits = W at most Limit; if Fits` -> `if W at most Limit`).
- Do not use manual counters when vector primitives or container lengths derive the answer directly (e.g. `return A len - I`).

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

Short, unambiguous postfix pipelines (`Fib Mask sum`, `Text reverse print`) are
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

Rank introduces `window` and operator-modifier reductions (`reduce *`, `reduce +`)
to replace nested index-manipulation loops with rank operations:

```rank
Windows = Digits window Width
Products = Windows reduce * axis 1
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

## 6. Boolean sequence masks and explicit selection

A mask always holds positional booleans. Inline predicates, parenthesized
expressions, and named masks have the same meaning. Materialization, iteration,
`count`, `any`, `all`, `min`, and `max` read those flags. Numeric reductions
reject boolean cells with a hint to select values explicitly or count flags.

```rank
Fib = fibonacci to Limit
Answer = Fib filter even sum
Mask = Fib even
Answer = Fib Mask sum
```

### Rationale: One meaning for a mask

Extracting an intermediate variable must preserve the meaning of an expression.
Filtering is explicit through `filter` or mask addressing. The planner can push
selection into the source without materializing intermediate booleans. Ordered
extrema over booleans remain valid: `false` precedes `true`.

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

## 8. Prefer `scan` and `reduce` to accumulator loops

When a loop only transforms values and carries one accumulator, canonical Rank
style expresses the work as a data chain. Select the inputs, transform them,
then use a named reduction when only the final state is needed:

```rank
Even = Values (Values even)
Squares = Even * Even
Total = Squares sum
```

This replaces the imperative chain `test each value -> update Total -> return
Total`. Each named value exposes one stage to the REPL. Prefer `sum`, `count`,
`min`, `max`, `all`, and `any` when their names describe the operation. Use a
symbolic modifier such as `reduce *` when no clearer named reduction exists or
when `rank` selects cells. Use `with Seed` only when an additional initial value
must participate in the reduction.

Use `scan with Seed` when every intermediate accumulator state is part of the
result:

```rank
Running = Values scan + with 0
```

This replaces `start Total at 0 -> append Total -> update Total for each value
-> append each new Total`. The result begins with the seed, so it can be used
directly as a zero-based prefix table.

Use `first where`, `first index where`, `till`, `all`, or `any` when an
ordered search can stop after a condition decides its result. These operations only
read the demanded prefix of a lazy sequence.

Keep a `for` loop when the algorithm carries several changing states, mutates
shared structures, consumes external input, performs effects, or becomes less
clear when split into collection operations. An early `break` or `return` tied
to those behaviors remains ordinary loop control.

---
