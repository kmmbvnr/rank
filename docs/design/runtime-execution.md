# Interpreter execution

The TypeScript interpreter is the reference implementation for developing Rank.
Its execution helpers must preserve the language's observable behavior, including
error timing, lexical capture, fixed inferred types and file ownership.

## Function environments

`packages/interpreter/src/frame.ts` holds a function invocation's values and
inferred types together. Its parent is the environment captured when the function
was defined. Calling a function installs one frame reference and restores the
caller reference in `finally`; it does not copy the caller's scope stack.

Lookup follows lexical parents and then the module's global workspace. Assignment
updates an existing lexical binding, or creates a binding in the current frame.
Parameters belong to the new frame. Separate calls create separate frames, while
closures from one call share their captured bindings. Suspended generators retain
their frame and install it only while advancing or closing the generator.

The maps exposed through `captures()` are live references used by file ownership
traversal. They are not snapshots of captured values.

## Prepared syntax

`prepared-function.ts` caches generator classification and direct local function
declarations by AST identity. Only syntax is shared: every invocation still creates
its own local functions and captures. A weak cache permits unused ASTs to be freed.

The interpreter also prepares expression handlers on first evaluation. A handler
remembers how to evaluate an expression, including recognized `rank`, `axis`,
`outer`, reduction and slice forms. It does not remember the expression's result.
Names are resolved in the active environment on every execution; arrays and input
sequences are allocated anew. Operands are evaluated in their original order.
Preparation of child expressions remains lazy, preserving errors and side effects
in expressions that have not yet been reached.

Statement execution still uses the AST stream shared with generators. This keeps
one implementation of `try`, `catch`, `finally`, loops and control transfer. A
bytecode VM or a separate non-generator statement executor is not implemented.

## Resource scopes

Every function call still establishes a resource scope, including arithmetic
functions. Nested calls can transfer files into that scope. Empty scopes returning
scalar values skip the container traversal used to find escaping files; containers,
closures and sequences retain the full ownership traversal.

## Verification and measurement

Run from the repository root:

```sh
npm test
npm run rank -- test demos
node benchmarks/runtime.mjs
```

Build before running the benchmark. It parses a recursive function once, warms it
up, checks its result and reports the median of five runs. Parsing and process
startup are excluded. Timing is diagnostic, not a test threshold.

On the development machine during this refactor, the recursive benchmark changed
from approximately 85 ms to 35 ms. The current CSES 024 draft's official sample
returned 201 in approximately 5.2 seconds, compared with 10.2 seconds before the
refactor; the baseline was rechecked without CPU profiling. These are local
measurements, not performance guarantees. The all-wildcard case did not complete
within a 55-second check and remains separate unfinished example work.
