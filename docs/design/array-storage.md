# Private array storage and the JS boundary

Fusion must not inspect an arbitrary host object to decide whether it is safe.
Even `Object.getOwnPropertyDescriptor` and `in` can run a Proxy trap. The old
gate could change a numeric input while checking it.

## The checked contract

The runtime keeps a private WeakMap of arrays it constructed from fresh numeric
or boolean cells. The record contains the unexposed cell reader and the original
shape and getter identities. Looking up an unknown object, including a Proxy
around a known array, does not read any property on that object.

For a known identity, descriptor checks are safe: the object itself was created
by the runtime and cannot become a Proxy. Each use checks the original fields
and shape dimensions. A changed getter, prototype, shape or storage uses the
ordinary evaluator. All leaves must qualify before fusion reads cells.

Reading public `items` exposes the mutable backing array and disables this
proof for that value. JS can then install element getters, replace cells or add
files. Rank indexed assignment currently takes this same conservative path.
The file-free marker also disappears on exposure or descriptor replacement.
Ordinary mutation and alias behavior remain available.

This is an operation-local proof, not whole-function immutability. Tensor loops
revalidate between rows because the loop body may call user code. Copying one
validated row can read private primitive cells without exposing the input.
Foreign matrices keep their ordinary getter order and plain row representation.

## JS snapshot constructor

JS callers can opt into the same contract:

```js
import { Interpreter, createArraySnapshot } from './packages/interpreter/out/index.js';

const runtime = new Interpreter();
runtime.variables.set('A', createArraySnapshot([1, 2, 3]));
runtime.variables.set('B', createArraySnapshot([4, 5, 6]));
console.log(runtime.execute('use numbers\n(A * B) sum')); // 32
runtime.dispose();
```

`createArraySnapshot(items, shape?)` copies the iterable and shape. The default
shape is a vector. Invalid dimensions or a mismatched item count raise a Rank
dimension error. This is a shallow snapshot: nested objects are not copied and
such arrays use ordinary execution. BigInts keep arbitrary precision; mixed
integer/real cells, signed zero, NaN and booleans are not coerced during copying.

This constructor does not freeze public `items`. Accessing it gives the caller
mutable storage and switches that snapshot to ordinary execution. Replacing
`items` also disables the proof. The original input iterable and the snapshot
do not share their outer cell array.

Rank array literals and finite sequence materialization create eligible storage
internally when all cells are numeric or boolean. No Rank keyword was added.
Not every array-producing operation propagates this contract yet; lazy readers,
reshaped views and already exposed arrays remain conservative fallbacks.

## Measurements and future work

Use `--storage=plain` and `--storage=snapshot` with `benchmarks/arrays.mjs` or
`benchmarks/numerical-demos.mjs`. The default is `plain`. Both versions get the
same values and shape; an older runtime without the constructor receives copied
plain arrays in snapshot mode. Numerical cold timing includes input construction;
array-kernel warm timing does not. Do not combine these two storage modes in a
single speedup claim. Results are in the [optimization log](optimization-lab.md).

The backing store is still a JS array. Compact real/boolean buffers are the next
experiment. Internal read/write APIs may later avoid unnecessary exposure, but
must preserve callbacks and file lifetime. A type annotation alone cannot prove
that a host object is free of getters or proxies.
