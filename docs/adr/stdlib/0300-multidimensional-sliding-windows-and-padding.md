# 0300. Multidimensional Sliding Windows, Stride, and Padding (use sequences)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Sequences and Arrays Specification, Numerical Scripting Roadmap

## Context

Sliding window algorithms (signal filtering, n-grams, rolling moving averages, image convolutions, patch extraction in deep learning) traditionally force programmers into writing low-level imperative boilerplate:
1. **Manual coordinate index math:** Calculating offsets (`i + j`), edge boundary checks, and buffer indices is verbose, error-prone, and prone to off-by-one bugs.
2. **Excessive memory duplication:** Naive window extraction in Python (`[arr[i:i+w] for i in range(...)]`) allocates duplicate array copies for every overlapping slice, rapidly exhausting memory on large sequences or images.
3. **Complex strides and padding implementations:** Adding strides or zero padding around multidimensional borders requires writing custom padding matrices or calling complex specialized libraries (like `torch.nn.functional.unfold` or `scipy.signal.convolve`).

Rank needs a declarative, zero-copy windowing operation that scales naturally from 1D text n-grams to multidimensional tensor convolutions, integrated with Rank's rank polymorphism (ADR-0200).

## Decision

Rank establishes **Multidimensional Sliding Windows with Stride and Padding via `use sequences`**:

```rank
use sequences

Windows = Values Width window
Blocks = Matrix (array 3 3) window stride 2 padding 1
```

### 1. Zero-Copy Lazy Windowing (`window`)
- Applying `window` lifts a sequence of rank $R$ to rank $R+1$ (or $R+K$ for $K$ windowed axes).
- The window-position axes form the leading frame, and the requested window dimensions form the trailing cells:
  ```rank
  rem Source shape: 4 5
  WindowShape = array 2 3
  Blocks = Matrix WindowShape window
  rem Blocks shape: 3 3 2 3
  ```
- Window views are lazy and read-only: overlapping cells are computed on demand without eagerly copying memory.

### 2. Composition with Rank Polymorphism
Because windowed cells form the trailing dimensions, Rank's core `rank` combinators apply directly to every window:
```rank
rem Compute max product across all 13-digit sliding windows:
Windows = Digits 13 window
Products = Windows * reduce rank 1
MaxProduct = Products max
```
This solves complex window-aggregation problems in just 3–4 concise lines.

### 3. Strided Windows (`stride`)
- The `stride` modifier skips positions along the position frame:
  ```rank
  Downsampled = Matrix WindowShape window stride 2
  ```
- Stride must be a positive integer or a rank-1 array with one stride per windowed axis.

### 4. Symmetric Zero Padding (`padding`)
- The `padding` modifier adds conceptual zero borders before windows are selected:
  ```rank
  Padded = Matrix WindowShape window padding 1
  ```
- Padding must be a non-negative integer or a rank-1 array of padding amounts.
- For source length $N$, window width $W$, stride $S$, and padding $P$, the output position length matches the standard convolution formula:
  $$\text{length} = \max\left(0, \left\lfloor \frac{N + 2P - W}{S} \right\rfloor + 1\right)$$

### 5. Selective Axis Windowing (`axis`)
- `axis` targets specific dimensions without windowing the entire tensor:
  ```rank
  Columns = Matrix 3 window axis 1
  ```

## Consequences

### Positive
* **APL-level power with English words:** Replaces nested index loops with clean, declarative window operations that fit the 40-column mobile line budget.
* **Zero memory duplication:** Lazy read-only views avoid allocating gigabytes of overlapping duplicate buffers.
* **Unified ML primitive:** Unifies text n-grams, time-series moving averages, and 2D/3D convolutional filter patches under a single syntax.
* **Seamless fusion:** Downstream reductions (`+ reduce rank 1`, `max`) fuse with window traversal, computing aggregates in registers.

### Negative / Trade-offs
* **Read-only views:** Windows cannot be directly written to in place; mutating windowed results requires materializing an independent dense copy via `copy`.
