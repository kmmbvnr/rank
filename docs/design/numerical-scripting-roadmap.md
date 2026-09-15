# Numerical scripting roadmap

The target under discussion is narrower than complete MATLAB or Octave
compatibility:

> Rank should be able to replace Octave for an ordinary numerical script,
> introductory linear algebra and small data or ML programs.

This page records gaps and questions. It is not a specification. Every name in
a code example below is illustrative unless the current language documentation
already defines it.

## Current baseline

Several items that once looked like future work are already in Rank:

- trailing-axis broadcasting for elementwise arithmetic and comparisons;
- `axis` reductions and general trailing-cell `rank` application;
- `reshape`, arbitrary-axis `transpose`, `shape`, ranges and integer-array
  addressing;
- Cartesian selection across several tensor axes;
- `matmul`, `solve`, `inverse`, `det`, `diag` and symmetric `eigh`;
- elementwise real math, including square root, logarithm, exponential and
  trigonometric functions;
- `mean`, `median`, population `std`, sample `covariance`, `mse` and `mae`;
- seeded random state, uniform tensors, sampling and axis-aware shuffling;
- CSV and JSON input, file I/O and an editable terminal REPL with saved source,
  replay and inline results.

The existing Deep-ML examples show that many algorithms can be written in the
language already. They do not show that Rank has an Octave-like numerical
library: several examples implement their own matrix algorithms.

## First missing layer

### Complex numbers

Rank has arbitrary-precision `integer` and binary64 `real`, but no `complex`
scalar. A first design should settle literal syntax, promotion, equality,
ordering errors, formatting, serialization and elementwise operations such as
`real`, `imag`, `conjugate` and magnitude.

Open questions:

- Is `3 + 4i` readable and unambiguous in Rank's parser and phone editor, or
  should construction use words?
- Should `transpose` only permute axes, with a separate conjugate transpose, or
  should another operation cover both?
- Which functions accept complex input, and what errors replace today's real
  domain errors such as the square root of a negative number?

Compact array representations such as `.f32` and `.i32` are a separate storage
question. They are tracked in
[Array element types and compact storage](array-element-types.md). They should
not be mixed into the first complex-number design.

### Standard decompositions and reusable solves

The current library covers direct dense square solving and symmetric
eigendecomposition. It does not provide general eigenvalues, SVD, QR, LU,
Cholesky, least squares or reusable factorization values.

Possible vocabulary includes:

```rank
unpack Q R = A qr
unpack U S V = A svd
X = A B leastsquares
```

The names and return layouts remain open. Before adding them, decide:

- whether `A B solve` dispatches internally or users can retain and reuse a
  factorization;
- how batch and explicit-axis application work for two-input operations;
- whether a general `eig` returns complex arrays while `eigh` keeps its stronger
  real symmetric contract;
- which result conventions match common libraries closely enough to avoid
  silent transposes or sign mistakes;
- whether the reference runtime uses a native BLAS/LAPACK backend, a portable
  implementation, or both.

`solve` should remain the ordinary way to solve a system. `inverse` is useful,
but should not become the teaching shortcut for `A * X = B`.

### Array constructors and grids

Rank can allocate a filled tensor today:

```rank
Z = array shape 3 4 fill 0
O = array shape 3 4 fill 1
I = (array 1 1 1) diag
```

Short names such as `zeros`, `ones` and `eye` would save typing, but they would
mostly alias existing composition. `linspace` and `logspace` add numerical
behavior that ranges do not currently express.

Open questions:

- Which constructors occur often enough in the task corpus to earn standard
  vocabulary?
- Should a shape be one array argument, as in `Shape zeros`, so every tensor
  constructor shares the `uniform` convention?
- How are endpoint inclusion, a one-point grid and integer inputs defined for
  linear and logarithmic grids?
- Is a dedicated `flatten` useful, or is an inferred-dimension form of
  `reshape` the more general missing operation? The existing `flat` operation
  already means compact record storage and cannot be reused casually.

### Statistics and probability

The immediate gaps are variance, quantiles and correlation. Probability
distributions are a later layer. Candidate examples are:

```rank
Q = A 0.95 quantile
R = A B correlation
Noise = Shape 0 1 normal
```

Open questions:

- Should sample versus population behavior use separate names, a denominator
  argument or a mode label? Current `std` is population standard deviation and
  `covariance` is sample covariance.
- Does `percentile` justify a second name, or is `quantile` enough?
- How do quantiles handle interpolation, missing cells, infinities and axes?
- Should distributions be plain operations, immutable generator values, or a
  module of distribution values that also supports `pdf` and `cdf`?
- Is session-wide `Seed seed` sufficient, or do independent streams need
  first-class generator state for reproducible libraries and parallel work?

## Second missing layer

### FFT and signal operations

Numerical scripting needs at least FFT, inverse FFT, convolution and
correlation. FFT depends on complex numbers and should follow that work.

The existing table-selection block already owns the word `filter`. A future
signal API should not overload it until a module-qualification rule makes the
meaning clear. Names, normalization, boundary modes, real-input transforms and
selected-axis behavior all remain open.

### Sparse arrays

Sparse storage is a runtime and library project, not a new literal alone. A
useful first slice needs construction and conversion, sparse `matmul`, and a
solver that does not silently densify its input.

Open questions include COO versus CSR as the public value, duplicate-entry
rules, writable updates, explicit densification, mixed dense/sparse operations,
and whether `shape`, addressing, `axis` and broadcasting behave exactly like
dense tensors.

### Numerical calculus

Discrete `diff`, sampled gradients and numerical integration can be considered
before symbolic differentiation or a general ODE framework. The design should
separate these cases:

- differences over an array axis;
- a numerical derivative of a Rank function;
- quadrature of a function over an interval;
- integration of sampled `X` and `Y` values;
- an initial-value ODE solver with tolerances and structured results.

The operation names, error estimates and purity requirements remain open.

### Plotting and rich results

The terminal REPL already preserves source, results and replay state. It lacks
plots and image-like numerical output. This is the largest environment gap for
exploratory numerical work.

A first plotting API should be tested against real scripts before its block
syntax is chosen. It needs line plots, scatter plots, histograms and matrix
images, plus labels and export. The renderer can be an existing backend; the
Rank contract should describe data, options and returned plot values rather
than depend on one desktop library.

Open questions:

- Are plots immediate side effects or values that the REPL renders?
- How are several series, subplots and incremental updates represented?
- Which output works in a 40-column terminal, a browser editor and a saved
  noninteractive script?
- Is the current source-and-result document enough for a notebook, or is a
  separate cell file format needed?

### Numerical file interchange

CSV is suitable for tables and JSON for general values, but neither preserves a
large numeric tensor efficiently. NumPy `.npy` should be considered before a
MAT-file reader because its basic dense format is smaller in scope. `.npz`,
MAT-files and common sparse encodings can follow only when use cases require
them.

The design must settle dtype conversion, endianness, memory limits, lazy or
memory-mapped reads, complex arrays, metadata and whether loading produces a
writable material array.

## Runtime work behind the vocabulary

Adding operation names alone would produce a slow and unreliable Octave
substitute. The same roadmap needs:

- compact homogeneous numeric storage without changing Rank's inferred scalar
  semantics by accident;
- stable numerical algorithms with documented tolerances and failure modes;
- optional optimized CPU kernels and a portable reference path;
- cancellation, memory limits and useful progress for long operations;
- shape and element-type facts in the editor without forcing lazy values;
- benchmarks that distinguish expressiveness, memory use and execution speed.

GPU and NPU execution should follow measured workloads. It should not determine
the public syntax of the first numerical library.

## Evidence-driven acceptance plan

Use a fixed corpus of small Octave or MATLAB-style tasks rather than inventing
syntax in isolation. The proposed starting size is 50 tasks. MATLAB Cody is one
possible source, subject to access and reuse terms; GNU Octave examples,
textbook exercises and the existing Deep-ML programs are alternatives.

For each task, record one of four outcomes:

1. It is clear with current Rank.
2. It is possible but exposes a missing library operation.
3. It exposes a general language or array-model problem.
4. It depends on an environment feature such as plotting or file interchange.

A candidate primitive should recur across tasks or remove a demonstrably bad
implementation burden. One task alone is not enough. Every accepted operation
needs a shape contract, numeric and error semantics, a small oracle test and a
benchmark when performance is part of its purpose.

The corpus itself is still an open decision: which 50 tasks represent
"ordinary numerical scripting," and what maximum Rank program size or amount
of user-written numerical machinery counts as a pass?

## Suggested order, still open

One plausible order is:

1. Select and classify the 50-task corpus.
2. Add the small recurring gaps in grids, statistics and normal sampling.
3. Design complex scalars and dense numeric storage together at their boundary.
4. Add SVD, QR and general eigen operations with tested result conventions.
5. Render plot values in the existing REPL document.
6. Add `.npy` interchange.
7. Let corpus evidence choose between signal processing, sparse arrays and
   numerical calculus as the next group.

This order is a planning hypothesis, not a commitment. The corpus should be
allowed to change it.
