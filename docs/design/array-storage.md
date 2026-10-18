# Array storage and the internal JS boundary

The interpreter's JS value objects are an internal protocol used by this
repository, not a stable public embedding API. We control their producers and
consumers. CLI, web and mobile use the interpreter to run programs and inspect
results; they do not require external writes to array cells to update earlier
Rank computations.

## Ownership and mutation

Runtime-owned arrays keep private storage and revision/ownership metadata in
WeakMaps. Public `items` facades are an internal access path. Rank assignments
use the storage writer and COW rules so that aliases and retained derived values
keep their language-level value semantics.

Direct external mutation of `items`, shape, buffers or nested values has no
reactive-update contract, including mutations between interpreter calls. Some
internal readers can still notice such changes; callers must not depend on that
incidental behavior. Supply new inputs or execute Rank assignments instead.
Arbitrary Proxy traps, effectful eager properties and concurrent host mutation
are outside the internal eager-storage contract. This is not an untrusted-host
security boundary.

Explicit lazy readers, callbacks, I/O and generators remain observable parts of
execution. Optimization guards must not force unread cells, replay callbacks or
reorder effects. Unknown readers keep ordinary evaluation. Removing external
mutation guarantees does not make Rank callbacks pure.

## Numeric kernels

Stored numerical arrays can use eager elementwise kernels even below 1024 cells.
Unread operands and per-cell numeric errors retain the lazy fallback. Small
comparison masks remain lazy and read-only; explicit `copy` or `array` makes
mutable storage. Numeric kernels retain exact BigInt arithmetic.

Stored homogeneous integer operands also specialize `+`, `-` and `*` without
per-cell type dispatch. Fresh outputs carry their proved scalar kind into owned
storage rather than validating every cell again. Results remain arbitrary-width
BigInts, including when an input is an Int64 buffer.

Pure arithmetic compound assignments using `+`, `-` and `*` can enter the tensor
compiler as a single array-output expression. The previous target is an input;
the kernel allocates one fresh output before ordinary binding validation and
rebinding. Total numeric scalar subexpressions are evaluated before the array
pass, including for an empty array. Their values are recomputed on every run;
only code/layout may be cached. Unsupported expressions and unread inputs keep
the reference path.

Array-mask selection snapshots positions and retains the source through COW.
A private plan registry lets explicit sequence materialization compact trusted
stored scalar sources directly. Selection creation and `len` still do not demand
source cells. Lazy, nested, missing and host sources keep ordinary iteration.
Trusted stored boolean masks may reuse positions under an identity/revision
check; binding/domain checks run on each use. Results receive fresh writable
storage, never an in-place update of a retained source.

A vector dot product uses linear offsets. Trusted selection views may borrow
stored cells without allocating a per-cell cache, while retaining the view's
observed element-domain checks and established binding contracts. Borrowing is
confined to a synchronous operation with no callbacks or writes. Other operands
keep their ordinary readers and left-to-right error/effect order.

Regular array selections and array `drop`/`take` publish trusted source mappings.
Elementwise numeric operations can borrow these stored cells synchronously,
without input copies or per-cell lazy caches. Flat mappings compose their offsets
and strides; other tensor mappings keep their checked readers. Open array ranges
compute their length and stride directly rather than building an index array.
Binding checks and observed element domains still run, and arbitrary lazy or
masked sources retain the ordinary fallback. Integer results are never narrowed
to Int64 merely because an input uses typed storage. Float64 views enter the
existing real kernel through zero-copy subarrays or explicit strides. With a
single proved scalar kind, value-independent domain checks can observe one
representative cell; column-specific or mixed-domain checks retain normal reads.

Retained selections use the existing source ownership and selection-detachment
rules. A borrowed layout is prepared anew for each operation, including after
source writes. Selections that previously gathered eagerly (typed storage or
large stored selections) retain their writable interface by deferring their
private copy until a write. Small lazy selections and array `drop`/`take` retain
their existing read-only interface; explicit `copy` creates mutable storage.

`createArraySnapshot(items, shape?)` remains an internal shallow-copy helper for
tests and inputs. It copies the iterable and shape, validates dimensions and
preserves numeric values without coercion. It is not a reactive embedding API.

Historical boundary experiments and their measurements remain in the
[optimization log](optimization-lab.md); they do not define the current contract.
