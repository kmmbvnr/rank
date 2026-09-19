# Abstract interpretation and symbolic shape inference

This document records the architectural plan for a non-executing, validating
interpreter for Rank. It uses abstract interpretation and symbolic shape
inference to catch tensor dimension mismatches, invalid axis operations, and
type errors at edit time before code is run.

---

## 1. Problem statement: The mismatched shapes dilemma

In array and tensor languages (APL, NumPy, JAX, PyTorch), the vast majority of
logic errors stem from mismatched tensor shapes:
- Reducing along an axis that does not exist (`* reduce rank 2` on a 1D vector).
- Aligning incompatible operands in elementwise operations or broadcasting.
- Applying a multi-axis selector (`# # #`) to a lower-rank matrix.
- Passing a multi-dimensional array into a function that assumes a scalar.

In Rank, where code is authored without explicit type annotations and runs
primarily on mobile touchscreens and narrow 40-column terminals, runtime panics
with long stack traces create severe ergonomic friction. Debugging an
index-out-of-bounds error on a phone keyboard breaks flow.

Rank needs compile-time diagnostic feedback without sacrificing its clean,
uncluttered BASIC-inspired syntax:

```rank
rem The user types this:
Digits = 10 to 99
Windows = Digits 5 window
Total = Windows * reduce rank 3   <-- Editor immediately flags: rank 3 invalid (Windows has rank 2)
```

---

## 2. Why Rank is uniquely positioned for abstract interpretation

Conventional languages (like Python with NumPy) struggle with static shape
inference because of mutable arrays, pointer aliasing, and dynamic dispatch.
Rank possesses four structural properties that make static shape analysis
tractable and exact:

1. **Value semantics without aliasing:** Arrays in Rank are values with
   copy-on-write semantics. There are no shared mutable pointers or hidden
   mutations across scopes. The dataflow graph is a pure Directed Acyclic
   Graph (DAG).
2. **The 40-column budget enforces named intermediate steps:** Idiomatic Rank
   discourages long, opaque point-free pipelines in favor of naming intermediate
   states (`Digits`, `Windows`, `Products`). Each line defines an explicit node
   in the program's static single-assignment (SSA) dependency graph.
3. **Literal ranks and axes:** In Rank, modifiers like `rank 0`, `rank 1`,
   `axis 1`, and the `#` whole-axis selector are almost exclusively syntactic
   literals rather than computed runtime values.
4. **Langium and LSP integration:** Rank's language infrastructure is built on
   Langium. Diagnostics can be emitted directly through `ValidationAcceptor` in
   [`RankValidator`](../packages/language/src/rank-validator.ts) to highlight
   errors inline in the editor as code is typed.
5. **Line-level error localization (no pipeline obscurity):**
   In languages relying on long vertical or point-free pipelines
   (`data.filter(...).map(...).reduce(...).window(...)`), compiler and runtime
   errors are notoriously difficult to localize. The failure often blames a
   200-character line or a nested lambda deep within a monolithic chain where
   intermediate shapes are completely invisible.

   In Rank, because lines are strictly budgeted to ~40 characters and
   intermediate variables are explicitly named (`Digits`, `Windows`,
   `Products`), **every line corresponds to exactly one transformation step**.
   When an error occurs, the validator does not report a vague failure in the
   middle of a pipeline; it reports the failure directly on the specific line,
   referencing the named input operand, its known shape, and the contradictory
   operation. On small mobile screens, this produces compact, non-wrapping
   diagnostics that immediately explain what went wrong.

---

## 3. Theoretical framework: Abstract domain

Instead of executing operations over concrete numbers or heap buffers, the
validating interpreter evaluates expressions over an **abstract domain**.

### Distinguishing Rank from Shape

A critical insight in array language analysis is separating **Rank** (number of
dimensions / axes) from **Shape** (the concrete lengths of each axis):

- **Rank ($R \in \mathbb{N}_0$):** Fully decidable statically for almost all
  operations.
  - Scalar: $R = 0$
  - Sequence / Vector: $R = 1$
  - Matrix / 2D Table: $R = 2$
  - $N$-dimensional Tensor: $R = N$
- **Shape ($S = [d_1, d_2, \dots, d_R]$):** Can be concrete, symbolic, or
  bounded:
  - *Concrete:* `[90]`, `[10, 10]`
  - *Affine Symbolic:* `[N]`, `[N - K + 1, K]`
  - *Dynamic / Masked:* `[?]` or `[\le N]` (e.g. after a boolean `filter`).

Even when the exact axis length is dynamic (such as after filtering even
numbers), the **Rank remains statically known**. Over 70% of tensor misuse
bugs (wrong reduction rank, axis out of bounds, wrong selector count) only
require knowing the Rank.

### Value representation

```typescript
export type Dimension = 
    | { kind: 'exact'; value: number }
    | { kind: 'symbolic'; name: string; offset: number }
    | { kind: 'dynamic'; max?: number };

export interface AbstractTensor {
    readonly kind: 'tensor';
    readonly elemType: 'integer' | 'real' | 'boolean' | 'text' | 'unknown';
    readonly rank: number;
    readonly shape?: readonly Dimension[];
}

export interface AbstractScalar {
    readonly kind: 'scalar';
    readonly elemType: 'integer' | 'real' | 'boolean' | 'text';
    readonly literalValue?: number | string | boolean;
}

export interface AbstractTable {
    readonly kind: 'table';
    readonly columns: ReadonlyMap<string, AbstractScalar | AbstractTensor>;
}

export type AbstractValue = AbstractScalar | AbstractTensor | AbstractTable | 'unknown';
```

---

## 4. Transfer functions for core operations

The abstract interpreter defines transfer rules for each Rank primitive:

### 1. Elementwise operations (`+`, `-`, `*`, `equal`, `and`)
- If both operands are scalars ($R=0$): result is scalar ($R=0$).
- If one operand is tensor ($R > 0$) and one is scalar ($R=0$): result inherits
  the tensor's rank and shape.
- If both operands are tensors:
  - Must have equal rank: $R_1 == R_2$ (or satisfy broadcasting rules).
  - Concrete shapes must match: if $d_{1, i} \neq d_{2, i}$, report an error:
    `"Shape mismatch in binary operation: [10, 20] vs [10, 30]"`.

### 2. Windowing (`A K window`)
- Lifts a rank-$R$ array to rank $R+1$.
- If `A` has 1D shape `[N]` and `K` is known statically:
  - Result rank is $2$.
  - Result shape is `[N - K + 1, K]`.
  - Static check: verifies $K \le N$ when both are known.

### 3. Outer product (`A B * outer`)
- Combines the shapes of two inputs:
  - Result rank: $R_{result} = R_A + R_B$.
  - Result shape: `[...shape(A), ...shape(B)]`.

### 4. Reductions (`sum`, `max`, `* reduce rank K`)
- Unqualified `sum` / `max` / `min`: collapses all dimensions to scalar ($R=0$).
- `reduce rank K`:
  - Static guard: verifies $0 \le K < R_{input}$.
  - Collapses cell rank $K$, reducing the overall tensor rank by 1.

### 5. Whole-axis selection and indexing (`#`)
- Syntax `Matrix # j`:
  - Counts the number of positional selectors.
  - Static guard: the number of selectors must not exceed $R_{input}$.
  - Result rank is $R_{input} - (\text{number of scalar slice selectors})$.

### 6. Boolean selection (`A Mask`)
- Validates that `Mask` has boolean element type.
- Validates that `Mask` has rank equal to `A`'s leading axis (or identical
  shape).
- Result rank matches `A`; the filtered dimension becomes dynamic `[?]`
  bounded by the source axis length.

---

## 5. Variable reassignment: Flow-sensitive typing vs. loop invariants

Rank's runtime enforces that a variable cannot change its primitive element
type (`packages/interpreter/src/interpreter.ts:3754`):
```rank
A = 1
A = "text"   <-- Throws: 'A has type integer and cannot receive text'
```

A crucial design question is: **does introducing shape typing mean a
variable's shape must also be globally invariant across assignments?**

### Empirical evidence: Why global shape freezing is rejected

An analysis of the repository's `demos/` directory shows **524 files** and
**1,265 variables** with reassignments. In canonical Rank programs, variables
routinely change their rank, length, or table schema across execution steps:

1. **Rank transition (1D vector to 2D matrix):**
   In [`demos/cses/tree/012_pathqueries2.ra`](../../demos/cses/tree/012_pathqueries2.ra):
   ```rank
   18: Queries = stdin .integer (Q * 3) array   # 1D vector (rank 1)
   19: Queries = Queries (array Q 3) reshape    # 2D matrix [Q, 3] (rank 2)
   ```
2. **Length changes via filtering:**
   In [`demos/euler/002_evenfib.ra`](../../demos/euler/002_evenfib.ra) and
   `demos/pgexercises/`:
   ```rank
   R = Db .bookings
   R = R filter ...   # Filtered subset; row count dynamically changes
   ```
3. **Table column schema evolution:**
   ```rank
   R = B F innerjoin by .facid
   R = R select .facid .slots   # Column schema narrows to two fields
   ```

Freezing variable shapes globally would break more than half the existing
demos and force artificial variable names (`RawQueries`, `MatrixQueries`,
`FilteredR`), violating the 40-column budget and idiomatic Rank style.

### The rule: Flow-sensitive typing in sequential code

In sequential code, the validator tracks shapes using **flow-sensitive
typing** (analogous to SSA versions $V_1 \to V_2$):
- Each assignment `V = expr` updates the known shape of `V` for subsequent
  lines.
- At line 18, `Queries` has shape `[Q * 3]` (rank 1).
- At line 19, after `reshape`, `Queries` is tracked as shape `[Q, 3]` (rank 2).
- Subsequent lines validate against the rank-2 matrix.
- The primitive element type (`elemType: integer`) remains invariant, adhering
  to existing runtime rules.

### The strict exception: Loop-carried shape invariants

The single place where changing shape is **strictly prohibited** is inside a
loop body for variables carried across iterations (`loopCarried: true` in
[`analysis/bindings.ts`](../packages/language/src/analysis/bindings.ts)):

```rank
rem FORBIDDEN: Growing an array inside a loop
Arr = 1 to 5 array
for i in 1 to N
  Arr = Arr (array i) join   <-- ERROR: Loop-carried 'Arr' cannot change shape across iterations
end
```

**Rationale:**
- **Algorithmic efficiency:** Repeated array concatenation or resizing inside a
  loop introduces hidden $O(N^2)$ memory reallocation and garbage collection
  churn, violating Rank's core design for "big algorithms".
- **Mechanical sympathy & compilation:** A loop-carried variable with a stable
  shape allows fixed-buffer memory reuse and direct lowering into fast Rust
  loops or C kernels. Variable-shaped accumulators prevent vectorization.
- **Idiomatic Rank style:** Rank provides whole-array primitives (`window`,
  `outer`, `scan with Seed`, `array shape N fill 0`) to construct collections
  without imperative growing loops.
- **Formal rule:** If variable $V$ is read and written in the same loop
  (`loopCarried == true`), its rank and shape must be an invariant:
  $$\text{Shape}(V_{\text{in}}) = \text{Shape}(V_{\text{out}})$$

---

## 6. Bidirectional function parameter inference

User functions in Rank do not declare parameter types:

```rank
fun palindrome X
  Text = X text
  Back = Text reverse
  return Text equal Back
end
```

Rather than forcing type annotations, the abstract interpreter uses call-site
inference:

1. **Collect Call Sites:** The analyzer scans the AST (using facts from
   [`analysis/bindings.ts`](../packages/language/src/analysis/bindings.ts)) to
   find all invocations of `palindrome`.
2. **Propagate Argument Types:**
   - At call site `Products filter palindrome rank 0`, `Products` is known to be
     a 2D tensor of integers.
   - Because `rank 0` applies the function to 0-cells (scalars), argument `X` is
     inferred as `Scalar(integer)`.
3. **Verify Function Body:** The body of `palindrome` is checked using `X: integer`:
   - `X text` produces `text`.
   - `Text reverse` is valid on `text` and produces `text`.
   - `Text equal Back` produces `boolean`.
   - Return type is settled as `boolean`.
4. **Polymorphism Guard:** If another call site passes a matrix or incompatible
   structure without an appropriate cell rank modifier, the analyzer highlights
   the offending call site.

---

## 7. Architecture of the dry-run validator

The validator runs in memory as a non-executing traversal over the Langium AST:

```
                  ┌──────────────────────┐
                  │    Rank AST Source   │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ Scope & Binding Pass │ (packages/language/src/analysis/bindings.ts)
                  └──────────┬───────────┘
                             │
                             ▼
               ┌────────────────────────────┐
               │ Abstract Interpreter Pass  │
               │ (Shape & Rank Environment) │
               └───────┬─────────────┬──────┘
                       │             │
        No Errors      │             │ Diagnostic Errors
                       ▼             ▼
       ┌─────────────────┐   ┌─────────────────────────────┐
       │ Inferred Types  │   │ Langium ValidationAcceptor  │
       │ & Shape Badges  │   │ (Inline Red Squiggles / LSP)│
       └─────────────────┘   └─────────────────────────────┘
```

The pass executes within milliseconds on programs up to hundreds of lines,
making it suitable for live typing in both the CLI and mobile web environments.

### Line-level diagnostic presentation

Compare how an axis/rank mismatch is presented:

**In a monolithic fluent pipeline (JavaScript / Python):**
```text
TypeError: axis 2 is out of bounds for array of dimension 2
at line 42: Data.filter(x => x > 0).window(5).map(w => w.sum()).reduce((a, b) => a + b, axis=2)...
                                                                 ^^^^^^^^^^^^^^^^^^^^^^^^
```
*The developer must mentally unpack what shape `filter` returned, what `window` produced, and how `map` affected the axes before understanding why axis 2 is invalid.*

**In Rank:**
```rank
4 | Windows = Digits 5 window
5 | Total = Windows * reduce rank 3
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    Cannot reduce rank 3: 'Windows' has rank 2 (shape [N - 4, 5])
```
*The error is anchored directly to line 5, names the single intermediate variable `Windows`, displays its known rank and shape, and explains the invalid reduction in a concise 1-2 line message tailored for small screens.*

---

## 8. Implementation roadmap

### Stage 1: Static Rank (Dimensionality) Checker & Loop Invariant Enforcement
*Focus: Catch dimension and axis count bugs immediately with minimal complexity.*
- Extend `analysis/types.ts` with `rank: number` metadata for every `Types`
  result.
- Check reductions: enforce $0 \le K < \text{rank}$ on all `reduce rank K`.
- Check axis operations: enforce $0 \le A < \text{rank}$ on `axis A`.
- Check selectors: enforce selector count $\le \text{rank}$ on `#` slice chains.
- Enforce loop invariants: flag any `loopCarried` variable whose rank differs
  between loop entry and loop iteration end.
- Hook diagnostics into `RankValidator.checkExpressions`.

### Stage 2: Literal & Affine Shape Propagation
*Focus: Verify lengths and broadcasting for common structured patterns.*
- Track exact lengths for sequence ranges (`1 to N`), literal arrays, and
  reshaped buffers.
- Compute affine shapes for `window` (`[N - K + 1, K]`) and `outer`
  (`[*shapeA, *shapeB]`).
- Validate binary elementwise operations when both operand shapes are known.
- Enforce exact shape invariance for loop-carried variables where known.

### Stage 3: Call-Site Function Inference
*Focus: Check function bodies and call sites without type annotations.*
- Infer parameter ranks and element types from calls in the program scope.
- Validate return expressions and check that predicates return booleans.
- Flag invalid operations inside helper functions before execution.

### Stage 4: Table Schema & SQLite Pushdown Verification
*Focus: Column-level checking for tabular workflows.*
- Infer table schemas (column names and column types) from literal records and
  SQLite views (`Db .lineitem`).
- Validate field accesses (`.l_discount`, `.l_quantity`) statically.
- Flag non-existent column names at edit time.
