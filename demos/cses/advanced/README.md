# Advanced Techniques

Problems from the [CSES Problem Set](https://cses.fi/problemset/).

- [Corner Subgrid Count](004_cornercount.ra) uses boolean row intersections and
  `count axis 1` to batch intersections with the remaining rows. Packed words
  reduce the work inside each intersection; all row pairs are still examined. See the packed-boolean benchmark results for
  measured time and memory at size 3000; this is not a claim of meeting CSES's
  one-second time limit.
