# 0305. Generator Functions and Single-Pass Lazy Sequences (yield)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Control Flow and Functions Specification, Sequences and Arrays Specification

## Context

Streaming large datasets, generating mathematical sequences (Collatz sequences, prime streams, digit expansions), and processing files line-by-line require lazy evaluation so data can be generated on demand without allocating massive intermediate arrays.

In mainstream dynamic languages:
1. **Iterator boilerplate:** Implementing custom sequence iterators requires writing complex class objects with state flags and `next()` / `hasNext()` boilerplate that crowds the 40-column mobile screen budget.
2. **Silent exhaustion bugs:** In Python, once a generator is consumed, iterating over it a second time silently yields zero items (`for x in gen:` does nothing). This silent failure masks critical logic errors in multi-stage data pipelines.
3. **Leaked file descriptors:** Generators that open file handles or system resources often fail to close them if the consumer stops reading early (e.g. taking only the first 5 lines), relying on unpredictable garbage collector finalizers.

Rank needs an ergonomic generator mechanism that produces lazy sequences, manages resource lifetimes deterministically, and prevents silent reuse of exhausted streams.

## Decision

Rank establishes **generator functions and single-pass lazy sequences via the `yield` keyword**:

```rank
fun weird N
  yield N
  for N not equal 1
    if N even
      N //= 2
    else
      N = 3 * N + 1
    end
    yield N
  end
end
```

### 1. Implicit Generator Construction
Any function containing the `yield` keyword returns a lazy sequence. Calling the function (`Stream = 7 weird`) initializes the sequence plan immediately without executing the body; computation begins only when a consumer demands the first element.

### 2. Suspension and Buffer Safety
- `yield Value` emits exactly one sequence item and suspends the generator.
- Local variables and execution state are preserved between yields.
- A bare `return` terminates the generator early.
- **Buffer reuse safety:** Because Rank enforces value semantics (ADR-0101), a generator can safely reuse a scratch buffer between yields without corrupting previously emitted values.

### 3. Explicit Single-Pass Semantics (`.ConsumedSequence`)
User generators represent single-pass, potentially stateful or effectful streams (which may read files, consume inputs, or rely on transient state):
- Once a generator sequence has been traversed, **it cannot be replayed**.
- Attempting a second consumption of an already-traversed generator raises an immediate `.ConsumedSequence` runtime error.
- To replay the stream, the generator function must be called again, or the sequence must be explicitly materialized into an array via `copy` or `array`.

### 4. Deterministic Scoped Resource Cleanup
Resources opened by a generator (such as file handles or database cursors) remain owned by its suspended execution context:
- When the generator finishes execution, raises an error, or is abandoned by its consumer (for example, when `take` stops reading early), all owned resources are **closed immediately and deterministically**.
- Programs never leak open file descriptors when interrupting generator iteration.

### 5. Seamless Array Materialization
Generators compose cleanly with Rank's tensor model:
- `Values = 7 weird array` eagerly consumes the generator and stacks yielded items into a dense, contiguous array.
- Multi-dimensional items of matching shape are automatically stacked along a new leading axis.

## Consequences

### Positive
* **Memory-efficient streaming:** Infinite or massive sequences are processed element-by-element with $O(1)$ memory consumption.
* **Immunity to exhaustion bugs:** `.ConsumedSequence` prevents the insidious bugs of silently iterating over dead generators.
* **Deterministic resource safety:** Files and handles close promptly even on partial iteration without requiring manual `try/finally` blocks in caller code.
* **Readable 40-column syntax:** Sequences are expressed as straightforward imperative functions.

### Negative & Trade-offs
* **Non-restartable by default:** Multi-pass algorithms must explicitly store items in an array (`Source copy` or `Source array`) if they need to traverse the sequence multiple times.

## References
* Section "Generator functions" and "Scoped resources" in [docs/language/control-functions.md](../../language/control-functions.md)
* Section "Explicit materialization" in [docs/language/sequences-arrays.md](../../language/sequences-arrays.md)
* ADR-0101: [Value Semantics with Copy-on-Write for Arrays and Tensors](0101-value-semantics-and-copy-on-write.md)
* ADR-0304: [Unification of All Loops Under for](0304-unify-loops-under-for.md)
