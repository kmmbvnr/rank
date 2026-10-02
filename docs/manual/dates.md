# dates manual

## date

### NAME

Parses YYYY-MM-DD or truncates a
datetime to its calendar day.

### SYNOPSIS

```text
Text date -> date
Text: valid YYYY-MM-DD text
```

### DESCRIPTION

Dates use the Gregorian calendar. Text
must contain a valid date; datetimes are
local values without a timezone.

### EXAMPLES

Parse a valid leap-day date.

```rank
use dates
"2024-02-29" date
```

## calendar

### NAME

Inclusive daily table; optional database
keeps it as a SQLite view.

### SYNOPSIS

```text
Db Start End calendar -> table
Start, End: date or date text
Db: optional SQLite database
```

### DESCRIPTION

Returns a table with a .date column,
including both endpoints. A start after
the end returns an empty table. A
database operand can create a SQLite
calendar view. Values are produced on
demand; storing the result does not
force every item.

### EXAMPLES

Include February 29 in the daily
calendar.

```rank
use dates
Start = "2024-02-28"
End = "2024-03-01"
Start End calendar
```

## datetime

### NAME

Parses a local timestamp or casts a date
to midnight.

### SYNOPSIS

```text
Value datetime -> datetime
Value: valid datetime text or date
```

### DESCRIPTION

Dates use the Gregorian calendar. Text
must contain a valid date; datetimes are
local values without a timezone.

### EXAMPLES

Parse a local date and time.

```rank
use dates
"2024-02-29 13:05:09" datetime
```

## duration

### NAME

Creates an exact duration from integer
seconds.

### SYNOPSIS

```text
Seconds duration -> duration
Seconds: integer
```

### DESCRIPTION

Seconds is an integer. A duration is an
exact signed time interval, distinct
from a date or datetime. Values are
produced on demand; storing the result
does not force every item.

### EXAMPLES

Represent an interval of 90 seconds.

```rank
use dates
90 duration
```

## day

### NAME

Day of the month of a date or datetime.

### SYNOPSIS

```text
Value day -> integer
Value: date or datetime
```

### DESCRIPTION

Reads a date or local datetime. Months
are numbered 1..12; weekdays are 0 for
Monday through 6 for Sunday.

### EXAMPLES

Read the day of month: 29.

```rank
use dates
D = "2024-02-29" date
D day
```

## hour

### NAME

Hour of a datetime.

### SYNOPSIS

```text
Moment hour -> integer
Moment: local datetime
```

### DESCRIPTION

Reads a date or local datetime. Months
are numbered 1..12; weekdays are 0 for
Monday through 6 for Sunday.

### EXAMPLES

Read the hour: 13.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D hour
```

## minute

### NAME

Minute of a datetime.

### SYNOPSIS

```text
Moment minute -> integer
Moment: local datetime
```

### DESCRIPTION

Reads a date or local datetime. Months
are numbered 1..12; weekdays are 0 for
Monday through 6 for Sunday.

### EXAMPLES

Read the minute: 5.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D minute
```

## month

### NAME

Month of a date or datetime.

### SYNOPSIS

```text
Value month -> integer
Value: date or datetime
```

### DESCRIPTION

Reads a date or local datetime. Months
are numbered 1..12; weekdays are 0 for
Monday through 6 for Sunday.

### EXAMPLES

Read the month number: 2.

```rank
use dates
D = "2024-02-29" date
D month
```

## monthstart

### NAME

Midnight on the first day of the current
month.

### SYNOPSIS

```text
Value monthstart -> datetime
Value: date or datetime
```

### DESCRIPTION

Returns midnight on the first day of the
containing month. Accepts a date or a
local datetime. Values are produced on
demand; storing the result does not
force every item.

### EXAMPLES

Move to the start of February.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D monthstart
```

## nextmonth

### NAME

Midnight on the first day of the
following month.

### SYNOPSIS

```text
Value nextmonth -> datetime
Value: date or datetime
```

### DESCRIPTION

Returns midnight on the first day of the
next month. The change is by calendar
month, not by a fixed number of seconds.
Values are produced on demand; storing
the result does not force every item.

### EXAMPLES

Move to the start of the following
month.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D nextmonth
```

## second

### NAME

Second of a datetime.

### SYNOPSIS

```text
Moment second -> integer
Moment: local datetime
```

### DESCRIPTION

Reads a date or local datetime. Months
are numbered 1..12; weekdays are 0 for
Monday through 6 for Sunday.

### EXAMPLES

Read the second: 9.

```rank
use dates
D = "2024-02-29 13:05:09" datetime
D second
```

## seconds

### NAME

Exact signed number of seconds in a
duration.

### SYNOPSIS

```text
Duration seconds -> integer
Duration: duration
```

### DESCRIPTION

Converts a duration to its signed number
of seconds. Subtracting two datetimes
also produces a duration.

### EXAMPLES

Recover the exact integer 90.

```rank
use dates
D = 90 duration
D seconds
```

## weekday

### NAME

Day of the week, Monday zero through
Sunday six.

### SYNOPSIS

```text
Value weekday -> integer
Value: date or datetime
```

### DESCRIPTION

Reads a date or local datetime. Months
are numbered 1..12; weekdays are 0 for
Monday through 6 for Sunday.

### EXAMPLES

Thursday is weekday 3.

```rank
use dates
D = "2024-02-29" date
D weekday
```

## year

### NAME

Year of a date or datetime.

### SYNOPSIS

```text
Value year -> integer
Value: date or datetime
```

### DESCRIPTION

Reads a date or local datetime. Months
are numbered 1..12; weekdays are 0 for
Monday through 6 for Sunday.

### EXAMPLES

Read the year: 2024.

```rank
use dates
D = "2024-02-29" date
D year
```
