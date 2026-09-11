# Array storage and the internal JS boundary

Rank arrays use ordinary JS data properties for eager cells and shape. There
is no private ownership WeakMap, exposure getter, frozen storage or permanent
"exposed" state. Rank assignments through aliases remain observable.

## Scope

The interpreter's JS objects are an internal protocol used by this repository.
They are not a stable public embedding API. The project owner confirmed this
scope during the optimization pass: we control both producers and consumers.

Eager host arrays must have ordinary data properties and stable contents during
a synchronous operation. Arbitrary Proxy traps, effectful property getters,
prototype tricks and concurrent host mutation are outside this contract.
Unsupported objects are not promised a deterministic rejection or a safe slow
path. This is a precondition, not an untrusted-host security boundary.

Mutations between calls remain supported. Rank callbacks and lazy evaluation
remain part of language semantics; this restriction does not make them pure.

## Fusion checks

An eager numeric reader requires a Rank array with no `itemAt`, an own data
property containing a JS items array, and numeric or boolean cells. Eligibility
is checked per operation, so replacing items or changing a cell between calls
does not leave a stale proof. Nested/object cells take ordinary evaluation.

Lazy Rank arrays keep their readers and caches. Fusion is limited to inline
arithmetic; named intermediates and broadcasting cases retain their ordinary
path. Operand order, floating-point order, BigInt precision, shadowed standard
functions and Rank error locations remain tested.

Tensor row copying reads the current source on each iteration. Files inserted
into arrays remain visible to resource cleanup; there is no stale file-free
marker derived from former numeric contents.

## Copy helper

`createArraySnapshot(items, shape?)` remains a shallow copy helper for tests and
internal callers. It copies the iterable and shape, validates dimensions, and
preserves numeric values without coercion. It neither freezes the result nor
confers a special optimization capability. Ordinary eager arrays qualify for
the same fusion. Mutating the copy does not change the original outer array.

The old private-storage design and the short-array cutoff experiment are
historical entries in the [optimization log](optimization-lab.md). Measurements
before and after the boundary decision remain available there.
