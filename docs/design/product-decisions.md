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

Keep lines short enough to read on a narrow screen, aiming for roughly 40
columns. Use fewer parentheses by giving intermediate results short,
meaningful names. Name the value or its role, such as `Range`, `States` or
`DigitCounts`; avoid placeholders such as `Temp` or `Result2`. Split a long
expression into named steps when that makes the computation easier to follow.
Keep parentheses where they are needed to express the intended grouping.

```rank
Range = 1 until 1000
States = Range next scan with Start
```

Here `Start` is the first state, so the 999 range items produce 1000 states.

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

## 6. Boolean sequence masks and explicit selection

Lazy masks retain their source for optimized selection, and every operation
that consumes the mask as data sees boolean values. Prefix `array Mask` and
postfix `Mask array` therefore agree. Numeric operations such as `sum`, `max`
or `mean` cannot use booleans, so they read the source items the mask selects.
Array masks made by a predicate or a comparison with a scalar do the same, so
`A even sum` needs no parentheses either:

```rank
Fib = fibonacci to Limit
Answer = Fib even sum
Mask = Fib even
Answer = Fib Mask sum
```

### Rationale: One meaning for a mask

Materialization and iteration must not silently turn a boolean mask into source
values, so explicit selection (`Fib Mask`) stays the general form; the planner
can push that selection into the source without materializing intermediate
booleans. A numeric reduction of booleans would only fail, so it takes the
selected values instead: the REPL works like a calculator, where `Fib even sum`
gives the sum of the even Fibonacci numbers.

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
symbolic modifier such as `* reduce` when no clearer named reduction exists or
when `rank` selects cells. Use `with Seed` only when an additional initial value
must participate in the reduction.

Use `scan with Seed` when every intermediate accumulator state is part of the
result:

```rank
Running = Values + scan with 0
```

This replaces `start Total at 0 -> append Total -> update Total for each value
-> append each new Total`. The result begins with the seed, so it can be used
directly as a zero-based prefix table.

Use `first where`, `first index where`, `take while`, `all`, or `any` when an
ordered search can stop after a mask decides its result. These operations only
read the demanded prefix of a lazy sequence.

Keep a `for` loop when the algorithm carries several changing states, mutates
shared structures, consumes external input, performs effects, or becomes less
clear when split into collection operations. An early `break` or `return` tied
to those behaviors remains ordinary loop control.
