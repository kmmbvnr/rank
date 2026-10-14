# Dyalog Programming Competition 2013

Rank solutions to the 2013 issue tasks, added problem by problem.

- [First odd numbers](001_odds.ra): Problem 1 (#203). `firstOdds` returns the first N positive odd numbers as a vector, including shape `0` for N=0.

- [Passing grades](002_passrate.ra): Problem 2 (#204). `passRate` returns the percentage of grades at least 65. Scalar grades are allowed; an empty vector returns 100.0 as specified by the contest.
- [Word count](003_words.ra): Problem 3 (#205). `wordCount` splits on spaces and counts nonempty fields. Repeated and edge spaces are ignored; punctuation stays inside words.
- [Balanced parentheses](004_balanced.ra): Problem 4, using code-point text
  comparisons at `rank 0`, explicit boolean-to-integer conversion, and a prefix
  scan. Every prefix must have nonnegative depth and the final depth must be
  zero. Other characters contribute zero; empty text is balanced.

Run `rank demos/dyalog/2013/004_balanced.ra`, or verify the examples with
`rank test demos/dyalog/2013/004_balanced_test.ra`. Import `balanced` with
`use "004_balanced"`. Text iteration uses Unicode code points, so a combining
mark is a separate element. No character splitting is required.
