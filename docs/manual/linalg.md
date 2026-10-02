# linalg manual

## det

### NAME

Determinant of a square numeric matrix,
exact for integers.

### SYNOPSIS

```text
Matrix det -> number
Matrix: square numeric matrix
```

### DESCRIPTION

Input is a square numeric matrix. An
empty 0-by-0 matrix has determinant 1.
Begin the program with use linalg.

### EXAMPLES

The determinant of this diagonal matrix
is 6.

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A det
```

## diag

### NAME

Diagonal matrix from a vector, or the
main diagonal of a matrix.

### SYNOPSIS

```text
Values diag -> array
Values: numeric vector or matrix
```

### DESCRIPTION

A vector builds a diagonal matrix; a
matrix extracts its diagonal. Begin the
program with use linalg.

### EXAMPLES

Build a diagonal matrix with diagonal 2,
3.

```rank
use linalg
(array 2 3) diag
```

## eigh

### NAME

Ascending eigenvalues and their
eigenvector columns of a symmetric
matrix.

### SYNOPSIS

```text
Matrix eigh -> array
Matrix: real symmetric square matrix
```

### DESCRIPTION

Input is a real symmetric square matrix.
Returns values and vectors in a result
record. Begin the program with use
linalg.

### EXAMPLES

Find the symmetric matrix eigenvalues
and eigenvectors.

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A eigh
```

## inverse

### NAME

Inverse of a square matrix, one trailing
cell at a time.

### SYNOPSIS

```text
Matrix inverse -> array
Matrix: square numeric matrix
```

### DESCRIPTION

Input is a square numeric matrix. A
singular matrix has no inverse and
raises an error. Values are produced on
demand; storing the result does not
force every item. Begin the program with
use linalg.

### EXAMPLES

Invert the diagonal matrix.

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A inverse
```

## matmul

### NAME

Contracts the last axis of the left
array with the first axis of the right.

### SYNOPSIS

```text
A B matmul -> array
A, B: numeric arrays with matching
contracted axis lengths
```

### DESCRIPTION

Contracts the last axis of the left
operand with the first axis of the
right. These axis lengths must agree;
this is not elementwise multiplication.
Values are produced on demand; storing
the result does not force every item.
Begin the program with use linalg.

### EXAMPLES

Multiply the matrix by itself.

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A A matmul
```

## solve

### NAME

Solves A * X = B for a square
coefficient matrix.

### SYNOPSIS

```text
A B solve -> array
A: square numeric matrix
B: numeric vector or matrix
```

### DESCRIPTION

The coefficient matrix is square. The
right-hand side may be a vector or
matrix with matching leading length.
Singular systems raise an error. Begin
the program with use linalg.

### EXAMPLES

Solve A times X = [4, 9], giving [2, 3].

```rank
use linalg
A = array shape 2 2
  2 0
  0 3
end
A (array 4 9) solve
```
