# SQLite-backed tables: proposal

This is an interface proposal, not current Rank syntax. It is motivated by the
[PostgreSQL Exercises basic series](../../demos/pgexercises/basic/README.md),
which we will run against SQLite. The first exercise only asks for all rows of
`facilities`; later exercises will expose filters, projections, joins, grouping
and ordering one at a time.

## Values and execution

```rank
use tables

Db = "demos/pgexercises/data/club.sqlite3" sqlite
Facilities = Db .facilities
Rows = Facilities array
```

`sqlite` would open an existing database read-only and return a database value,
not load its tables. Selecting `.facilities` on that value would return a
SQLite-backed table view. Assigning the view to a variable would retain its
database, table name and query plan without reading all rows. The view would
support the same table selectors and operations as an in-memory Rank table
where their semantics match. Postfix `array`, already used to materialize a
sequence, would execute the plan and return an ordinary rank-1 array of object
rows. Ordinary array code would then work as it does today.

This requires a distinct table-view value internally: today's `RankArray` has
a fixed shape and cannot represent an unknown SQLite row count without running
a count query. SQLite `NULL` should become a missing object field, so existing
projection and `pad` behavior applies after materialization. SQLite integers,
reals and text should retain their native Rank scalar types; SQLite's integer
0/1 values should not be guessed to be booleans. An existing database path and
table name should be validated at selection time. Table names come from labels,
are checked against the database schema and are quoted as identifiers; SQL
parameters cannot stand in for identifiers.

## Inspecting the plan

```rank
Statement = Facilities sql
Statement .text print
Statement .params print

Facilities explain print
Rows = Facilities array
```

`sql` would return an object with the exact parameterized SQL text and ordered
bound values that execution will use, without reading result rows. It should
never interpolate bound values into the displayed SQL. `explain` would run
SQLite's [EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html) with the same
bound values and return its rows as
an ordinary Rank table. Its detail text is diagnostic and should not be
asserted verbatim in tests because SQLite may change it between versions.

## Raw SQL escape hatch

```rank
Text = "SELECT * FROM facilities WHERE facid = ?1"
Params = array FacilityId
Result = Db Text Params sqlquery
Rows = Result array
```

`sqlquery` is proposed as an explicit read-only, single-statement SELECT
source. It returns the same table-view type, so `sql`, `explain` and `array`
work on it. Its parameter argument is mandatory, including `array` for a query
without placeholders. Every supplied value must be bound by SQLite's prepared
statement [binding API](https://www.sqlite.org/lang_expr.html#varparam);
mismatched placeholder counts and unsupported value types are
errors. No Rank string interpolation or manual value escaping is involved.
`query` is already a word in `use algo`, so `sqlquery` avoids that collision.
Raw SQL is an escape hatch for a missing translation, not the normal table API.

## Translation history

Start with table lookup and explicit materialization. Then add translation for
existing Rank projection and source-bound filters, followed by grouping,
aggregates, joins and ordering as individual exercises require them. At each
step, `sql` must show the query actually executed. Unsupported operations may
materialize to an ordinary Rank array before running in memory, but they must
not be advertised as pushed down. A SQLite-backed view is read-only; assigning
a computed column to an in-memory array does not update the database. No row
order is promised without an explicit ordering operation.

The interpreter needs a database capability alongside its existing file I/O
abstraction so tests can use a temporary database. The runtime library must
support prepared statements and real value binding. The built-in
[`node:sqlite`](https://nodejs.org/api/sqlite.html)
module starts at Node 22.5, while Rank currently declares Node 20.19 as its
minimum. The first implementation should use a prepared-statement driver
compatible with that minimum rather than silently raising Rank's requirement.

Before implementing, the language owner needs to decide the proposed `sqlite`,
`sql`, `explain`, `sqlquery`, SQLite-view `array` conversion and their semantics.
The precise ordering operation and SQL translation of missing-value predicates
can wait for the exercises that first need them.
