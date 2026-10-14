# Dyalog Programming Competition 2013

Rank solutions to the 2013 issue tasks, added problem by problem.

- [First odd numbers](001_odds.ra): Problem 1 (#203). `firstOdds` returns the first N positive odd numbers as a vector, including shape `0` for N=0.

- [Passing grades](002_passrate.ra): Problem 2 (#204). `passRate` returns the percentage of grades at least 65. Scalar grades are allowed; an empty vector returns 100.0 as specified by the contest.
- [Word count](003_words.ra): Problem 3 (#205). `wordCount` splits on spaces and counts nonempty fields. Repeated and edge spaces are ignored; punctuation stays inside words.
- [Balanced parentheses](004_balanced.ra): Problem 4, using code-point text
  comparisons at `rank 0`, explicit boolean-to-integer conversion, and a prefix
  scan. Every prefix must have nonnegative depth and the final depth must be
  zero. Other characters contribute zero; empty text is balanced.

- [Identity matrix](005_identity.ra): Problem 5 (#195). `identity` applies outer equality to indices and casts the mask to integers. N=0 retains the matrix shape `0 0`.

- [Global numeric range](006_range.ra): Problem 6 (#196). `numericRange` flattens every axis and computes maximum minus minimum, returning one real scalar. Empty arrays and scalars return 0.0; integer differences are computed before conversion to real.

- [Fractional values](007_fractional.ra): Problem 7 (#197). `fractionalValues` selects values whose remainder modulo 1 is nonzero, preserving order and duplicates. Integer-valued reals are excluded; empty vectors remain rank 1.

- [Multiplication table](008_times.ra): Problem 8 (#198). `timesTable` takes the outer product of indices 1 through N. The empty result retains matrix shape `0 0`.

- [Moving averages](009_moving.ra): Problem 9 (#199). `movingAverage N A` sums overlapping windows at rank 1 and divides by their length. Windows longer than the input and empty inputs yield empty vectors. Nonpositive lengths raise `.InvalidWindow`.

Run `rank demos/dyalog/2013/004_balanced.ra`, or verify the examples with
`rank test demos/dyalog/2013/004_balanced_test.ra`. Import `balanced` with
`use "004_balanced"`. Text iteration uses Unicode code points, so a combining
mark is a separate element. No character splitting is required.
