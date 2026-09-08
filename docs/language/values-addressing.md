# Values and addressing

Rank uses whitespace-based application and addressing.

## General form

```rank
A i
A i j
Data .Age
index Key
A sum
A B gcd
```

Conceptually, the value comes first and selectors follow.

When the final word resolves to a function, preceding values are its data. Thus
`A B` is addressing, while `A B gcd` calls `gcd` with `A` and `B`. Resolution
may use the arity and value roles registered by the imported vocabulary, but it
does not change the parsed source structure.

The fundamental selection model is:

```text
value + selector -> value
```

## Mathematical compact indexing

For compact mathematical code, a capital letter followed by lowercase indices
denotes indexed access:

```rank
Ai
Aij
DPij
```

Examples:

```rank
DP00 = true
DPij = DPi q
```

This convention is intended for short mathematical object names. Longer names
continue to use ordinary spaced addressing.

## Iteration with value and index

```rank
for Ai in A
    Ai print
    i print
end
```

`Ai` binds the current value and `i` is automatically bound to its index.

## Boolean addressing

Boolean masks are ordinary first-class values.

They can be stored:

```rank
Mask = A greater 0
```

and used as selectors:

```rank
Positive = A Mask
```

For tables:

```rank
Mask = Data .Age greater 18
Adults = Data Mask
```

Boolean addressing does not mutate the original value.

To explicitly replace it, use ordinary assignment:

```rank
Data = Data Mask
```

Masks can be composed before they are applied:

```rank
M3 = N % 3 equal 0
M5 = N % 5 equal 0

Selected = N (M3 or M5)
```

A named selector does not need parentheses:

```rank
Selected = N Mask
```

Parentheses are used when the selector itself is a compound expression:

```rank
Selected = N (M3 or M5)
```

Boolean masks may also be used for assignment:

```rank
Negative = Pred less 0
Pred Negative = 0
```

## Slices and ranges

Ranges are first-class sequences.

```rank
1 to 10
1 until 10
```

`to` includes the endpoint.

```text
1 to 3
=> 1 2 3
```

`until` excludes the endpoint.

```text
1 until 3
=> 1 2
```

Ranges can be selectors:

```rank
Part = Text L to R
Part = A L until R
```

## Padding and defaults

`pad` provides a value when data is absent:

```rank
X = A i pad 0
Last = index Key pad -1
Age = Data .Age pad Median
```

The same concept covers:
- out-of-bounds array access;
- missing keyed values;
- missing table values.

`pad` is non-mutating. To store the result:

```rank
Data .Age = Data .Age pad Median
```
