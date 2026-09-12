# PostgreSQL Exercises: joins and subqueries

The eight [Joins and Subqueries](https://pgexercises.com/questions/joins/)
questions are solved in their published order against the local SQLite club
database prepared for [Basic](../basic/README.md). The database and generated
CSV files stay in the ignored `../data/` directory.

| # | Question | Rank program |
|---|---|---|
| 1 | [Member bookings](https://pgexercises.com/questions/joins/simplejoin.html) | [001](001_member_bookings.ra) |
| 2 | [Tennis bookings](https://pgexercises.com/questions/joins/simplejoin2.html) | [002](002_tennis_bookings.ra) |
| 3 | [Members who recommend](https://pgexercises.com/questions/joins/self.html) | [003](003_recommenders.ra) |
| 4 | [Members and recommenders](https://pgexercises.com/questions/joins/self2.html) | [004](004_member_recommenders.ra) |
| 5 | [Tennis court users](https://pgexercises.com/questions/joins/threejoin.html) | [005](005_tennis_members.ra) |
| 6 | [Costly bookings](https://pgexercises.com/questions/joins/threejoin2.html) | [006](006_costly_bookings.ra) |
| 7 | [Recommenders without joins](https://pgexercises.com/questions/joins/sub.html) | [007](007_recommenders_without_join.ra) |
| 8 | [Costly bookings with a subquery](https://pgexercises.com/questions/joins/tjsub.html) | [008](008_costly_bookings_subquery.ra) |

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

These programs use Rank `innerjoin` and `leftjoin` on arrays of rows. Their
SQLite source queries select and rename columns to avoid non-key name
collisions, then materialize with `array`. Joins, masks, calculated columns and
sorting run in Rank, so `sql` does not claim those operations were pushed into
SQLite. Task 7 uses a per-member Rank lookup to mirror the correlated SQL
subquery. Task 8 names the priced intermediate before filtering, corresponding
to the SQL subquery, although Rank also calculates the cost once in task 6.
See the [translation roadmap](../../../docs/design/sqlite-tables.md).
