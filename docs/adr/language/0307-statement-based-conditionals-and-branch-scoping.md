# 0307. Statement-Based Conditionals and Branch Scoping (if, elif, else)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Control Flow and Functions Specification, Lexical Syntax Specification

## Context

Conditional execution is fundamental to algorithmic programming. However, across programming languages, conditional constructs introduce notable ergonomics and scoping challenges:

1. **Horizontal crowding on narrow screens:** Inline ternary expressions (`cond ? expr1 : expr2` in C/Java/JS, `expr1 if cond else expr2` in Python, or `ifelse()` in R) encourage packing multiple expressions into a single line. On mobile touchscreens with a ~40-column width budget (ADR-0000), inline ternaries quickly wrap awkwardly or overflow the visual viewport.
2. **Conflating scalar branching with array filtering:** In data-oriented languages, novice programmers often use elementwise scalar conditional branching (`for i in 1..N: if A[i] > 0: B[i] = 1`) instead of vectorized operations, leading to slow and fragmented code.
3. **Complex block-scoping traps:** Languages with strict block scoping (C++, Rust) discard variables declared inside an `if` block upon exiting the block, forcing programmers to declare uninitialized variables outside (`let mut result; if ... { result = 1; }`). Conversely, languages like JavaScript historically hoisted `var` or introduced tricky temporal dead zones with `let`.

Rank requires a clean, visually explicit conditional mechanism tailored for small screens and integrated with the invariant type system.

## Decision

Rank establishes **statement-based conditionals (`if ... elif ... else ... end`) with block scoping and exclusion of inline ternary operators**:

```rank
Kind = "lower"
if Score greater Best
  Kind = "record"
elif Score equal Best
  Kind = "tie"
end
```

### 1. Block Statements Over Inline Ternaries
- Rank has **no inline ternary operator** (`? :` or `x if c else y` do not exist).
- For scalar decisions, code must use clear, vertically indented `if ... end` blocks.
- For array and tensor transformations, conditional operations must use **First-Class Boolean Masks** (ADR-0203) such as `A Mask = 0` or `Positive = A (A greater 0)` rather than branching statements.

### 2. Sequential Evaluation
- Conditions after `if` and `elif` are evaluated sequentially from top to bottom.
- Only the body of the first condition that evaluates to `true` is executed.
- If no condition is true and an `else` clause is present, the `else` block executes.
- `else` is optional; if omitted and no condition matches, execution proceeds to the statement following `end`.

### 3. Block Scoping
*Revised 2026-09-26 (issue #2). The original decision gave `if` and `for` flat workspace scoping.*

- Every `if`, `elif`, `else`, `for`, `try`, `catch` and `finally` body is a block.
- A name first assigned inside a block — including a `for` binding and a caught error — exists until the block's `end` and is gone after it.
- Assigning a name that already exists outside the block updates that name, so a value meant for later is assigned before the block:
  ```rank
  Kind = "lower"
  if Score greater Best
    Kind = "record"
  end
  Kind print
  ```
- A read of a block's name after its `end`, or of any name before its first assignment, is a syntax diagnostic reported before execution (`rank check`, the editor and every run). Each loop iteration therefore starts without the previous iteration's body names; a value carried between iterations is assigned before the loop.
- Blocks are not stack frames: no new frame is created and nested functions still capture the enclosing function's names.
- **Types hold across iterations.** Inside a loop, a name the body introduces keeps the type of its first binding for every later iteration, even though the name itself ends with its block. A body name that receives an integer on the first iteration cannot receive an array on the second (ADR-0100). When the outermost loop ends, the name and its type are released, and a later statement may bind the same spelling with any type.

Flat scoping let a value from one branch or one iteration leak into code that never assigned it, and made the type of a name depend on which branch ran. Block scoping bounds each name's lifetime lexically, which keeps static analysis exact and makes the loop contract explicit.

### 4. Branch Type Stability
In accordance with Inferred Type Stability (ADR-0100), a name keeps the type of its first binding. A name declared before the block fixes the type every branch must assign:
```rank
Result = 0
if Flag
  Result = 10
else
  Result = 20
end
rem Result is stable 'integer'
```
A branch that assigns another type (`Result = "none"`) is an error. A name used only inside one branch may take any type there, because it ends with that branch.

## Consequences

### Positive
* **Readability on mobile:** Every decision branch receives dedicated, vertically indented lines (2 spaces), perfectly fitting the 40-column screen constraint.
* **Bounded lifetimes:** A name assigned in a branch or a loop body cannot be read where it was never assigned, and the check happens before execution.
* **Clear separation of concerns:** Keeps scalar control flow (`if/elif/else`) distinct from vectorized tensor selection (`A Mask`).
* **Type safety:** Invariant type stability ensures that branching does not introduce silent dynamic type drift.

### Negative / Trade-offs
* **Declarations before blocks:** A value produced inside a branch or loop and used after it needs one assignment before the block.
* **Slightly more vertical lines:** Simple scalar fallback assignments take 5 lines instead of a 1-line ternary. However, where missing or fallback values are involved, Rank's universal `default` keyword (`X = A i default 0`, ADR-0107) provides concise single-line fallbacks without `if/else`.
