# 0302. Function Declarations, Lexical Closures, and Proper Tail Calls

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Control Flow and Functions Specification, Tail Calls Test Suite

## Context

Function models in mainstream dynamic languages present three significant drawbacks:
1. **Parenthesis syntax friction:** Mandatory parentheses around parameter lists (`def gcd(a, b):`, `function gcd(a, b)`) require keyboard layer shifts on mobile touchscreens.
2. **Order-dependent declaration:** In languages like Python, functions must be defined before they are called. This forces utility and helper functions to the top of a script, obscuring the primary algorithm and forcing the reader to scroll past implementation details to find the main program logic.
3. **Stack overflow traps in recursion:** Standard JavaScript (V8) and Python lack guaranteed Proper Tail Calls (TCO). In Python, recursion is capped at 1,000 frames; in JavaScript, deep recursion crashes with `RangeError: Maximum call stack size exceeded`. This makes idiomatic functional algorithms, mutual recursion, and state-machine transitions hazardous without rewriting them into imperative loops.

Rank needs a clean, ceremony-free function model that enables top-down readability and guarantees stack-safe recursion.

## Decision

Rank establishes **parenthesis-free function declarations, file-level declaration hoisting, lexical closures, and guaranteed Proper Tail Calls (TCO)**:

### 1. Punctuation-Free Function Declarations
Functions declare parameters separated by whitespace and terminate with `end`:
```rank
fun gcd A B
  for B not equal 0
    R = A % B
    A = B
    B = R
  end
  return A
end
```
No parentheses or commas are used for parameter lists.

### 2. File-Level Declaration Hoisting
All top-level functions in a source file are parsed and registered before top-level executable statements begin:
```rank
Answer = 41 next

fun next X
  return X + 1
end
```
- A function can be called before its textual appearance in the file.
- Developers can place the main algorithm or contest entry point at the very top of the script, placing supporting helper routines cleanly at the bottom.
- When a file is imported via `use`, its functions are registered without executing its top-level statements.

### 3. Lexical Closures and Nested Functions
Functions can declare nested local functions. Local functions capture their enclosing lexical workspace by reference:
```rank
fun make Base
  return add

  fun add Value
    return Base + Value
  end
end
```
- Returned closures keep their captured workspace alive.
- Variable lookup traverses lexical scopes from inner to outer, finally reaching module scope.

### 4. Guaranteed Proper Tail Calls (TCO)
Rank **guarantees frame replacement for calls in tail position**:
```rank
fun count N Total
  if N equal 0
    return Total
  end
  return (N - 1) (Total + 1) count
end
```
- Tail calls execute in $O(1)$ stack space.
- The interpreter and compiler replace the current call frame rather than allocating a new stack frame.
- **Mutual recursion** is fully supported:
  ```rank
  fun even N
    if N equal 0
      return true
    end
    return (N - 1) odd
  end

  fun odd N
    if N equal 0
      return false
    end
    return (N - 1) even
  end
  ```
- Verified by tests running over 1,000,000 recursive tail calls within a single-frame stack allocation budget without relying on the host language's call stack.

### 5. First-Class Function Identity
Functions are first-class immutable values. They can be stored in arrays, passed as arguments, returned from functions, and compared by reference identity using `equal`:
```rank
F = abs
F equal abs      rem true
abs equal sqrt   rem false
```

## Consequences

### Positive
* **Top-down presentation:** Scripts read naturally from high-level algorithm down to low-level helpers.
* **Touchscreen friendly:** Zero parentheses or commas in function headers.
* **Stack-safe recursion:** Tail-recursive algorithms (accumulators, state machines, tree traversals) can run indefinitely without fear of call stack exhaustion.
* **First-class composability:** Closures and functions integrate smoothly with Rank's data-first calling conventions.

### Negative & Trade-offs
* **TCO strictness:** Only expressions in strict tail position receive frame replacement; expressions that perform subsequent math (e.g. `1 + (N - 1) fib`) require explicit accumulator refactoring or `memo`.

## References
* Section "Functions", "Local functions and closures", and "Function equality" in [docs/language/control-functions.md](../../language/control-functions.md)
* Test suite [packages/interpreter/test/tail-calls.test.ts](../../packages/interpreter/test/tail-calls.test.ts)
* ADR-0301: [Data-First Calling Convention and Arity Resolution](0301-data-first-calling-convention.md)
* ADR-0303: [First-Class Automatic Memoization for Dynamic Programming](0303-first-class-automatic-memoization.md)
