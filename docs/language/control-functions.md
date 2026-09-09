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

For a tensor, ordinary iteration yields cells along its leading axis. Explicit
cell-rank and axis iteration are defined in [Tensors](tensors.md).

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

Calls use Rank's data-first order. Arguments come first and the function name
is the final word:

```rank
G = A B gcd
Result print
```

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

`%` is remainder.

`/` always produces a real quotient. `//` is floor division and follows Python's
rounding direction for negative values:

```rank
Digit = X % 10
X = X // 10
Ratio = 5 / 2
Floor = -5 // 2
```
