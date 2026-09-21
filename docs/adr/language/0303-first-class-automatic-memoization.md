# 0303. First-Class Automatic Memoization for Dynamic Programming (memo)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Control Flow and Functions Specification, Memoization Test Suite

## Context

Dynamic programming (DP), combinatorial search, and mathematical puzzles (Project Euler, LeetCode) are most naturally expressed as clean mathematical recurrences:
$$F(N) = F(N - 1) + F(N - 2)$$
However, naive recursion exhibits exponential time complexity ($O(2^N)$), requiring memoization to achieve linear or polynomial performance.

In mainstream languages:
1. **Manual dictionary boilerplate:** In C/JS, developers must declare auxiliary hash maps, write lookup checks, and manually store results (`if (cache.has(n)) return cache.get(n); ... cache.set(n, val)`), quadrupling line counts and exceeding the 40-column budget.
2. **Decorator ceremony:** Python requires importing and annotating functions with `@functools.lru_cache(maxsize=None)`.
3. **Leaked state bugs:** Module-level caches retain data across test executions and competitive problem test cases, causing stale-state bugs unless explicitly cleared with `.clear()`.
4. **Delimited string key collisions:** Ad-hoc tuple-string serializations (e.g. `key = f"{a}|{b}"`) frequently suffer from delimiter collisions.

Rank needs a first-class, ceremony-free mechanism to turn pure recurrences into high-performance dynamic programming algorithms.

## Decision

Rank establishes the **`memo` declaration keyword** directly within the language core:

```rank
memo fib N
  if N less 2
    return N
  end
  return ((N - 1) fib) + ((N - 2) fib)
end
```

### 1. First-Class Syntax Without Library Imports
`memo` replaces `fun` in the function header. It is a native language construct requiring no `use` statements or decorator punctuation.

### 2. Typed Argument Tuple Caching
- The complete, typed argument tuple serves as the composite cache key.
- Distinct types with identical string representations (`0`, `false`, `"0"`, `.Zero`, `0.0`) produce strictly distinct keys without delimiter collisions.
- A cache hit immediately returns the stored result without executing the function body.

### 3. Scoped Function-Instance Cache Lifetime
The memo cache belongs strictly to the function instance:
- **Local memo functions:** When declared inside another function, each call to the outer function creates a fresh, isolated cache:
  ```rank
  fun solve Target
    memo search State
      ...
    end
    return Target search
  end
  ```
- When the outer invocation completes and the local closure is unreferenced, the cache is automatically reclaimed by garbage collection.
- Eliminates manual cache clearing (`cache.clear()`) and prevents state leakage between independent problem test cases.

### 4. Deep Recursion Stack Management
Recursive calls into `memo` functions run on Rank's internal execution stack. This prevents host-engine native stack overflow (e.g. V8 stack exhaustion) during deep recursive descents.

### 5. Deterministic Error and Purity Constraints
- Arguments and results must be scalar values (`integer`, `real`, `boolean`, `text`, `symbol`). Non-scalar collections and files are rejected.
- A `memo` function cannot contain `yield`.
- **Errors are never cached:** If an execution raises an error, subsequent calls with the same arguments will retry the body.

## Consequences

### Positive
* **Mathematical elegance:** Recurrence relations (Fibonacci, coin change, knapsack, edit distance) are written in their pure mathematical definition.
* **40-column clarity:** Eliminates auxiliary hash tables and cache-checking boilerplate.
* **Leak-free scoping:** Inner memo caches are isolated per problem solve and automatically garbage-collected.
* **High performance:** Eliminates exponential recomputation without manual bookkeeping.

### Negative & Trade-offs
* **Memory footprint:** Unbounded caches grow with unique argument combinations throughout the lifetime of the function reference.
* **Purity requirement:** The programmer must ensure that memoized functions are pure; changes to captured mutable state will not invalidate previously cached entries.

## References
* Section "Memoized functions" in [docs/language/control-functions.md](../../language/control-functions.md)
* Test suite [packages/interpreter/test/memo.test.ts](../../packages/interpreter/test/memo.test.ts)
* ADR-0301: [Data-First Calling Convention and Arity Resolution](0301-data-first-calling-convention.md)
* ADR-0302: [Function Declarations, Lexical Closures, and Proper Tail Calls](0302-function-declarations-closures-and-tail-calls.md)
