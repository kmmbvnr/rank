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

A vector dot product uses linear offsets. Trusted selection views may borrow
stored cells without allocating a per-cell cache, while retaining the view's
observed element-domain checks and established binding contracts. Borrowing is
confined to a synchronous operation with no callbacks or writes. Other operands
keep their ordinary readers and left-to-right error/effect order.

`createArraySnapshot(items, shape?)` remains an internal shallow-copy helper for
tests and inputs. It copies the iterable and shape, validates dimensions and
preserves numeric values without coercion. It is not a reactive embedding API.

Historical boundary experiments and their measurements remain in the
[optimization log](optimization-lab.md); they do not define the current contract.
