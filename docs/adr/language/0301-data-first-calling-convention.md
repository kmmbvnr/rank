# 0301. Data-First Calling Convention and Arity Resolution

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing Specification

## Context

Mainstream programming languages rely on prefix function application with mandatory parentheses:
```text
result = sqrt(max(values))
common = gcd(a, b)
```
On narrow 40-column screens and touchscreen mobile keyboards:
1. **Parenthesis nesting friction:** Chained or nested calls `f(g(h(x)))` force reading from the inside out and require frequent keyboard mode shifts to type `(` and `)`.
2. **Mental flow mismatch:** Data analysis naturally flows from input data toward the final result (data -> transform -> reduce), whereas prefix calls put operations first and data last.
3. **Punctuation clutter:** Mandatory parentheses around argument lists add syntactic weight without increasing semantic clarity.

## Decision

Rank uses data-first calls. Unary functions follow their input. Binary functions
have one operand on each side; `choose` places its alternatives after its name.

### 1. Unary and binary calls

```rank
A gcd B              rem Calls gcd with arguments A and B
Values max sqrt      rem Computes sqrt of the maximum of Values
```

Parentheses group an operand or a completed call.

### 2. Addressed operands

Each side of a binary call keeps its selectors:

```rank
Result = T i j above Limits k
rem above receives T i j and Limits k
```

A following known function or a `rank`/`axis` modifier ends the right operand.
Functions with three or more required operands retain their declared sides.
For a function declaring N left operands, the last N - 1 values are separate
arguments and the remaining left chain forms the first argument.

A field read belongs to its operand: `Z matmul Model .weights` passes the
`.weights` field as the right operand; `R .slots max` reduces that field.

### Comparisons in a Pipeline
A comparison continues the left-to-right flow like arithmetic does: after a plain left operand it takes the next value, and a following function receives the comparison's result, so `A greater 2 count` needs no parentheses. When the left operand is already a pipeline (`A len equal B len`, `X date less Y date`), the two sides stay independent, which keeps symmetric comparisons free of parentheses too. `and`, `or` and `xor` always separate independent clauses.

### Binary functions

All binary functions take one operand on the left and one on the right:
`A gcd B`, `A matmul B`, and `A min B`. Unary functions keep `Values sum`.
Functions with more parameters retain the operand sides in their declarations.

```rank
fun Acc step X = Acc + X
Result = 2 step 3
Prefix = Values scan step
Clamped = Low max High min Limit
```

Addressing binds within each operand. A known following operation ends the
right operand: `A min B sum` means `(A min B) sum`. Direct aliases retain
these operand sides. Combining modifiers pass two argument values directly;
they do not require both parameters to be declared before the function name.

Conditional selection has a dedicated data-first form: `Condition choose IfTrue IfFalse`, or `Index choose Choices`. The condition or index is the input on the left; the alternatives follow `choose`. Group compound alternatives with parentheses. The older postfix calls remain valid for existing programs.

### 3. Disambiguating Addressing from Calls
- A unary function follows its input; a binary function separates its operands:
  ```rank
  A B        rem Addressing (select B from A)
  A gcd B    rem Function call (gcd(A, B))
  ```
- The compiler/parser inspects known vocabulary and binding signatures during analysis to segment addressing chains from function applications.

### 4. Function Definition Syntax
Functions declare parameters without parentheses and terminate cleanly with `end`:
```rank
fun A gcd B
  for B greater 0
    T = B
    B = A mod B
    A = T
  end
  return A
end
```

## Consequences

### Positive
* **Natural dataflow order:** Expressions read from left to right in execution order (`Values max sqrt`), eliminating nested parenthesis pyramids.
* **Touchscreen speed:** Functions are invoked using plain words and spaces without switching keyboard layers for `(` and `)`.
* **Clean composition:** Seamlessly chains with Rank's addressing and array transformations.

### Negative & Trade-offs
* **Parser arity dependency:** The parser must know or infer the arity of functions during expression grouping to correctly partition arguments and addressing chains.
* **Higher-arity boundaries:** Functions with three or more required operands may need parentheses or intermediate values to separate addressed arguments.

## References
* Section "General form" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* Section "Control flow and functions" in [docs/language/control-functions.md](../../language/control-functions.md)
* Commit `92950d0` ("Adopt data-first calls and add Euler 5")
* Commit `d7e4c13` ("Resolve calls using function arity")
* Issue #21: remove infix binary `min`/`max` (2026-09-26)
