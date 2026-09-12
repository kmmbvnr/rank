# PostgreSQL Exercises: basic

The twelve [basic questions](https://pgexercises.com/questions/basic/) are
solved in their published order. They use a local SQLite copy of the club
data, with the PostgreSQL `cd` schema flattened to the SQLite tables
`facilities`, `members` and `bookings`. Keep that database in the ignored
`../data/` directory. The original PostgreSQL data and setup instructions are
on the [Getting Started](https://pgexercises.com/gettingstarted.html) page.

From the repository root, prepare the ignored SQLite database once:

```sh
mkdir -p demos/pgexercises/data
curl -L --fail -o demos/pgexercises/data/clubdata.sql \
  https://raw.githubusercontent.com/AlisdairO/pgexercises/master/database/clubdata.sql
python3 demos/pgexercises/import_clubdata.py
```

The converter expects the official dump's three `COPY` blocks and refuses to
overwrite an existing SQLite file. The current dump produces 9 facilities, 31
members and 4044 bookings. The source dump, database and query output all stay
inside the ignored `data/` directory.

| # | Question | Rank program |
|---|---|---|
| 1 | [All columns](https://pgexercises.com/questions/basic/selectall.html) | [001](001_select_all.ra) |
| 2 | [Specific columns](https://pgexercises.com/questions/basic/selectspecific.html) | [002](002_select_specific.ra) |
| 3 | [Filter rows](https://pgexercises.com/questions/basic/where.html) | [003](003_where.ra) |
| 4 | [Combined conditions](https://pgexercises.com/questions/basic/where2.html) | [004](004_where2.ra) |
| 5 | [String search](https://pgexercises.com/questions/basic/where3.html) | [005](005_string_search.ra) |
| 6 | [Multiple values](https://pgexercises.com/questions/basic/where4.html) | [006](006_multiple_values.ra) |
| 7 | [Classify rows](https://pgexercises.com/questions/basic/classify.html) | [007](007_classify.ra) |
| 8 | [Dates](https://pgexercises.com/questions/basic/date.html) | [008](008_dates.ra) |
| 9 | [Distinct and order](https://pgexercises.com/questions/basic/unique.html) | [009](009_distinct_order.ra) |
| 10 | [Union](https://pgexercises.com/questions/basic/union.html) | [010](010_union.ra) |
| 11 | [Latest date](https://pgexercises.com/questions/basic/agg.html) | [011](011_latest_date.ra) |
| 12 | [Latest members](https://pgexercises.com/questions/basic/agg2.html) | [012](012_latest_members.ra) |

Each numbered `.ra` file opens the database, computes one answer and writes a
CSV result to `../data/`. The programs cover selection, projection, masks,
membership, computed columns, dates, distinct/order/limit, union and maximum
date. [Task 5](005_string_search.ra) uses the parameterized `sqlquery` escape
hatch for SQLite `LIKE`: Rank has no equivalent case-insensitive substring
operation yet. The other tasks materialize the source table and use ordinary
Rank arrays. They do not claim that these operations are pushed down into SQL;
see the [translation roadmap](../../../docs/design/sqlite-tables.md).

Run all answers from the repository root:

```sh
for file in demos/pgexercises/basic/[0-9][0-9][0-9]_*.ra; do
  npm run rank -- "$file"
done
```

The [CLI test](../../../packages/cli/test/pgexercises-basic.test.mjs) builds a
temporary SQLite database and compares every program with its reference SQL
query. It includes a date at the cutoff, duplicate surnames, tied latest
signups and a lowercase `tennis` name. The test needs no downloaded club data.
The ordered task compares row order; the other tasks compare result rows
without assuming a database scan order.
