# SQLite query translation roadmap

The [current SQLite interface](../language/tables.md#sqlite) was introduced for
[PostgreSQL Exercises basic 1](../../demos/pgexercises/basic/001_select_all.ra).
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
capability on `RankIo`; the CLI supplies a read-only prepared-statement driver
compatible with Rank's Node 20 minimum. The first exercise has a CLI test that
creates a temporary SQLite database and checks the materialized result.

The [Basic exercises](../../demos/pgexercises/basic/README.md) still show
array-based solutions. [Joins and Subqueries](../../demos/pgexercises/joins/README.md)
now exercise SQL translation for selection, masks, keyed joins, distinct and
ordering. Q6 has a [SQLite program](../../demos/tpch/001_q6_sqlite.ra) that
pushes filters and a scalar `SUM` into the database. These programs and the
SQLite CLI tests compare results with reference SQL on temporary data.

`View Cols select`, where `Cols` is a `record`, now names and computes output
columns in SQL. Tasks 2, 4 and 5 use it to defer the only row read until CSV.
Tasks 6 and 8 still materialize for their row-dependent guest/member price;
task 7 uses an in-memory correlated lookup. The next steps are a conditional
column expression, grouped aggregates, correlated lookups and limits. Preserve an explicit
ordering contract when adding operations after `sort by`; a SQLite subquery
does not promise to retain its source order.
Multiway aliased joins need qualified keys and recursive nested scopes before
a joined view can become another aliased input.

For each step, compare generated SQL and result rows with the reference SQLite
query on small data. Operations that cannot yet be translated should either
materialize clearly before ordinary Rank array work or report that the
SQLite view does not support the operation; `sql` must never imply pushdown
that did not happen. Materialized arrays may be changed in Rank, but the
SQLite source stays read-only.

Open design questions include how a source-bound mask represents SQL `NULL`,
how to retain a stable row order across joins, and where automatic
materialization is preferable to an explicit `array`. Resolve them with the
first exercise that needs each behavior, following the
[example workflow](example-workflow.md).
