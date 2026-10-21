# 0300. Sliding windows, stride and padding

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr

## Context

Window operations need consistent coordinates, shape and border rules across
vectors and tensors. A program should choose whether it stores overlapping
cells or reads them as part of a downstream computation.

## Decision

`window` belongs to `use sequences`. Binding mode determines whether a named
result is a recipe or completed storage:

```rank
use sequences
use numbers
Windows' = Values window Width
Stored = Values window Width
Products' = Windows reduce * rank 1
Answer = Products max
```

`Windows` and `Products` compute on demand. Repeated demands recompute them.
`Stored` completes every window cell and can be mutated independently. The
operation has no implicit result cache. Captured data follows the language's
read-only and value-semantics rules.

### Shape and axes

The leading axes select window positions; the trailing axes hold the window
cells. For a source with shape `4 5` and window sizes `2 3`, the result has
shape `3 3 2 3`. Empty position axes retain the requested trailing cell shape.

```rank
WindowShape = array 2 3
Blocks' = Matrix window WindowShape
Columns' = Matrix window 3 axis 1
```

Sizes may be separate integers, a rank-1 integer array, or unpacked sizes.
`axis` chooses distinct zero-based source axes in window-size order. Without
`axis`, the sizes cover all tensor axes, except the ordinary one-dimensional
case. Sizes must be positive.

### Stride and borders

`stride` is a positive integer or one stride per selected axis. `padding` is a
nonnegative integer or one padding amount per selected axis. The modifier order
is `stride`, `padding`, `axis`; `with` follows `padding` and supplies its single
border value. The default border value is integer zero.

```rank
Blocks' = Matrix window 3 3 stride 2 padding 1
Peaks' = Matrix window 3 3 padding 1 with -infinity
Wrapped' = Matrix window 3 3 padding 1 wrap
```

For source length `N`, width `W`, stride `S` and symmetric padding `P`, the
position length is `max(0, floor((N + 2P - W) / S) + 1)`. `wrap` maps border
coordinates around the source instead of filling them. It cannot pad an empty
axis. Padding and wrapping apply to arrays.

### Sources and demand

Text windows yield text. Exact, repeatable sequence sources form array windows
with known shape. Indexed sources retain their direct indexing algorithms;
indexing a source without that capability may replay its prefix. Full collection
and sequential whole-array traversal of a non-indexed source use a rolling reader
local to that traversal. It reads each needed source value once, shares overlap
inside that pass, and leaves unused suffix values unread. Errors, cancellation
and early termination close the reader. No prefix is retained between independent
demands. Programs can explicitly store an expensive source before separate
indexed demands or repeated traversals.

Unknown-size, infinite and single-pass sequence sources produce windows with a
bounded rolling buffer inside each traversal. Single-pass sources remain
single-pass; an apostrophe does not restart them. A finite consumer is required
to complete windows over an endless source.

A complete appended window cell can compose with a reduction. The traversal
keeps operand order, numeric promotion, errors and observable reader effects.
This optimization does not erase an ordinary binding's completion boundary.

### Shift

`shift` moves cells along an array axis while keeping its shape. A positive
count moves toward higher positions. Vacated positions use integer zero or the
single `with` value; `axis` defaults to zero and follows `with`.

```rank
Previous' = Values 1 shift
Down = Matrix 1 shift with 9 axis 0
```

`Previous` remains a recipe. `Down` is completed storage.

## Consequences

Deferred windows avoid storing every overlapping cell. Ordinary bindings offer
explicit retention and writable results at the corresponding memory cost.
Repeated deferred reads can repeat source work and effects. Window geometry and
ranked reductions share the same shape rules for one or several selected axes.
