# 0100. Inferred Type Stability and Invariant Variable Binding

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Interpreter Type System Tests

## Context

Mainstream dynamic languages (Python, JavaScript, Ruby) allow variables to change types at arbitrary points during program execution:
```python
# In Python / JS:
val = 1       # Integer
val = "hello" # Silently changes to string
```
This dynamic type mutability creates major problems:
1. **Silent type drift bugs:** A subtle logic flaw or unintended variable name reuse can silently change a number into a float, string, or boolean, propagating corrupted types until an exception occurs far downstream.
2. **JIT compilation penalties:** In engines like V8 or PyPy, dynamic type changes invalidate polymorphic inline caches (PICs), causing expensive deoptimizations and bailing out of optimized native execution.
3. **Mobile keyboard friction:** Traditional statically typed languages (TypeScript, Rust, Go) enforce safety through explicit type annotations (`let count: number = 0`). On mobile touchscreen keyboards, typing colons, angle brackets, and verbose type names creates extreme friction and destroys writing flow on narrow screens (~40 columns).

Rank requires an ergonomic balance: zero typing overhead on mobile keyboards, but absolute type stability and compiler predictability.

## Decision

Rank establishes **Inferred Type Stability with Invariant Variable Binding**:

### 1. No Declaration Keywords
Rank has no variable declaration keywords (`let`, `var`, `val`, `const`, or `mut` do not exist). A variable is declared simply upon its first assignment:
```rank
Count = 0
Name = "Alice"
```

### 2. Inferred Invariant Types
When a variable is first assigned, the compiler/interpreter infers its type. Once bound, **a variable cannot change its type**. Subsequent assignments must match the inferred type:
```rank
Value = 1
Value = 2        rem OK: Value remains integer
Value = 2.0      rem ERROR: Value has type integer and cannot receive real
Value /= 2       rem ERROR: Value has type integer and cannot receive real
```
Even augmented assignment operators must preserve type invariants: because `/=` computes real division, it cannot be applied to a variable whose inferred type is `integer`.

### 3. Loop and Branch Union Types
When a variable is assigned values of different types across conditional branches or loop iterations, its inferred type is widened to an explicit union:
```rank
Values = array 1 "two"
for Value in Values
  Value = Value
end
rem Value now has inferred type 'integer or text'

Value = true     rem ERROR: Value has type integer or text and cannot receive boolean
```
The variable remains sealed to types outside that explicit union.

### 4. First-Class Runtime Type Inspection (`type`)
The postfix operator `type` reflects the runtime type of any value as a lightweight symbol:
```rank
42 type          rem Evaluates to .integer
3.14 type        rem Evaluates to .real
"Rank" type      rem Evaluates to .text
.Age type        rem Evaluates to .symbol
true type        rem Evaluates to .boolean
(array 1 2) type rem Evaluates to .array
```

### 5. Short Boolean Type Guard (`is`)
Rank provides the `is` keyword for clean type testing and narrowing:
```rank
if Value is .integer
  Total += Value
end
```
- The right-hand side of `is` **must be a known type symbol** (e.g. `.integer`, `.real`, `.text`, `.symbol`, `.boolean`, `.array`, `.record`, `.object`).
- Supplying a text string (`42 is "integer"`) or an unknown symbol (`42 is .number`) is rejected with a clear compile/runtime error.

## Consequences

### Positive
* **Zero mobile friction:** Programmers never type verbose type annotations (`: integer`, `<T>`); assignment is as terse as Python or BASIC.
* **Immunity to type drift:** Accidental reassignments and type collisions are caught immediately at the point of assignment.
* **AOT and JIT compilation:** Compilers can generate unboxed native machine code (BigInt, 64-bit float, contiguous arrays) without fear of hidden deoptimizations.
* **Expressive type narrowing:** `Value is .symbol` provides safe, idiomatic branch dispatch for polymorphic code.

### Negative & Trade-offs
* **No scratch variable reuse:** A variable name cannot be recycled for a different type (e.g. `Raw = "123"` cannot be followed by `Raw = Raw integer`). Programmers must name intentional intermediate variables (`Text = "123"`, `Num = Text integer`), which aligns with ADR-0300.

## References
* Section "Type guards and inspection" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* Section "Keeps inferred type" and "Union type tests" in [packages/interpreter/test/expressions.test.ts](../../packages/interpreter/test/expressions.test.ts)
* ADR-0101: [Value Semantics with Copy-on-Write for Arrays and Tensors](0101-value-semantics-and-copy-on-write.md)
* ADR-0300: [Intentional Intermediate Variables Over Vertical Pipelines](0300-intentional-intermediate-variables.md)
