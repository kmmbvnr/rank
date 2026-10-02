# grids manual

## neighbors

The cells next to a cell of a grid, as
row and column pairs.

The middle of a 3×3 grid has four
neighbours: below, right, above and
left.

```rank
use grids
G = array shape 3 3 fill 0
N = G 1 1 neighbors
N 0
```

```result
1 2
```

### Usage

```text
Grid Row Column neighbors
Grid Row Column .eight neighbors
```

Rows and columns start at zero. By
default, only the four cells sharing a
side count; .eight adds the diagonals.
Cells outside the grid are left out.

### See also

segments, bfs

## segments

Every straight line of N cells in a
grid: across, down and diagonal.

```rank
use grids
G = array shape 2 2
  1 2
  3 4
end
S = G 2 segments
S 0
```

```result
1 2
```

### Usage

```text
Grid Width segments
```

Each segment is one row of the result,
holding its values. Lines never wrap
around an edge.

### See also

neighbors, window
