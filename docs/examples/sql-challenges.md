# SQL challenge roadmap

We will solve these collections in order, using the
[example workflow](../design/example-workflow.md) for each task:

1. [PostgreSQL Exercises](https://www.pgexercises.com/) — start with selection,
   then joins, aggregates and later window queries. Its country-club data and
   expected SQL results give us small relational examples. Solve them against
   a local SQLite copy. All twelve [Basic](../../demos/pgexercises/basic/README.md),
   eight [Joins and Subqueries](../../demos/pgexercises/joins/README.md),
   nine [Updates](../../demos/pgexercises/updates/README.md), twenty-two
   [Aggregates](../../demos/pgexercises/aggregates/README.md), ten
   [Date](../../demos/pgexercises/date/README.md), and seven
   [String](../../demos/pgexercises/string/README.md) and three
   [Recursive](../../demos/pgexercises/recursive/README.md) exercises have
   runnable Rank solutions and SQLite reference tests.
2. [SQL Murder Mystery](https://github.com/NUKnightLab/sql-mysteries) — solve
   the investigation against its SQLite database. This stage will reuse the
   SQLite table source and exercise joins and other translations added during
   PostgreSQL Exercises.
3. [TPC-H](tpch.md) — Q6 now has a runnable SQLite program and SQL reference
   test. Work through later analytical queries with generated data and
   reference SQL results after the small deterministic tests.

For every task, record the source and expected result, write a Rank solution,
and add a neighboring `_test.ra` file, or a CLI test when opening a database is
the behavior under test. Use small deterministic data. Compare
results with the reference SQL query, including duplicate rows, missing values
and ordering when the query specifies an order. Keep downloaded databases and
generated large data local rather than committing them. Propose any new
language or standard-library feature to the language owner before implementing
it, as required by the example workflow.
