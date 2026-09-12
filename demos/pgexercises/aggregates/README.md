# PostgreSQL Exercises: aggregates

The [22 aggregation questions](https://www.pgexercises.com/questions/aggregates/)
use the local SQLite club database from [Basic](../basic/README.md). The
database stays in the ignored `../data/` directory.

Thirteen questions have runnable Rank solutions. The first two counts and the
seventh, distinct-member count, print scalars. Grouped sums stay in SQLite
until CSV output. The same table programs also run on arrays. Questions 12,
14–16 and 18–22 still need table features discussed in the
[translation roadmap](../../../docs/design/sqlite-tables.md).

| # | Question | Rank program |
|---|---|---|
| 1 | [Facilities](https://pgexercises.com/questions/aggregates/count.html) | [001](001_count.ra) |
| 2 | [Expensive facilities](https://pgexercises.com/questions/aggregates/count2.html) | [002](002_costly.ra) |
| 3 | [Recommendations per member](https://pgexercises.com/questions/aggregates/count3.html) | [003](003_recs.ra) |
| 4 | [Slots per facility](https://pgexercises.com/questions/aggregates/fachours.html) | [004](004_slots.ra) |
| 5 | [September slots](https://pgexercises.com/questions/aggregates/fachoursbymonth.html) | [005](005_sept.ra) |
| 6 | [Monthly slots](https://pgexercises.com/questions/aggregates/fachoursbymonth2.html) | [006](006_months.ra) |
| 7 | [Members with bookings](https://pgexercises.com/questions/aggregates/members1.html) | [007](007_booked.ra) |
| 8 | [Facilities over 1000 slots](https://pgexercises.com/questions/aggregates/fachours1a.html) | [008](008_over1k.ra) |
| 9 | [Facility revenue](https://pgexercises.com/questions/aggregates/facrev.html) | [009](009_rev.ra) |
| 10 | [Revenue under 1000](https://pgexercises.com/questions/aggregates/facrev2.html) | [010](010_lowrev.ra) |
| 11 | [Top facility](https://pgexercises.com/questions/aggregates/fachours2.html) | [011](011_top.ra) |
| 13 | [Hours per named facility](https://pgexercises.com/questions/aggregates/fachours3.html) | [013](013_hours.ra) |
| 17 | [Top facility including ties](https://pgexercises.com/questions/aggregates/fachours4.html) | [017](017_ties.ra) |

Run a program from the repository root:

```sh
npm run rank -- demos/pgexercises/aggregates/001_count.ra
```

The [CLI oracle](../../../packages/cli/test/pgexercises-aggregates.test.mjs)
compares all thirteen solutions with equivalent SQLite queries on a temporary
database, including empty tables, repeated IDs, null recommenders and date
boundaries. Grouped solutions run against both SQLite and array tables.
