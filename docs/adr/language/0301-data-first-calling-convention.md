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

Rank adopts a pure **data-first, postfix calling convention with arity-based argument resolution**:

### 1. Data Precedes the Function
Arguments appear first, separated by whitespace, followed by the function identifier:
```rank
A B gcd              rem Calls gcd with arguments A and B
Values max sqrt      rem Computes sqrt of the maximum of Values
```
No parentheses are used for call invocation. Parentheses are reserved solely for sub-expression grouping where precedence must be overridden.

### 2. Arity-Based Left Argument Resolution
When resolving a call to a function with arity $N$:
- The final $N - 1$ items directly preceding the function name are bound as arguments $2 \dots N$.
- The entire remaining left expression forms argument $1$.

```rank
Result = T i j Limit above
rem 'above' has arity 2:
rem Argument 1 is the addressed value: T i j
rem Argument 2 is: Limit
```
Only the first argument may absorb a multi-part addressing chain. If multiple arguments require addressing, they must be broken into named intermediate variables.

A field label is the exception that needs no variable: a label naming a field of the record or object directly before it is read first, so the pair counts as one argument. `Z Model .weights matmul` passes `Z` and the `.weights` field, and `R .slots max` reduces that field. Labels that are not fields of the preceding value (options such as `.descending`, or a column label after a table) remain separate arguments.

### Comparisons in a Pipeline
A comparison continues the left-to-right flow like arithmetic does: after a plain left operand it takes the next value, and a following function receives the comparison's result, so `A greater 2 sum` needs no parentheses. When the left operand is already a pipeline (`A len equal B len`, `X date less Y date`), the two sides stay independent, which keeps symmetric comparisons free of parentheses too. `and`, `or` and `xor` always separate independent clauses.

### 3. Disambiguating Addressing from Calls
- If the trailing identifier is a function in scope, preceding values are treated as arguments:
  ```rank
  A B        rem Addressing (select B from A)
  A B gcd    rem Function call (gcd(A, B))
  ```
- The compiler/parser inspects known vocabulary and binding signatures during analysis to segment addressing chains from function applications.

### 4. Function Definition Syntax
Functions declare parameters without parentheses and terminate cleanly with `end`:
```rank
fun gcd A B
  for B greater 0
    T = B
    B = A % B
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
* **First-argument asymmetry:** Only the first argument absorbs leftward addressing (`T i j Limit above`); subsequent arguments cannot be complex multi-part addressing expressions without parentheses or intermediate variables.

## References
* Section "General form" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* Section "Control flow and functions" in [docs/language/control-functions.md](../../language/control-functions.md)
* Commit `92950d0` ("Adopt data-first calls and add Euler 5")
* Commit `d7e4c13` ("Resolve calls using function arity")
