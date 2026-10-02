# dates manual

## date

Turn "YYYY-MM-DD" text into a date.

```rank
use dates
"2024-02-29" date
```

```result
2024-02-29
```

### Usage

```text
Text date
Moment date
```

The text must be a real calendar day, so
"2023-02-29" is an error. Given a
datetime, drops the time of day.

### See also

datetime, calendar, year

## calendar

A table with one row for every day
between two dates.

```rank
use dates
use tables
C = "2024-02-28" "2024-03-01" calendar
C .date
```

```result
2024-02-28 2024-02-29 2024-03-01
```

### Usage

```text
Start End calendar
Db Start End calendar
```

Both ends are included; a start after
the end gives an empty table. The column
is called .date. Put a SQLite database
first to create the calendar inside the
database instead.

### See also

date, nextmonth, table

## datetime

Turn "YYYY-MM-DD HH:MM:SS" text into a
date with a time of day.

```rank
use dates
"2024-02-29 13:05:09" datetime
```

```result
2024-02-29 13:05:09
```

### Usage

```text
Text datetime
Date datetime
```

Times are local, with no time zone. A
date becomes midnight of that day.

### Notes

Subtracting two datetimes gives a
duration. Adding a duration to a
datetime moves it: `A + (7200 duration)`
is two hours later.

### See also

date, duration, hour

## duration

A length of time, given in seconds.

```rank
use dates
90 duration
```

```result
00:01:30
```

### Usage

```text
Seconds duration
```

Shown as hours:minutes:seconds. Can be
negative. Add it to a datetime, or get
one by subtracting two datetimes.

### See also

seconds, datetime

## day

The day of the month, from 1 to 31.

```rank
use dates
D = "2024-02-29" date
D day
```

```result
29
```

### Usage

```text
Moment day
```

Works on dates and datetimes.

### See also

month, year, weekday

## hour

The hour of a datetime, from 0 to 23.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D hour
```

```result
13
```

### Usage

```text
Moment hour
```

### See also

minute, second, day

## minute

The minute of a datetime, from 0 to 59.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D minute
```

```result
5
```

### Usage

```text
Moment minute
```

### See also

hour, second

## month

The month number, from 1 for January to
12 for December.

```rank
use dates
D = "2024-02-29" date
D month
```

```result
2
```

### Usage

```text
Moment month
```

Works on dates and datetimes.

### See also

day, year, monthstart

## monthstart

Midnight on the first day of the same
month.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D monthstart
```

```result
2024-02-01 00:00:00
```

### Usage

```text
Moment monthstart
```

Useful for grouping by month.

### See also

nextmonth, month

## nextmonth

Midnight on the first day of the next
month.

```rank
use dates
D = "2024-12-15" date
D nextmonth
```

```result
2025-01-01 00:00:00
```

### Usage

```text
Moment nextmonth
```

Moves by calendar month, so it handles
months of different lengths and the turn
of the year.

### See also

monthstart, calendar

## second

The second of a datetime, from 0 to 59.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D second
```

```result
9
```

### Usage

```text
Moment second
```

### Notes

To turn a duration into a number of
seconds, use seconds instead.

### See also

minute, seconds

## seconds

How many seconds a duration lasts.

```rank
use dates
A = "2024-03-01 00:00:00" datetime
B = "2024-02-29 23:00:00" datetime
A - B seconds
```

```result
3600
```

### Usage

```text
Duration seconds
```

Gives an integer, negative for a
negative duration.

### See also

duration, second

## weekday

The day of the week: 0 for Monday up to
6 for Sunday.

29 February 2024 was a Thursday.

```rank
use dates
D = "2024-02-29" date
D weekday
```

```result
3
```

### Usage

```text
Moment weekday
```

### See also

day, calendar

## year

The year of a date or datetime.

```rank
use dates
D = "2024-02-29" date
D year
```

```result
2024
```

### Usage

```text
Moment year
```

### See also

month, day
