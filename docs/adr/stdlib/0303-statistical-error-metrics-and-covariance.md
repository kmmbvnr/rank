# 0303. Statistical Error Metrics and Covariance (use stats)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Tensors Specification, Statistics and Kaggle Demos

## Context

Evaluating machine learning models, analyzing empirical data, and computing feature correlations require robust statistical operations:
- Averages and dispersion measures (`mean`, `std`);
- Standard regression and loss error metrics (`mse`, `mae`);
- Multivariate feature covariance matrices (`covariance`).

In traditional data science workflows:
1. **Manual formula recalculation:** Programmers constantly re-implement Mean Squared Error (`((pred - target) ** 2).mean()`), introducing boilerplate and potential broadcasting shape bugs.
2. **Ambiguous variance conventions:** Confusion often arises between sample variance (dividing by $N-1$) and population variance (dividing by $N$).
3. **Complex covariance dimension tracking:** In Python (`np.cov`), distinguishing feature axes from sample axes across multi-dimensional batches requires juggling `rowvar=True/False` flags and transpositions.

Rank needs clear, first-class statistical operations that integrate with Rank's broadcast engine, rank framing, and axis reductions.

## Decision

Rank establishes **Statistical Error Metrics and Covariance via `use stats`**:

```rank
use stats

Spread = Values std
Loss = Predictions Targets mse
Cov = Features covariance
```

### 1. Statistical Reductions (`mean`, `std`)
- `mean`: Computes the arithmetic mean, always returning a real number.
- `std`: Computes population standard deviation (dividing by $N$), always returning a real number.
- Both operations integrate with the `axis` modifier to reduce specific dimensions while preserving the remaining frame:
  ```rank
  FeatureMeans = Data mean axis 0
  RowSpreads = Data std axis 1
  ```
- Empty inputs raise `.EmptyReduction`.

### 2. Binary Error Loss Metrics (`mse`, `mae`)
Rank provides dedicated first-class loss metrics:
- `mse`: Mean Squared Error.
- `mae`: Mean Absolute Error.
- Data-first invocation over predictions and targets:
  ```rank
  Loss = Pred Target mse
  ```
- **Automatic broadcasting:** Operands are broadcast to a common shape before differences are squared or absolutized.
- **Axis-selective loss:** With `axis`, computes per-sample or per-feature error frames:
  ```rank
  SampleLosses = Pred Target mse axis 1
  ```

### 3. Sample Covariance Matrix (`covariance`)
- Computes sample covariance (dividing by $N - 1$), always returning real matrices.
- **Default Axis Layout:** By default, the trailing axis represents observations, the preceding axis represents features, and all earlier axes represent independent batches:
  $$\text{Features} \times \text{Observations} \longrightarrow \text{Features} \times \text{Features}$$
  $$\text{Batch} \times \text{Features} \times \text{Observations} \longrightarrow \text{Batch} \times \text{Features} \times \text{Features}$$
- **Custom Axis Pairs:**
  ```rank
  Cov = Samples covariance axis 1 0
  ```
  The first index selects the feature axis and the second selects the observation axis.
- Raises `.InsufficientData` when the observation count is fewer than 2.

### 4. Lazy Caching and Stability
Statistical reductions and covariance calculations are evaluated on demand and cached, ensuring efficient reuse during iterative training and evaluation loops without unnecessary recalculations.

## Consequences

### Positive
* **Self-documenting ML losses:** `Pred Target mse` eliminates repetitive squaring and mean expressions.
* **Exact covariance framing:** Clean feature-vs-observation axis specifications eliminate the transpose-and-reshape headaches of traditional `cov()` functions.
* **Dimensional consistency:** All metrics integrate naturally with Rank's leading-frame and axis reductions (ADR-0200).
* **Safe error handling:** Clear symbol errors (`.InsufficientData`, `.EmptyReduction`) rather than silent NaN values.

### Negative / Trade-offs
* **Population vs Sample distinction:** `std` uses population $N$ (standard in ML normalization), while `covariance` uses sample $N-1$ (standard in statistical inference). Developers must be aware of this standard distinction.
