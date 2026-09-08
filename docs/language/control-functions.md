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
end
```

The unparenthesized form `for X in A` is always iteration. Parentheses make a
membership expression a loop condition when that distinction is needed:

```rank
for (X in index)
    ...
end
```

Mathematical value/index binding:

```rank
for Ai in A
    Sum = Sum + Ai
end
```

## Functions

```rank
fun gcd A B
    for B not equal 0
        R = A % B
        A = B
        B = R
    end

    return A
end
```

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

## Integer arithmetic

`%` is remainder.

Current examples treat `/` on integers as integer division:

```rank
Digit = X % 10
X = X / 10
```
