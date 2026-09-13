# PostgreSQL Exercises: date

The [Date questions](https://pgexercises.com/questions/date/) use the same
ignored SQLite database as [Basic](../basic/README.md). Work through them in
published order; the exercises below are runnable with the current Rank date
library. Date values have no time zone.

| # | Question | Rank program |
|---|---|---|
| 1 | [Timestamp literal](https://pgexercises.com/questions/date/timestamp.html) | [001](001_timestamp.ra) |
| 2 | [Subtract timestamps](https://pgexercises.com/questions/date/interval.html) | [002](002_interval.ra) |
| 3 | [October calendar](https://pgexercises.com/questions/date/series.html) | [003](003_calendar.ra) |
| 4 | [Day of month](https://pgexercises.com/questions/date/extract.html) | [004](004_day.ra) |
| 5 | [Seconds between timestamps](https://pgexercises.com/questions/date/interval2.html) | [005](005_seconds.ra) |
| 6 | [Days in each month](https://pgexercises.com/questions/date/daysinmonth.html) | [006](006_monthlen.ra) |
| 9 | [Bookings by month](https://pgexercises.com/questions/date/bookingspermonth.html) | [009](009_monthly.ra) |

Question 3 stays a lazy SQLite view until CSV output. Its generated calendar
includes both endpoints. The [CLI oracle](../../../packages/cli/test/pgexercises-date.test.mjs)
checks all six outputs, including the 31 calendar rows and the generated SQL.
Questions 2 and 5 use exact `datetime` subtraction and `duration seconds`;
the oracle also checks this subtraction on SQLite columns and a bound literal.
Question 6 is pure calendar arithmetic, so it builds an array of month starts
and writes true Rank durations to CSV.
Question 9 groups the SQLite bookings view by `monthstart` and remains lazy
through grouping, sorting and projection.
