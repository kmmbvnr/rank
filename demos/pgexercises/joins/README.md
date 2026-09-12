# PostgreSQL Exercises: joins and subqueries

The eight [Joins and Subqueries](https://pgexercises.com/questions/joins/)
questions are solved in their published order against the local SQLite club
database prepared for [Basic](../basic/README.md). The database and generated
CSV files stay in the ignored `../data/` directory.

| # | Question | Rank program |
|---|---|---|
| 1 | [Member bookings](https://pgexercises.com/questions/joins/simplejoin.html) | [001](001_book.ra) |
| 2 | [Tennis bookings](https://pgexercises.com/questions/joins/simplejoin2.html) | [002](002_tennis.ra) |
| 3 | [Members who recommend](https://pgexercises.com/questions/joins/self.html) | [003](003_recs.ra) |
| 4 | [Members and recommenders](https://pgexercises.com/questions/joins/self2.html) | [004](004_memrec.ra) |
| 5 | [Tennis court users](https://pgexercises.com/questions/joins/threejoin.html) | [005](005_users.ra) |
| 6 | [Costly bookings](https://pgexercises.com/questions/joins/threejoin2.html) | [006](006_costs.ra) |
| 7 | [Recommenders without joins](https://pgexercises.com/questions/joins/sub.html) | [007](007_subrec.ra) |
| 8 | [Costly bookings with a subquery](https://pgexercises.com/questions/joins/tjsub.html) | [008](008_subcost.ra) |

Run the programs from the repository root:

```sh
for file in demos/pgexercises/joins/[0-9][0-9][0-9]_*.ra; do
  npm run rank -- "$file"
done
```

Each program accepts an optional database path and CSV output path. The
[CLI oracle test](../../../packages/cli/test/pgexercises-joins.test.mjs)
creates a temporary SQLite database and compares all eight outputs with
reference SQL. It checks duplicate bookings, duplicate member names, absent
recommenders, date boundaries, ordering, and member versus guest prices without
downloaded data.

All eight tasks use Rank operations on lazy SQLite views. Contextual `filter`
and `select` blocks remove repeated table prefixes and separate column-record
variables. Task 4 keeps short role aliases for its self join. Tasks 6 and 8
use `choose` and `sort by .cost descending`; their full results stay in SQLite
until CSV, with no sort helper column or cleanup materialization. Task 7 uses
`lookup` for a correlated scalar subquery. Task 8 names its priced intermediate.

The CLI oracle also runs the same eight sources against ordinary array tables
and compares them with the SQL references, including order and absent fields.
See the [translation roadmap](../../../docs/design/sqlite-tables.md).
