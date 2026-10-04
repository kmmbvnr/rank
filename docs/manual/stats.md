# stats manual

## correlation

How closely measurements rise and fall
together, from -1 to 1.

The second row is always twice the
first, so every pair correlates
perfectly.

```rank
use stats
X = array shape 2 3
  1 2 3
  2 4 6
end
C = X correlation
C 0 1
```

```result
1
```

### Usage

```text
Measurements correlation
```

Each row is one kind of measurement and
each column one observation. The result
is a square matrix: row i, column j
compares measurement i with measurement
j. Needs at least two observations.

### Notes

A row that never changes has no
correlation with anything; its cells
come out as nan.

### See also

corr, covariance

## corr

Short for correlation.

```rank
use stats
X = array shape 2 3
  1 2 3
  2 4 6
end
C = X corr
C 0 1
```

```result
1
```

### Usage

```text
Measurements corr
```

### See also

correlation

## covariance

How much measurements vary together, in
their own units.

```rank
use stats
X = array shape 2 3
  1 2 3
  2 4 6
end
C = X covariance
C 0 1
```

```result
2
```

### Usage

```text
Measurements covariance
```

Each row is one kind of measurement and
each column one observation. Gives a
square matrix. Divides by N − 1, as is
usual for a sample.

### See also

correlation, variance

## mae

Mean absolute error: the average size of
the gap between predictions and true
values.

The gaps are 1 and 2, so the average is
1.5.

```rank
use stats
A = array 1 2
B = array 2 4
A B mae
```

```result
1.5
```

### Usage

```text
Predicted Actual mae
```

### See also

mse, mean

## mean

The average: the sum divided by the
count.

```rank
use stats
(array 1 2 2 4) mean
```

```result
2.25
```

### Usage

```text
Values mean
```

In a table column, missing cells are
skipped.

### See also

median, mode, sum

## median

The middle value once the values are
sorted.

With an even count, the median averages
the two middle values.

```rank
use stats
(array 1 2 2 4) median
```

```result
2
```

### Usage

```text
Values median
```

Less affected than the mean by a few
extreme values. Needs at least one
value.

### See also

mean, quantile, percentile

## mode

The value that appears most often.

```rank
use stats
(array 1 2 2 4) mode
```

```result
2
```

### Usage

```text
Values mode
```

Works on any values that can be
compared, including text. In a table
column, missing cells are skipped.

### See also

mean, median, add

## mse

Mean squared error: the average of the
squared gaps between predictions and
true values.

The gaps are 1 and 2; their squares
average to 2.5.

```rank
use stats
A = array 1 2
B = array 2 4
A B mse
```

```result
2.5
```

### Usage

```text
Predicted Actual mse
```

Squaring makes large errors count much
more than small ones.

### See also

mae

## percentile

The value below which a given percent of
the data falls.

```rank
use stats
(array 1 2 2 4) 25 percentile
```

```result
1.75
```

### Usage

```text
Values Percent percentile
```

Percent runs from 0 to 100; 50 is the
median. Same as quantile with a
percentage.

### See also

quantile, median

## quantile

The value below which a given fraction
of the data falls.

```rank
use stats
(array 1 2 2 4) 0.25 quantile
```

```result
1.75
```

### Usage

```text
Values Fraction quantile
```

Fraction runs from 0 to 1; 0.5 is the
median. Between two data points, the
answer is interpolated.

### See also

percentile, median

## skew

Short for skewness.

```rank
use stats
(array 1 2 2 4) skew
```

```result
0.6520236646847543
```

### Usage

```text
Values skew
```

### See also

skewness

## skewness

How lopsided the data is around its
mean.

A long tail to the right gives a
positive number.

```rank
use stats
(array 1 2 2 4) skewness
```

```result
0.6520236646847543
```

### Usage

```text
Values skewness
```

Zero means symmetric; negative means a
longer tail to the left. Needs several
values.

### See also

skew, std

## std

Standard deviation: how far values
typically are from the mean.

```rank
use stats
(array 1 2 2 4) std
```

```result
1.0897247358851685
```

### Usage

```text
Values std
```

The square root of variance. Divides by
N, treating the values as the whole
population. In a table column, missing
cells are skipped.

### See also

variance, mean

## var

Short for variance.

```rank
use stats
(array 1 2 2 4) var
```

```result
1.1875
```

### Usage

```text
Values var
```

### See also

variance

## variance

The average squared distance from the
mean.

```rank
use stats
(array 1 2 2 4) variance
```

```result
1.1875
```

### Usage

```text
Values variance
```

Divides by N, treating the values as the
whole population. In a table column,
missing cells are skipped.

### See also

var, std, covariance
