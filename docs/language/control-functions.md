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

## While

```rank
while B not equal 0
    R = A % B
    A = B
    B = R
end
```

## For

Ranges and sequences are ordinary iterable values:

```rank
for i in 1 to 10
    print i
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
    while B not equal 0
        R = A % B
        A = B
        B = R
    end

    return A
end
```

## Varargs

Current vararg syntax uses `*`:

```rank
fun lcm * Numbers
    ...
end
```

Argument expansion uses the same marker:

```rank
Answer = lcm * Range
```

## Integer arithmetic

`%` is remainder.

Current examples treat `/` on integers as integer division:

```rank
Digit = X % 10
X = X / 10
```
