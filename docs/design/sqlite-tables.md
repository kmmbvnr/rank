# SQLite query translation roadmap

The [current SQLite interface](../language/tables.md#sqlite) was introduced for
[PostgreSQL Exercises basic 1](../../demos/pgexercises/basic/001_all.ra).
It keeps a database path and a SQL query in a table-view value instead of
loading the whole table into a Rank array. The first view, `Db .facilities`,
compiles to `SELECT * FROM "facilities"`. `sql` exposes that exact text and its
bound parameters; `explain` runs SQLite's
[EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html); postfix `array`
materializes the rows. A raw read-only `sqlquery` source uses
[bound parameters](https://www.sqlite.org/lang_expr.html#varparam), not string
interpolation. The local club database belongs in the ignored
`demos/pgexercises/data/` directory.

This is the first step in a query-translation history, not a claim that all
Rank table operations already run in SQLite. The interpreter has a database
capability on `RankIo`; the CLI supplies prepared statements for reads and
explicit writes, compatible with Rank's Node 20 minimum. The first exercise
has a CLI test that
creates a temporary SQLite database and checks the materialized result.

The [Basic exercises](../../demos/pgexercises/basic/README.md) now keep tasks
1–8 in SQLite until output; task 5 still uses a bound LIKE query. Tasks 9–12
retain explicit local work for limits, union and latest-date calculations.
[Joins and Subqueries](../../demos/pgexercises/joins/README.md) runs all eight
solutions both against SQLite and array tables using the same source and SQL
oracles. All nine [Updates](../../demos/pgexercises/updates/README.md) use
explicit SQLite writes and a database-state oracle. Q6 also has a
[SQLite program](../../demos/tpch/001_q6_sqlite.ra).
The [Aggregates](../../demos/pgexercises/aggregates/README.md) section tests
grouped `select`, `rollup by`, grouped filters, month extraction and sorted slices on SQLite
and arrays. The local source data remains ignored.

Contextual `filter` and `select` blocks build on boolean masks and named
projections. `View select Cols` retains dynamic records while replacing the
old postfix select function. Descending sort removes the negative-cost column
and cleanup materialization from Joins 6 and 8. Task 7 uses `lookup` for a
correlated scalar subquery without a join or early row read. The
[ergonomics decision](table-query-ergonomics.md) records the change.

The final aggregate exercise adds `calendar`, datetime-to-date conversion and
`rolling by` on arrays and SQLite views. Its 15-day result uses a generated day
for every date, then a SQL `ROWS 14 PRECEDING` window before filtering August.

The next steps are tile, general table union and scalar aggregates inside
query expressions. Preserve an explicit ordering
contract when adding operations after `sort by`; a SQLite subquery does not
promise to retain its source order. Multiway aliased joins need qualified keys
and recursive nested scopes before a joined view can become another input.

For each step, compare generated SQL and result rows with the reference SQLite
query on small data. Operations that cannot yet be translated should either
materialize clearly before ordinary Rank array work or report that the
SQLite view does not support the operation; `sql` must never imply pushdown
that did not happen. Materialized arrays may be changed in Rank, but the
SQLite source changes only through explicit `insert`, `update` and `delete`.

Open design questions include how a source-bound mask represents SQL `NULL`,
how to retain a stable row order across joins, and where automatic
materialization is preferable to an explicit `array`. Resolve them with the
first exercise that needs each behavior, following the
[example workflow](example-workflow.md).
