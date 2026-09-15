# Control flow and functions

## Conditionals

```rank
if X less 0
  return false
end
```

Alternative branches:

```rank
if X equal 0
  Result = 1
else
  Result = X
end
```

Multiple alternatives use `elif`. Conditions are evaluated from top to bottom;
only the first true branch runs. `else` remains optional:

```rank
if Score greater Best
  Kind = "record"
elif Score equal Best
  Kind = "tie"
else
  Kind = "lower"
end
```

## For

Rank uses one `for` statement for every kind of loop. Ranges and sequences are
ordinary iterable values:

```rank
for i in 1 to 10
  i print
end
```

The loop variable is an ordinary name in the current workspace. Each iteration
assigns the next value to it; after a nonempty loop it retains the last value,
following Rank's BASIC-like workspace model.

A condition after `for` is evaluated before every iteration:

```rank
for B not equal 0
  R = A % B
  A = B
  B = R
end
```

A bare `for` repeats without a condition until control leaves its body:

```rank
for
  Count += 1
  if Count equal 10
    break
  end
end
```

`break` immediately ends the nearest enclosing `for`. It is an error outside
a loop. Rank does not currently have labels or a multi-level form of `break`;
an outer loop must be ended by its own `break`, condition or `return`.

`continue` skips the rest of the current iteration of the nearest enclosing
`for`. An iterable loop advances to the next item; a conditional loop checks
its condition again; a bare `for` starts its next iteration.

```rank
Sum = 0
for I in 1 to 5
  if I % 2 equal 0
    continue
  end
  Sum += I
end
rem Sum is 9
```

Like `break`, `continue` is an error outside a loop and cannot target a caller's
loop from inside a function. Pending `finally` blocks run before the next
iteration. A direct `continue` inside `finally` is an error, matching the rules
for `break` and `return`. `continue` does not close an iterable loop's iterator.

The unparenthesized form `for X in A` is always iteration. Parentheses make a
membership expression a loop condition when that distinction is needed:

```rank
for (X in index)
  ...
end
```

An optional second name explicitly receives the zero-based index:

```rank
for Value i in A
  Sum += Value
end
```

The names are ordinary bindings; the whitespace between them is required.
`for Value in A` binds only the value.

`#` in a binding position discards that value instead of creating or changing
a variable. It is useful for fixed repetition and for ignoring an index:

```rank
for # in 1 to N
  Item read
end

for Value # in A
  Value visit
end
```

For a tensor, ordinary iteration yields cells along its leading axis. Explicit
cell-rank and axis iteration are defined in [Tensors](tensors.md).

## Errors and exceptions

Runtime diagnostics identify the failing statement by file, line and column
(counted from one), followed by its source line and a caret:

```text
RankError [Runtime]: unknown name: abs; did you forget `use numbers`?
  at solution.ra:2:1
2 | -5 abs
    ^
```

An unknown standard-library name suggests the `use` statement needed to import
it. Local definitions still take precedence. The CLI writes diagnostics to
stderr and exits with status 1 for a failed file run, without a JavaScript
stack trace. `.Message` contains the error message; `.Trace` contains the
formatted Rank diagnostic. Errors inside functions retain their original
statement location when propagated or re-raised. This is an error location,
not a complete function-call stack.

Rank uses structured `try / catch / end` blocks for recoverable runtime errors:

```rank
try
  Value = Text integer
catch .InvalidNumber Error
  Value = 0
end
```

A `try` block has one or more `catch` clauses, a `finally` clause, or both.
Catch clauses are tested from top to bottom and the first matching clause runs.
A typed clause matches the case-sensitive error label; a clause with only a
variable catches any Rank runtime error:

```rank
try
  Value = Source load
catch .MissingFile Error
  Value = Default
catch Error
  Error raise
finally
  Resource close
end
```

The caught error is a first-class `error` value. Its standard fields use
ordinary label addressing:

```rank
Kind = Error .Kind
Message = Error .Message
Original = Error .Value default Default
Cause = Error .Cause default Default
Trace = Error .Trace
```

`.Kind` is a label, `.Message` and `.Trace` are text, `.Value` is the optional
value attached when the error was raised, and `.Cause` is an optional earlier
error. Addressing `.Value` or `.Cause` when it is absent produces `.Missing`,
so `default` can provide a default. Error bindings follow the same inferred-type
and workspace rules as other names.

`raise` is a core data-first operation and does not require `use`. Error kinds
are ordinary labels and need no declaration:

```rank
.InvalidAge raise
.InvalidAge Age raise
.InvalidInput "age is required" raise
```

With no attached value, the default message is the error label. A text value
is also used as the message; another value is formatted with its label to make
the default message. Built-in operations currently use `.Runtime` as the
general kind, `.InvalidNumber` for invalid numeric text, and `.Missing` for
absent addressed values.

A caught error can be raised again:

```rank
catch Error
  Error raise
```

Raising the caught value preserves the original error and diagnostic trace.
An error raised while a handler is running propagates to the next enclosing
`try`; another clause of the same block does not catch it. If no clause
matches, the error continues outward. An uncaught error ends the current
program run.

`finally` runs exactly once after the `try` body and any selected `catch`,
before control leaves the whole construct. It runs after normal completion and
also before a pending error, `return`, `break` or `continue` continues outward. A
`try / finally / end` block without `catch` is valid and performs cleanup while
allowing the original error to propagate.

Direct `return`, `break` and `continue` statements inside `finally` are errors because they
would hide pending control flow. If cleanup raises an error while another Rank
error is pending, the cleanup error propagates and its `.Cause` contains the
original error. An error raised from `finally` cannot be handled by a `catch`
belonging to the same construct; an enclosing `try` may handle it.

`return`, `break` and `continue` are control flow rather than errors and are never caught.
Source syntax errors happen before execution begins and therefore cannot be
caught by a `try` inside that source.

Errors from lazy work occur when a value is demanded. A `try` around plan
construction does not catch an error that occurs later outside the block. Put
the terminal operation inside `try` when its errors must be handled:

```rank
try
  Plan = Data transform
  Result = Plan sum
catch Error
  ...
end
```

Rank does not currently have resumable errors, retries or continuations.

## Functions

Functions are documented with a short block of `rem` lines immediately before
`fun`. The block says what the function returns and explains only the
non-obvious idea or constraint:

```rank
rem Return the greatest common divisor.
rem Use the Euclidean algorithm.
fun gcd A B
  for B not equal 0
    R = A % B
    A = B
    B = R
  end

  return A
end
```

These are ordinary comments today. Future help and documentation tools may
associate the adjacent block with the function without adding another comment
syntax.

Top-level functions are registered after the whole file is parsed and before
its executable statements run. A function may therefore be called before its
textual definition, and helper functions may be placed at the end of a program:

```rank
Answer = 41 next

fun next X
  return X + 1
end
```

Loading a source file with `use` registers its top-level functions without
executing its ordinary top-level statements.

Calls use Rank's data-first order. Arguments come first and the function name
is the final word:

```rank
G = A B gcd
Result print
```

### Function equality

`equal` compares function identity. Two references to the same function are equal;
separately defined functions are distinct even when their source and results match.
Reading the same standard function repeatedly returns the same object within one
interpreter:

```rank
use numbers
F = abs
F equal abs rem true
abs equal abs rem true
abs equal sqrt rem false
```

Each call that creates a local function creates a distinct closure, even when the
captured values match. Copying a function reference preserves its identity. Defining
a function again creates a new object; saved references still refer to the old one.
Functions supplied by standard-library modules are distinct across interpreter
instances. User bindings can still shadow standard function names; caching does
not change lookup order.

## Memoized functions

`memo` declares a value-returning function with a cache:

```rank
memo fib N
  if N less 2
    return N
  end
  return ((N - 1) fib) + ((N - 2) fib)
end
```

Calls use the same syntax as `fun`. The complete, typed argument tuple is the
cache key. A cache hit returns the stored result without running the body.
Successful results are stored after the call completes, including its
`finally` blocks. Errors are not cached.

Arguments and results must be scalar integers, real numbers, booleans, text or
labels. Integer and real keys are distinct. Collections, functions, files and
sequences are rejected. A memoized function must not contain `yield`.
The programmer must ensure that the result stays valid for its arguments:
changes to captured data do not invalidate the cache, and side effects run
only on cache misses.

The cache belongs to the function object. Aliases share it; redefining the
function creates a new cache. Each call of an outer function creates fresh
local memoized functions:

```rank
fun solve N
  return N fib

  memo fib X
    if X less 2
      return X
    end
    return ((X - 1) fib) + ((X - 2) fib)
  end
end
```

Each `solve` call starts with an empty cache. Once its local function and
captured workspace are unreachable, the host garbage collector can reclaim
them and the cache. Returning or saving the local function keeps its cache
alive. There is no size limit, expiry or explicit clearing operation.

Recursive and mutual calls use the cache and the explicit Rank call stack.
Calls into memoized functions retain the continuation that stores the result;
they do not use the frame-replacing tail-call optimization. Ordinary `fun`
tail calls keep their existing behavior.

## Local functions and closures

A function may declare functions directly inside its body. Local functions are
registered when the enclosing call begins, so their definitions can stay after
the executable lines and even after the outer `return`:

```rank
fun make Base
  return add

  fun add Value
    return Base + Value
  end
end
```

The local function is visible throughout that invocation of `make`. It captures
the enclosing lexical workspace by reference, and a returned function keeps
that workspace alive. Separate calls create separate captured workspaces.
Assignment updates the nearest captured binding; every binding still keeps its
inferred type.

Name lookup follows one fixed order: the function's own workspace, its captured
outer workspaces from nearest to farthest, then the module workspace. A function
does not see local values belonging only to its caller. Top-level functions
therefore cannot accidentally depend on a caller's parameters.

A local function declaration must be a direct statement of another function.
It cannot be conditional or appear inside `if`, `for`, `try`, `catch` or
`finally`. Test blocks may declare test-local functions directly, as before.
Local functions may recurse and may contain further direct local functions.

Resources in a captured workspace move with an escaping function and remain
open for as long as the receiving resource scope owns that function.

## Generator functions

A function containing `yield` returns a lazy sequence. Calling it creates the
sequence without running the body; execution starts when an operation first
asks for an element:

```rank
rem Generate the Collatz values beginning with N.
fun weird N
  yield N

  for N not equal 1
    if N even
      N //= 2
    else
      N = 3 * N + 1
    end
    yield N
  end
end
```

`yield Value` emits exactly one sequence item and suspends the function. An
array or other collection is one item and is not flattened. Local variables
retain their values between yields. Errors in the body are raised only when
iteration reaches the failing statement.

User generators are single-pass because they may read input, use files or
perform other effects. A second attempt to consume the same generator sequence
raises `.ConsumedSequence`; call the function again to create a new sequence.
Their extent is unknown unless a future contract says otherwise.

A bare `return` ends a generator early. `return Value` is an error in a
generator, while a bare `return` is an error in an ordinary value-returning
function. `yield` is valid only in a generator function. A yielded value does
not become the function's return value.

Resources opened by a generator remain owned by its suspended execution. They
close when the generator finishes, raises an error, is abandoned by its
consumer, or its interpreter is disposed.

## Scoped resources

Resource values such as open files have deterministic lifetimes. A resource is
owned by the function, test or program execution that creates it and is released
when that scope exits normally, returns or raises an error. `if` and `for` do not
create separate ownership scopes because their variables follow Rank's
BASIC-like workspace rules.

Returning a resource moves it into the caller's ownership scope:

```rank
fun source Path
  File = Path open
  return File
end

File = "input.dat" source
Header = File 64 readbytes
```

The returned file remains open in the caller and closes when the caller exits.
Resources contained in a returned array or collection move with that value.
Explicit operations such as `File close` remain available for early release.
Rank does not currently have a general `defer` statement.

## Varargs

Current vararg syntax uses `*`:

```rank
fun lcm * Numbers
  ...
end
```

The call-site spelling for expanding a sequence into arguments is still open;
the former prefix sketch `lcm * Range` is not part of the current language.

## Division and remainder

`%` is floor modulo: a nonzero result has the divisor's sign. For integer
operands and a nonzero divisor, `A equal (A // B) * B + A % B` is always true.
For example, `-5 % 3` is `1`, `5 % -3` is `-1`, and `-5 % -3` is `-2`.
With a positive integer modulus `M`, `X % M` is already in `[0, M)`;
`(X % M + M) % M` is unnecessary.

Real and mixed operands use the same sign rule, subject to floating-point
rounding. A real zero result has the divisor's sign. Division or modulo by
zero raises a Rank error.

`/` always produces a real quotient. `//` is floor division and follows Python's
rounding direction for negative values:

```rank
Digit = X % 10
X = X // 10
Ratio = 5 / 2
Floor = -5 // 2
```
