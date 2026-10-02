# linalg manual

## det

The determinant of a square matrix.

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A det
```

```result
6
```

### Usage

```text
Matrix det
```

For a matrix of integers, the answer is
exact. Zero means the matrix has no
inverse.

### See also

inverse, solve

## diag

Build a matrix with given values on its
diagonal, or read a matrix's diagonal.

```rank
use linalg
(array 2 3) diag
```

```result
2 0 0 3
```

### Usage

```text
Values diag
Matrix diag
```

A list becomes a square matrix with
zeros off the diagonal. A matrix gives
back its diagonal as a list.

### See also

det, matmul

## eigh

Eigenvalues and eigenvectors of a
symmetric matrix.

```rank
use linalg
A = array shape 2 2
  2 1
  1 2
end
R = A eigh
R 0
```

```result
1 3
```

### Usage

```text
Matrix eigh
```

The matrix must equal its own transpose.
Gives two items: `R 0` holds the
eigenvalues, smallest first, and `R 1` a
matrix whose columns are the matching
eigenvectors.

### See also

det, transpose

## inverse

The matrix that undoes this one.

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A inverse
```

```result
0.5 0 0 0.3333333333333333
```

### Usage

```text
Matrix inverse
```

The matrix must be square. A matrix with
determinant zero has no inverse, which
is an error.

### Notes

To solve equations, solve is faster and
more accurate than multiplying by the
inverse.

### See also

solve, det, matmul

## matmul

Matrix multiplication.

```rank
use linalg
A = array shape 2 2
  1 2
  3 4
end
B = array 1 1
A B matmul
```

```result
3 7
```

### Usage

```text
A B matmul
```

The number of columns of A must equal
the number of rows of B. This is not the
same as A * B, which multiplies cell by
cell.

### See also

outer, inverse, solve

## solve

Find X in the equations A × X = B.

2x = 4 and 3y = 9, so x = 2 and y = 3.

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A (array 4 9) solve
```

```result
2 3
```

### Usage

```text
A B solve
```

A is a square matrix of coefficients. B
can be a list or a matrix of several
right-hand sides. Equations without a
single solution are an error.

### See also

inverse, matmul, det
