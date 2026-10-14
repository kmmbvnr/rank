# Dyalog Programming Competition 2013

- [Balanced parentheses](004_balanced.ra): Problem 4, using code-point text
  comparisons at `rank 0`, explicit boolean-to-integer conversion, and a prefix
  scan. Every prefix must have nonnegative depth and the final depth must be
  zero. Other characters contribute zero; empty text is balanced.

Run `rank demos/dyalog/2013/004_balanced.ra`, or verify the examples with
`rank test demos/dyalog/2013/004_balanced_test.ra`. Import `balanced` with
`use "004_balanced"`. Text iteration uses Unicode code points, so a combining
mark is a separate element. No character splitting is required.
