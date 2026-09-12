# PostgreSQL Exercises: Updates

All nine [Modifying data](https://www.pgexercises.com/questions/updates/)
questions are solved in published order. Each Rank program requires a path to
an existing SQLite database. The official club database is prepared as in
[Basic](../basic/README.md) and stays under the ignored `../data/` directory.

| # | Question | Rank program |
|---|---|---|
| 1 | [Insert one facility](https://www.pgexercises.com/questions/updates/insert.html) | [001](001_spa.ra) |
| 2 | [Insert two facilities](https://www.pgexercises.com/questions/updates/insert2.html) | [002](002_spa2.ra) |
| 3 | [Calculated facility ID](https://www.pgexercises.com/questions/updates/insert3.html) | [003](003_nextid.ra) |
| 4 | [Fix initial outlay](https://www.pgexercises.com/questions/updates/update.html) | [004](004_outlay.ra) |
| 5 | [Update both tennis courts](https://www.pgexercises.com/questions/updates/updatemultiple.html) | [005](005_prices.ra) |
| 6 | [Price from another row](https://www.pgexercises.com/questions/updates/updatecalculated.html) | [006](006_from1.ra) |
| 7 | [Delete bookings](https://www.pgexercises.com/questions/updates/delete.html) | [007](007_clear.ra) |
| 8 | [Delete member 37](https://www.pgexercises.com/questions/updates/deletewh.html) | [008](008_mem37.ra) |
| 9 | [Delete unused members](https://www.pgexercises.com/questions/updates/deletewh2.html) | [009](009_unused.ra) |

Each program changes its database. To run one against the official data,
copy the database first:

```sh
cp demos/pgexercises/data/club.sqlite3 demos/pgexercises/data/updates_trial.sqlite3
npm run rank -- demos/pgexercises/updates/001_spa.ra \
  demos/pgexercises/data/updates_trial.sqlite3
```

Use a fresh copy for each program: the exercises all start from the same club
state. The original database and trial copies remain ignored. The
[CLI oracle](../../../packages/cli/test/pgexercises-updates.test.mjs) creates
small temporary databases and compares all three tables after each program
with its reference SQL. It also checks that `sql` and `explain` previews do
not write.

The solutions use records, filtered SQLite views and direct `insert`, `update`
and `delete` operations. The third exercise uses SQLite `max`; the ninth keeps
its booked-ID subquery lazy with `not in`. The sixth reads two scalar prices
from the first court before updating the second; it never loads all facilities.
