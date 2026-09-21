# 0308. Scope-Bound Deterministic Resource Lifetimes

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Control Flow and Functions Specification, I/O Specification

## Context

Managing operating system resources—such as open file handles, database connections, and network sockets—requires strict lifecycle guarantees to prevent resource leaks, lock contention, and file descriptor exhaustion.

Mainstream programming languages address this through varying paradigms:
1. **Context managers with required indentation (Python `with`):** Nesting `with open(...) as f:` blocks adds extra indentation for every opened resource. On mobile devices with a ~40-column width budget (ADR-0000), nesting two or three resources consumes 4 to 8 characters of indentation, severely squeezing usable horizontal line space.
2. **Explicit deferral statements (Go `defer`):** Requires programmers to remember to write `defer resource.Close()` immediately after acquisition. Forgetting to do so results in silent resource leaks.
3. **Arbitrary block RAII (C++, Rust):** Automatically drops resources at the closing curly brace of any block. However, in Rank, statements like `if` and `for` follow a flat BASIC-like workspace model without block scoping. Tying resource destruction to statement blocks would risk closing resources prematurely (for example, closing a file created inside an `if` branch before the function finishes using it).
4. **Non-deterministic GC finalizers (Java, Python, JS):** Relying on garbage collectors to close file handles leads to unpredictably delayed closures, exhausting file descriptors during rapid batch processing.

Rank needs a deterministic, leak-proof resource management model that requires **zero extra indentation**, works seamlessly with flat workspace scoping, and avoids manual cleanup boilerplate.

## Decision

Rank establishes **Scope-Bound Deterministic Resource Lifetimes with Move-on-Return semantics**:

```rank
fun process Path
  File = Path open
  Header = File 64 readbytes
  rem File is automatically closed when process returns!
  return Header
end
```

### 1. Scope-Bound Ownership
- Every resource value (such as an open file or database handle) is owned by the **execution scope** that created it:
  - A function execution (`fun` or `memo`);
  - A generator sequence execution (`yield`);
  - A test block execution (`test`);
  - Or the top-level program execution.
- Conditional statements (`if / elif / else`) and loop statements (`for`) **do not create separate ownership scopes**. A resource created inside a loop or conditional remains alive throughout the enclosing function or program execution.

### 2. Move-on-Return Semantics
- Returning a resource transfers ownership from the callee to the caller's execution scope:
  ```rank
  fun source Path
    File = Path open
    return File  rem Ownership moves to caller!
  end

  File = "input.dat" source
  rem File remains open and will close when current scope exits.
  ```
- Resources contained inside returned arrays, records, or collections move with that container value.

### 3. Guaranteed Deterministic Cleanup
- When an execution scope terminates—whether through a normal `return`, early exit, or an unhandled runtime error—all resources owned by that scope are **immediately and deterministically closed**.
- Programs never leak open file descriptors, even when functions fail or abort with errors.

### 4. Generator Resource Safety
- Resources opened inside a generator function remain owned by its suspended execution context (ADR-0305).
- If the consumer stops iterating early (e.g. using `take 5` or breaking from a loop), the generator's execution scope terminates and all owned resources are closed immediately.

### 5. Explicit Early Release
- Explicit cleanup operations such as `File close` remain available when an algorithm needs to release a resource before its enclosing scope finishes (e.g. in long-running batch loops).

## Consequences

### Positive
* **Zero indentation overhead:** Opening resources does not introduce nested indentation blocks (`with` / `using`), fully preserving the 40-column line width budget on mobile screens.
* **Leak-proof execution:** Guaranteed deterministic cleanup on normal returns and error propagation without requiring manual `defer` statements.
* **Harmonious with BASIC workspace:** Works naturally with Rank's flat statement scoping without surprising mid-statement resource disposals.
* **First-class composability:** Functions can cleanly construct and return open resources (*move-on-return*) without complex wrappers.

### Negative / Trade-offs
* **Loop accumulation:** Allocating many resources inside a single long-running loop without calling helper functions keeps them alive until the enclosing function terminates. For large batch loops, resources should either be explicitly closed via `File close` or acquired inside an isolated helper function.
