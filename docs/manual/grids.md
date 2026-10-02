# grids manual

## neighbors

### NAME

In-bounds row and column pairs around
one grid cell; four neighbors by
default.

### SYNOPSIS

```text
Grid Row Column .eight neighbors ->
array
Grid: matrix; Row, Column: integers
```

### DESCRIPTION

Row and Column are zero-based integers.
Returns in-bounds coordinate pairs; a
trailing .eight label includes diagonal
neighbors. Begin the program with use
grids.

### EXAMPLES

List the four neighbors of the center
cell.

```rank
use grids
G = array shape 3 3 fill 0
G 1 1 neighbors
```

## segments

### NAME

All in-bounds horizontal, vertical and
diagonal segments of a fixed width.

### SYNOPSIS

```text
Grid Width segments -> array
Grid: matrix; Width: positive integer
```

### DESCRIPTION

Grid is a two-dimensional array. Width
must be positive. Horizontal, vertical
and diagonal segments are included;
segments do not wrap across edges. Begin
the program with use grids.

### EXAMPLES

List straight segments of length two.

```rank
use grids
G = array shape 2 2
  1 2
  3 4
end
G 2 segments
```
