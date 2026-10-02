# stats manual

## correlation

### NAME

Pearson correlation matrix over feature
and observation axes.

### SYNOPSIS

```text
Features correlation -> array
Features: numeric feature-by-observation
matrix, with at least two observations
```

### DESCRIPTION

The first axis holds features and the
second observations. Covariance uses
sample divisor N-1. Correlation
normalizes by feature spread; a constant
feature has no defined correlation.
Values are produced on demand; storing
the result does not force every item.

### EXAMPLES

Compare two features measured in three
observations.

```rank
use stats
X = array shape 2 3
  1 2 3
  2 4 6
end
X correlation
```

## corr

### NAME

Alias for correlation.

### SYNOPSIS

```text
Features corr -> array
Features: numeric feature-by-observation
matrix, with at least two observations
```

### DESCRIPTION

The first axis holds features and the
second observations. Covariance uses
sample divisor N-1. Correlation
normalizes by feature spread; a constant
feature has no defined correlation.
Values are produced on demand; storing
the result does not force every item.

### EXAMPLES

Compare two features measured in three
observations.

```rank
use stats
X = array shape 2 3
  1 2 3
  2 4 6
end
X corr
```

## covariance

### NAME

Sample covariance matrix over feature
and observation axes.

### SYNOPSIS

```text
Features covariance -> array
Features: numeric feature-by-observation
matrix, with at least two observations
```

### DESCRIPTION

The first axis holds features and the
second observations. Covariance uses
sample divisor N-1. Correlation
normalizes by feature spread; a constant
feature has no defined correlation.
Values are produced on demand; storing
the result does not force every item.

### EXAMPLES

Compare two features measured in three
observations.

```rank
use stats
X = array shape 2 3
  1 2 3
  2 4 6
end
X covariance
```

## mae

### NAME

Mean absolute error between two
broadcast numeric values.

### SYNOPSIS

```text
Pred Target mae -> real
Pred, Target: broadcastable numeric
values
```

### DESCRIPTION

Computes the mean of absolute errors.
Numeric arrays broadcast compatible
shapes; the result is real.

### EXAMPLES

Compare predicted values A with target
values B.

```rank
use stats
A = array 1 2
B = array 2 4
A B mae
```

## mean

### NAME

Arithmetic mean, missing table cells
skipped.

### SYNOPSIS

```text
Values mean -> real
Values: finite numeric collection
```

### DESCRIPTION

Adds finite numeric values and divides
by their count. Missing table cells are
skipped.

### EXAMPLES

The arithmetic mean is 2.25.

```rank
use stats
(array 1 2 2 4) mean
```

## median

### NAME

Middle value of a sorted copy, averaging
the two middle values when even.

### SYNOPSIS

```text
Values median -> real
Values: finite numeric collection
```

### DESCRIPTION

Sorts a copy and selects the middle
value; an even count averages the middle
two. Input must contain at least one
numeric value.

### EXAMPLES

The middle two items are both 2.

```rank
use stats
(array 1 2 2 4) median
```

## mode

### NAME

Most frequent value in a collection or
array.

### SYNOPSIS

```text
Values mode -> value
Values: finite comparable collection
```

### DESCRIPTION

Returns the value with greatest
frequency. Missing table cells are
skipped.

### EXAMPLES

2 is the most frequent value.

```rank
use stats
(array 1 2 2 4) mode
```

## mse

### NAME

Mean squared error between two broadcast
numeric values.

### SYNOPSIS

```text
Pred Target mse -> real
Pred, Target: broadcastable numeric
values
```

### DESCRIPTION

Computes the mean of squared errors.
Numeric arrays broadcast compatible
shapes; the result is real.

### EXAMPLES

Compare predicted values A with target
values B.

```rank
use stats
A = array 1 2
B = array 2 4
A B mse
```

## percentile

### NAME

Percentile P in 0..100.

### SYNOPSIS

```text
Values P percentile -> value
Values: numbers; P: real in 0..100
```

### DESCRIPTION

P is between 0 and 100. This is quantile
expressed as a percentage.

### EXAMPLES

Read the 50th percentile: the median.

```rank
use stats
(array 1 2 2 4) 50 percentile
```

## quantile

### NAME

Linear interpolation quantile Q in 0..1.

### SYNOPSIS

```text
Values Q quantile -> value
Values: numbers; Q: real in 0..1
```

### DESCRIPTION

Q is between 0 and 1. Sorts numeric
values and uses linear interpolation
between positions.

### EXAMPLES

Read the 0.5 quantile: the median.

```rank
use stats
(array 1 2 2 4) 0.5 quantile
```

## skew

### NAME

Alias for skewness.

### SYNOPSIS

```text
Values skew -> real
Values: finite numeric collection
```

### DESCRIPTION

Requires enough numeric observations to
compute sample skewness.

### EXAMPLES

Measure sample asymmetry.

```rank
use stats
(array 1 2 2 4) skew
```

## skewness

### NAME

Sample skewness of numeric values.

### SYNOPSIS

```text
Values skewness -> real
Values: finite numeric collection
```

### DESCRIPTION

Measures sample asymmetry around the
mean. Requires enough numeric
observations; symmetric data has zero
skewness.

### EXAMPLES

Measure sample asymmetry.

```rank
use stats
(array 1 2 2 4) skewness
```

## std

### NAME

Population standard deviation, dividing
by N.

### SYNOPSIS

```text
Values std -> real
Values: finite numeric collection
```

### DESCRIPTION

Uses the population divisor N, not the
sample divisor N-1. Missing table cells
are skipped.

### EXAMPLES

Measure population standard deviation.

```rank
use stats
(array 1 2 2 4) std
```

## var

### NAME

Alias for variance.

### SYNOPSIS

```text
Values var -> real
Values: finite numeric collection
```

### DESCRIPTION

Alias for variance, using the population
divisor N.

### EXAMPLES

Measure population variance.

```rank
use stats
(array 1 2 2 4) var
```

## variance

### NAME

Population variance of numeric values.

### SYNOPSIS

```text
Values variance -> real
Values: finite numeric collection
```

### DESCRIPTION

Averages squared deviations from the
mean, using divisor N. Missing table
cells are skipped.

### EXAMPLES

Measure population variance.

```rank
use stats
(array 1 2 2 4) variance
```
