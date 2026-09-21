# 0302. Linear Algebra Solvers and Matrix Decompositions (use linalg)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Tensors Specification, Linear Algebra Benchmark Suite

## Context

Linear algebra operations (matrix multiplication, determinants, system solvers, matrix inversions, and eigendecompositions) form the mathematical foundation of machine learning, graphics, physics simulations, and scientific computing.

In traditional numerical libraries (NumPy, SciPy, MATLAB, Eigen):
1. **API fragmentation and batching gymnastics:** Functions are often designed for 2D matrices only. Applying a determinant or solver across a 3D or 4D batch of matrices (e.g. $[B, N, N]$ in ML) requires writing imperative loops or relying on complex batched APIs (`np.linalg.inv` vs loop wrappers).
2. **Numerical instability of manual inversion:** Developers often invert matrices manually (`x = A.inv() * b`) instead of solving linear systems directly, leading to catastrophic loss of numerical precision and slower execution.
3. **Cryptic error reporting:** Singular matrices or asymmetric inputs frequently produce silent NaNs or dump cryptic C/Fortran LAPACK codes.

Rank needs clean, data-first linear algebra primitives with intrinsic rank 2 that compose seamlessly with Rank's rank polymorphism (ADR-0200) for effortless batching, enforce direct solving, and report clear symbol errors.

## Decision

Rank establishes **Linear Algebra Solvers and Decompositions via `use linalg`**:

```rank
use linalg

C = A B matmul
X = A B solve
unpack Values Vectors = Matrix eigh
```

### 1. Matrix Multiplication (`matmul`)
- Data-first invocation: `C = A B matmul`.
- Contracts the last axis of $A$ with the first axis of $B$ by default.
- General axis contraction via `axis`:
  ```rank
  C = A B matmul axis 2 0
  ```
- Handles vectors (dot product), matrix-vector, and tensor contractions cleanly.

### 2. Intrinsic Rank-2 Solvers and Inversion
Linear algebra operations declare **intrinsic rank 2** (ADR-0200), meaning they naturally consume trailing 2D matrix cells:
- **Direct Linear Solver (`solve`):** Solves the system $AX = B$ directly:
  ```rank
  X = A B solve
  ```
  Avoids manual inversion and achieves maximum numerical precision via Gaussian elimination with partial pivoting.
- **Matrix Inversion (`inverse`):**
  ```rank
  Inv = Matrix inverse
  ```
- **Matrix Determinant (`det`):**
  ```rank
  D = Matrix det
  ```
  Integer-only matrices produce exact BigInt integers; matrices with real elements produce IEEE-754 reals.

### 3. Automatic Batching via Leading-Frame Framing
Because `det`, `inverse`, and `solve` have intrinsic rank 2, they batch over multi-dimensional tensors **automatically without loops**:
```rank
rem Batch has shape 100 4 4:
Dets = Batch det          rem Result has shape 100
Inverses = Batch inverse  rem Result has shape 100 4 4
```
Non-trailing matrix planes are targeted effortlessly using the core `axis` frame modifier (`T det axis 1 rank 2`).

### 4. Symmetric Eigendecomposition (`eigh`)
- Computes eigenvalues and eigenvectors for real symmetric matrices:
  ```rank
  unpack Values Vectors = Matrix eigh
  ```
- `Values` contains eigenvalues in ascending order.
- `Vectors` columns (`Vectors # j`) contain corresponding normalized eigenvectors.

### 5. Structured Error Signals
Numerical domain errors raise explicit symbols (ADR-0306):
- Incompatible matrix dimensions raise `.DimensionMismatch`.
- Non-invertible or singular matrices raise `.SingularMatrix`.
- Asymmetric inputs to `eigh` raise `.NotSymmetric`.

## Consequences

### Positive
* **Zero-loop tensor batching:** Operates across batches of hundreds of matrices via rank polymorphism without writing a single `for` loop.
* **Numerical safety:** Direct `solve` prevents the precision loss of manual matrix inversion.
* **Exact integer arithmetic:** Integer determinants preserve arbitrary precision without floating-point rounding.
* **Readable symbols:** Errors are signaled as clean symbols (`.SingularMatrix`) catchable by `try/catch`.

### Negative / Trade-offs
* **Float precision:** The current interpreter implementation uses IEEE-754 binary64 reals and standard pivoting algorithms; specialized high-precision BLAS/LAPACK bindings remain an implementation concern.
