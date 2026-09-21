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

Rank requires a clean, visually explicit conditional mechanism tailored for small screens, integrated with the BASIC-like flat workspace model and invariant type system.

## Decision

Rank establishes **statement-based conditionals (`if ... elif ... else ... end`) with flat workspace scoping and exclusion of inline ternary operators**:

```rank
if Score greater Best
  Kind = "record"
elif Score equal Best
  Kind = "tie"
else
  Kind = "lower"
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

### 3. Flat Workspace Scoping (BASIC Heritage)
Following Rank's modern BASIC heritage (ADR-0002):
- Conditional blocks (`if`, `elif`, `else`) **do not create new lexical scopes or stack frames**.
- Variables assigned inside a branch exist in the enclosing function or program workspace.
- This eliminates the need for redundant "pre-declaration" of variables outside the conditional block.

### 4. Branch Type Stability and Union Widening
In accordance with Inferred Type Stability (ADR-0100):
- If all branches assign values of the same type to a variable, that type is preserved:
  ```rank
  if Flag
    Result = 10
  else
    Result = 20
  end
  rem Result is stable 'integer'
  ```
- If branches assign heterogeneous types to the same variable, the variable's inferred type is widened to an explicit union (e.g. `integer or text`):
  ```rank
  if Flag
    Result = 10
  else
    Result = "none"
  end
  rem Result has inferred type 'integer or text'
  ```
- Downstream code safely inspects and narrows the union using type guards (`if Result is .integer`). Subsequent assignments to `Result` must conform to the inferred union.

## Consequences

### Positive
* **Readability on mobile:** Every decision branch receives dedicated, vertically indented lines (2 spaces), perfectly fitting the 40-column screen constraint.
* **No uninitialized variables:** Programmers do not need to pre-declare variables before `if` blocks.
* **Clear separation of concerns:** Keeps scalar control flow (`if/elif/else`) distinct from vectorized tensor selection (`A Mask`).
* **Type safety:** Invariant type stability ensures that branching does not introduce silent dynamic type drift.

### Negative / Trade-offs
* **Slightly more vertical lines:** Simple scalar fallback assignments take 5 lines instead of a 1-line ternary. However, where missing or fallback values are involved, Rank's universal `default` keyword (`X = A i default 0`, ADR-0107) provides concise single-line fallbacks without `if/else`.
