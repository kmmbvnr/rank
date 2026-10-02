# 0100. Inferred Type Stability and Invariant Variable Binding

* **Status:** Accepted
* **Date:** 2026-09-08
* **Updated:** 2026-09-28 — binding ranks and structural contracts
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
Analysis may join possible types from different paths. This does not permit an
existing runtime binding to change type. A loop variable over a finite
heterogeneous collection receives a fixed union of its element types:
```rank
Values = array 1 "two"
for Value in Values
  Value = Value
  rem Value accepts integer or text, but not boolean.
end
```
The loop variable is block-local; it does not remain available after `end`.
Ordinary body bindings retain their established type across iterations.

### Infinite accumulator seeds

A real binding that holds `infinity` or `-infinity` accepts an integer as its
first finite value and then settles on `integer`, so
`Best = infinity; Best = Best Candidate min` stays exact over integers. Like
`.NA` in ADR-0108, the seed is a placeholder, not a type commitment. Once the
binding holds a finite value its type is invariant again.

### Array rank and structural contracts

An array binding also keeps its number of axes. Axis lengths may change; a
vector cannot be reassigned a matrix. The rule applies to parameters and captured
bindings, and a new function invocation gets fresh local binding contracts.
Ordinary array bindings also retain a recursive element contract. Empty and missing-only
arrays defer the element domain; an established union accepts subsets. Infinity-only
numeric seeds settle on the first finite numeric domain while retaining infinity as
a sentinel. Validation of unread lazy cells is deferred. See the
[type-contract comparison](../../language/type-contracts.md) for timing and exceptions.

Record fields have the recursive contracts in
[ADR-0106](0106-record-types.md). Mutable collections establish their element
contracts on first insertion under
[stdlib ADR-0200](../stdlib/0200-reference-collections-and-keyed-indices.md);
`index` is exempt. Function return contracts are per specialization under
[ADR-0302](0302-function-declarations-closures-and-tail-calls.md).

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
* [Binding rank tests](../../../packages/interpreter/test/rank-assignment.test.ts)
* Section "Keeps inferred type" and "Union type tests" in [packages/interpreter/test/expressions.test.ts](../../../packages/interpreter/test/expressions.test.ts)
* ADR-0101: [Value Semantics with Copy-on-Write for Arrays and Tensors](0101-value-semantics-and-copy-on-write.md)
* ADR-0300: [Intentional Intermediate Variables Over Vertical Pipelines](0300-intentional-intermediate-variables.md)
