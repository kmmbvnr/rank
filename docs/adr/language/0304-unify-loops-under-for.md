# 0304. Unification of All Loops Under for

* **Status:** Accepted
* **Date:** 2026-09-08 / 2026-09-09
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Commit 1f5209b

## Context

Most programming languages provide multiple disjoint iterative control flow constructs:
- **Classical BASIC:** `FOR ... NEXT`, `WHILE ... WEND`, `DO ... LOOP`, `DO WHILE ... LOOP`.
- **C/JavaScript/Python:** `for (;;) `, `while ()`, `do ... while ()`, `for ... in`, `for ... of`.

This keyword proliferation creates unnecessary syntactic complexity:
1. **Header crowding:** C-style three-clause headers (`for (let i = 0; i < N; i++)`) crowd the 40-column line budget with semicolons, parentheses, and loop variable initializers.
2. **Vocabulary bloat:** Separate keywords (`while`, `do`, `loop`, `until`, `repeat`) increase the language's cognitive surface area without providing any computational power that cannot be expressed with a single loop concept.
3. **Index tracking ceremony:** When iterating over collections, developers frequently need both the item and its index, which in other languages requires awkward `enumerate()` calls or auxiliary index counters.

## Decision

Rank unifies **all looping and iterative control flow under a single statement: `for ... end`**:

### 1. Numeric Range Iteration
Replaces traditional indexed loops using first-class range sequences:
```rank
for i in 1 to 10
  i print
end
```

### 2. Collection Iteration with Optional Index Binding
Iterates over any sequence or collection. Supplying an optional second name binds the zero-based index without requiring auxiliary functions:
```rank
for Value in List
  Value print
end

for Value i in List
  Value print
  i print
end
```

### 3. Conditional Iteration (replaces `while`)
When `for` is followed directly by an expression, it evaluates the condition before each iteration:
```rank
for Total less Limit
  Total += 1
end
```

### 4. Unconditional Infinite Loop
A bare `for` creates an indefinite loop, terminated via `break` or `return`:
```rank
for
  Count += 1
  if Count equal 10
    break
  end
end
```

### 5. Multi-Coordinate Tensor Iteration
`for` binds coordinate indices along specified frame axes:
```rank
for Line i j in Matrix axis 0 1 rank 1
  Line print
end
```

### 6. Discarded Loop Bindings with `#`
When a loop counter is unneeded, `#` serves as a placeholder:
```rank
for # in 1 to Repetitions
  Step do_work
end
```

### 7. Explicit Nested Blocks Over Multi-Variable Comprehensions
Rank explicitly **rejects multi-generator loop declarations** (e.g. `for a in 1 to N, b in a to N`) and list comprehensions:
- **The 40-column budget:** Packing multiple generators and bounds into a single header crowds the line width and violates mobile display constraints.
- **Visual scoping:** Multidimensional iteration requires explicit nested blocks:
  ```rank
  for a in 1 to Last
    for b in 1 to Last
      ...
    end
  end
  ```
  This makes iteration order, nesting depth, and variable lifetimes obvious at a glance.

### 8. Single-Level `break` Without Labeled Jumps
The `break` statement terminates only the nearest enclosing `for` loop. Multi-level labeled breaks (such as `break 'outer`) or non-local jumps are deliberately rejected to keep control flow pragmatic and true to BASIC. Deep exits are handled via condition checks, flags, or returning directly from dedicated functions (`fun ... return ... end`).

## Consequences

### Positive
* **Minimalist keyword vocabulary:** Completely eliminates `while`, `do`, `loop`, `repeat`, and `wend` from the language grammar.
* **40-column clarity:** Loop headers are brief, conversational, and fit comfortably on narrow screens.
* **Ergonomic dual binding:** `for Value i in List` eliminates `enumerate()` boilerplate while maintaining clean whitespace separation.
* **Uniform block closure:** Every loop cleanly terminates with `end`.

### Negative & Trade-offs
* **Departure from conventional `while`:** Programmers accustomed to `while condition` must learn that `for condition` is Rank's idiom.
* **Parser header resolution:** The parser must disambiguate between `for Variable in Sequence`, `for Condition`, and bare `for`.

## References
* Sections 3 & 4 in [docs/design/product-decisions.md](../design/product-decisions.md)
* Section "Control flow and functions" in [docs/language/control-functions.md](../../language/control-functions.md)
* Commit `1f5209b` ("Unify loops under for")
* Commit `975620d` ("Add break control flow")
* Commit `3513817` ("Use conditional loop for palindrome bounds")
