# 0306. Structured Error Handling with Symbol Kinds (try, catch, finally, raise)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Control Flow and Functions Specification, Diagnostics Test Suite

## Context

While Rank's universal `default` keyword (ADR-0107) handles missing data and absent values without exceptions, programs still encounter genuine runtime failures:
- Malformed inputs (`"abc" integer`);
- System I/O failures (file not found);
- Domain and dimension violations (non-invertible singular matrices, shape mismatches);
- Explicit domain rule violations.

In conventional object-oriented languages:
1. **Class hierarchy ceremony:** Defining custom errors requires creating class hierarchies (`class InvalidAgeError extends ValueError:`), adding multi-line boilerplate that crowds narrow 40-column screens.
2. **Control-flow swallowing in `finally`:** In JavaScript and Python, placing a `return` or `break` statement inside a `finally` block silently discards pending unhandled exceptions, creating notorious debugging nightmares.
3. **Screen-flooding stack traces:** Unhandled errors often dump massive host runtime stack traces (multiple screens of internal V8 or Python runtime frames) that obscure the actual source error on a mobile terminal.

Rank needs a lightweight, ceremony-free error handling system that uses symbols as error kinds and enforces strict control-flow safety.

## Decision

Rank establishes **structured error handling using Symbol error kinds and data-first raising**:

### 1. Data-First `raise` Operation
`raise` is a built-in core operation requiring no `use` statements. The error kind and optional payload precede the operation:
```rank
.InvalidAge raise
.InvalidAge Age raise
.InvalidInput "age is required" raise
```
- **Zero exception class boilerplate:** Error kinds are ordinary lightweight Symbol scalars (ADR-0105) such as `.InvalidInput`, `.MissingFile`, `.DimensionMismatch`, or `.DomainError`.
- No class declarations, inheritance, or constructor calls are needed.

### 2. Structured `try / catch / finally / end` Blocks
```rank
try
  Value = Text integer
catch .InvalidNumber Error
  Value = 0
catch Error
  Error raise
finally
  Resource close
end
```
- **Typed catch clauses:** A catch clause specifying a symbol (`catch .InvalidNumber Error`) matches only errors with that exact kind.
- **Catch-all clause:** An untyped clause (`catch Error`) matches any runtime error.
- Catch clauses are evaluated sequentially from top to bottom.

### 3. First-Class `error` Values
Caught errors are first-class values addressed using symbol fields:
- `Error .Kind` — the error symbol (e.g. `.InvalidNumber`);
- `Error .Message` — human-readable explanation;
- `Error .Value` — optional attached payload value;
- `Error .Cause` — optional chained predecessor error;
- `Error .Trace` — clean source diagnostic string.

### 4. Strict `finally` Discipline
The `finally` block runs unconditionally when leaving the `try` construct (upon normal completion, return, or propagating error):
- **Forbidding control-flow overrides:** Statements that divert control flow (`return`, `break`, `continue`) are **syntactically forbidden inside `finally`**.
- This completely eliminates the bug where a `finally` block silently swallows a pending exception.
- If an expression inside `finally` raises an error while another error is already pending, the new error propagates with the original error preserved in `.Cause`.

### 5. Clean Mobile Diagnostics
When an unhandled error reaches the top level, Rank prints a clean, caret-pointed diagnostic to stderr without leaking internal JavaScript or host engine stack frames:
```text
RankError [Runtime]: unknown name: abs; did you forget `use numbers`?
  at solution.ra:2:1
2 | -5 abs
    ^
```

## Consequences

### Positive
* **Zero exception class ceremony:** Defining and catching errors uses lightweight `.symbols` directly without boilerplate.
* **40-column friendly:** Error handling and raising fit on short, readable lines.
* **Guaranteed error safety:** `finally` cannot secretly mask or discard pending exceptions.
* **Readable mobile diagnostics:** Programmers see exactly the failing line, column, and caret without scrolling through dozens of host engine frames.

### Negative & Trade-offs
* **Exact symbol matching:** Error kinds match on exact symbol identity rather than hierarchical subtyping (`instanceof`). Grouped error handling requires explicit catch clauses or checking `Error .Kind` inside a catch-all block.

## References
* Section "Errors and exceptions" in [docs/language/control-functions.md](../../language/control-functions.md)
* Test suite [packages/interpreter/test/runtime-diagnostics.test.ts](../../packages/interpreter/test/runtime-diagnostics.test.ts)
* ADR-0105: [Symbol Scalars for Labels, Enums, Fields, and Type Tags](0105-symbol-scalars-for-labels-and-enums.md)
* ADR-0107: [Universal Missing-Value Fallback via default Keyword](0107-universal-missing-value-fallback-default.md)
* ADR-0301: [Data-First Calling Convention and Arity Resolution](0301-data-first-calling-convention.md)
