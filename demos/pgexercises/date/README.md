# PostgreSQL Exercises: date

The [Date questions](https://pgexercises.com/questions/date/) use the same
ignored SQLite database as [Basic](../basic/README.md). Work through them in
published order; the exercises below are runnable with the current Rank date
library. Date values have no time zone.

| # | Question | Rank program |
|---|---|---|
| 1 | [Timestamp literal](https://pgexercises.com/questions/date/timestamp.html) | [001](001_timestamp.ra) |
| 3 | [October calendar](https://pgexercises.com/questions/date/series.html) | [003](003_calendar.ra) |
| 4 | [Day of month](https://pgexercises.com/questions/date/extract.html) | [004](004_day.ra) |

Question 3 stays a lazy SQLite view until CSV output. Its generated calendar
includes both endpoints. The [CLI oracle](../../../packages/cli/test/pgexercises-date.test.mjs)
checks all three outputs, including the 31 calendar rows and the generated SQL.
