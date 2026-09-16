# Task corpora

Rank should be tested against real tasks, not designed from a list of imagined
features. Three corpora exercise different parts of the language.

## Numerical scripts

[MATLAB Cody](https://www.mathworks.com/matlabcentral/cody/problems.html)
provides compact array and numerical tasks. Use it to test shapes, axis and
rank behavior, linear algebra, statistics, random values, plotting and file
formats. Its terms and access rules must be checked before copying a task or a
test verbatim.

The existing numerical roadmap proposes a fixed set of 50 tasks. For every
task, record whether it is clear in current Rank, needs a library operation,
exposes a general language problem, or needs an environment feature. See
[Numerical scripting roadmap](numerical-scripting-roadmap.md).

## R data analysis

[Exercism's R track](https://exercism.org/tracks/r) is a structured source of
small exercises covering R idioms. It is useful for vectors, missing values,
tables, grouping, strings, dates, functional operations and statistics.

[Codewars](https://www.codewars.com/) has R kata that can add shorter,
competition-style checks for those same areas. Select tasks manually and record
their source URL and license or reuse conditions.

Start with 20 to 30 Exercism exercises. A task is useful only when the Rank
solution makes the missing capability clear: a library operation, a table
semantic rule, or a language-model gap. Do not copy R's historical behavior
without deciding whether it fits Rank.

## Algorithms and contests

[CSES](https://cses.fi/problemset/) and the existing [Project Euler
examples](../examples/project-euler.md) test a different contract: algorithms,
memory use and execution time at judge-scale inputs. They are the evidence for
`use algo` structures such as Fenwick trees, segment trees, heaps and graph
operations.

A contest task can justify a new primitive only when ordinary Rank misses its
limits by measurement and the primitive keeps the solution readable. The full
admission rule is in the [competitive-programming library
roadmap](competitive-programming-library.md).

## Common record

Keep one entry for every adopted task with:

- source URL, license or reuse condition, and input/output oracle;
- the Rank program and its current status;
- the capability it tests;
- a regression test; and
- a benchmark when time or memory is part of the task.

The three corpora are complementary. Numerical tasks test array programming;
R tasks test data analysis; contest tasks test algorithms and performance.
