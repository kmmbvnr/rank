# 0001. First-Class Testing Syntax and Whole-Tensor Assertions (use testing)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Testing Specification, Interpreter Test Runner

## Context

Testing algorithmic, numerical, and tensor-processing software with conventional testing frameworks poses severe friction:
1. **Assertion matcher ceremony:** Frameworks like Jest, PyTest, or JUnit require importing extensive assertion DSLs (`expect(val).toBeCloseTo(expected, 5)`, `assertEquals`, `assert_almost_equal`). On narrow 40-column screens (ADR-0000), these long function calls wrap awkwardly across 3–4 lines.
2. **Boilerplate tensor comparison loops:** In languages without rank-aware equality, comparing two matrices or multidimensional arrays requires nested `for` loops or specialized NumPy assertions (`np.testing.assert_array_equal`).
3. **Complex test runner harnesses:** Conventional frameworks often require specialized configuration files (`pytest.ini`, `jest.config.js`), runner plugins, and complex fixture injection mechanisms.

Rank is designed for competitive programming, algorithmic exploration, and small screens. It requires an integrated, ceremony-free testing mechanism where ordinary expressions serve as assertions and whole tensors can be validated in a single concise line.

## Decision

Rank establishes **First-Class Testing Syntax and Whole-Tensor Assertions via `use testing`**:

```rank
use testing

test "multiples of 3 and 5 below 10"
  use "001_multiples"
  Limit = 10
  run

  Answer equal 23
end
```

### 1. Dedicated Test Files and Runner
- Tests live in separate files ending with the `_test.ra` suffix (e.g. `001_multiples_test.ra`).
- Tests are executed via the standard CLI command:
  ```console
  rank test path/to/tests
  ```
- No external test runner or configuration file is required.

### 2. The `test "description" ... end` Block
- Test blocks are enabled by importing the standard module `use testing`.
- Each `test` block receives a descriptive title and contains ordinary Rank statements indented by two spaces.
- **Isolated workspaces:** Every test block executes in a clean, isolated workspace. Variables defined in one test cannot pollute subsequent tests.

### 3. Standalone Expressions as Assertions
Rank eliminates the `assert` keyword. Any standalone boolean expression statement inside a `test` block is treated as an assertion:
- **Scalar assertions:** The expression must evaluate to boolean `true`:
  ```rank
  Result equal 42
  Count at least 10
  ```
- If an assertion evaluates to `false`, the test runner halts that test, identifies the failing line with file/line/column coordinates, and displays the evaluated left and right operands.

### 4. Whole-Tensor Assertions Without Loops
Because comparisons in Rank have intrinsic rank 0 and broadcast across arrays (ADR-0001, ADR-0200):
- Comparing two arrays or tensors produces an array of booleans.
- A standalone array or tensor of booleans is treated as a **single unified assertion**:
  ```rank
  Matrix equal array shape 2 2
    1 0
    0 1
  end
  ```
- The assertion passes **if and only if every element is `true`** and the shapes match. A mismatch in shape or any single differing element immediately fails the test, reporting the discrepancy coordinates.

### 5. Seamless Program Integration
A test block can exercise program inputs through both in-memory and CLI adapters:
- **Direct workspace injection:**
  ```rank
  test "workspace input"
    use "001_multiples"
    Limit = 10
    run
    Answer equal 23
  end
  ```
- **CLI adapter injection:**
  ```rank
  test "cli argument input"
    use "001_multiples"
    use cli
    args "--limit" "10"
    run
    Answer equal 23
  end
  ```
- **Aliased isolation:**
  ```rank
  test "aliased import"
    use "001_multiples" as E
    E.Limit = 10
    E.run
    E.Answer equal 23
  end
  ```

## Consequences

### Positive
* **Zero assertion noise:** No `assert`, `expect()`, or `assertEquals()` needed; clean relational words (`Answer equal 23`) fit cleanly within the 40-column budget.
* **Vectorized testing:** Entire vectors, matrices, and multi-dimensional tensors are asserted with a single `equal` without loops or helper libraries.
* **Workspace safety:** Clean workspace per test prevents state leakage and flaky test order dependencies.
* **Dual execution testing:** Verifies that algorithms produce identical results whether driven via programmatic workspace variables or CLI arguments.

### Negative / Trade-offs
* **Testing isolation:** Code inside `test` blocks cannot export bindings to the outer file; each test must explicitly import or define the modules and variables it needs.
