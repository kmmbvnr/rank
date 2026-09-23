# Arrow storage experiment: CSES room allocation

This follows [`demos/cses/sortnsrch/022_rooms.ra`](../../demos/cses/sortnsrch/022_rooms.ra)
without a database or file input. Intervals are generated in memory with
unique, permuted start days and overlapping end days. Equal arrival/departure
days conflict, as in the Rank demo.

Four modes use the same intervals:

- `matrix`: Rank's current `ownedArray` numeric matrix, read by a JS allocator.
- `typed`: a plain interleaved `Float64Array`, read by the same JS allocator.
- `arrow`: an `apache-arrow` v21.2.0 two-column table, read by the same JS
  allocator.
- `rank`: the actual `allocate_rooms` function from the demo on the Rank matrix.

The JS allocator uses the same sort-by-arrival and two-min-heap strategy as
the demo. All modes produce exactly the same room count **and complete room
assignment**. This separates storage-access cost from Rank interpreter cost;
the `rank` query time is not what Arrow-backed Rank would take.

Apple M5, Node v24.15.0, five fresh-process runs per mode and size, alternating
order; medians from 2026-09-23:

| Intervals | Mode | Build ms | Allocate ms | Retained MiB |
| ---: | --- | ---: | ---: | ---: |
| 1,024 | Rank matrix + JS | 0.14 | 1.38 | 0.03 |
| 1,024 | Float64Array + JS | 0.08 | 0.66 | 0.02 |
| 1,024 | Arrow + JS | 1.51 | 1.28 | 0.14 |
| 1,024 | Rank `allocate_rooms` | 0.14 | 16.38 | — |
| 20,000 | Rank matrix + JS | 0.88 | 17.06 | 0.31 |
| 20,000 | Float64Array + JS | 0.83 | 3.02 | 0.31 |
| 20,000 | Arrow + JS | 3.52 | 6.42 | 0.65 |
| 20,000 | Rank `allocate_rooms` | 0.89 | 134.10 | — |
| 100,000 | Rank matrix + JS | 3.86 | 90.08 | 1.53 |
| 100,000 | Float64Array + JS | 3.87 | 11.52 | 1.53 |
| 100,000 | Arrow + JS | 7.28 | 26.46 | 2.09 |
| 100,000 | Rank `allocate_rooms` | 3.99 | 554.55 | — |

Rank setup (parsing/registering the function) was 87–88 ms and is excluded
from `Allocate`. The input and correctness oracle are outside the timed
regions. Memory is post-GC `heapUsed + arrayBuffers` relative to before input
generation, after input columns have been released; it is not peak memory.
Rank-mode memory is omitted because runtime setup and garbage collection make
that delta unsuitable for table comparison.

At 100,000 intervals, Arrow reads faster than the current proxied Rank matrix
in the same JS algorithm, but a plain typed array is about 2.3 times faster
than Arrow and retains less memory. Arrow also costs more to build. Thus this
numeric workload does **not** support Arrow as the best general Rank array
representation. It points to reducing the current matrix-access overhead or
testing typed backing storage. No Arrow-to-Rank integration was implemented.

Run from the isolated worktree after `npm install` and `npm run build`:

```sh
node benchmarks/arrow-room-allocation.mjs
```
