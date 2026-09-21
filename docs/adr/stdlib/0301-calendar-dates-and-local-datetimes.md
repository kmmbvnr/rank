# 0301. Calendar Dates and Local Date-Times (use dates)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Dates Specification, PostgreSQL Exercises Date Test Suite

## Context

Handling calendar dates and timestamps in mainstream dynamic languages is notoriously fraught:
1. **Timezone complexity and silent shifts:** Libraries like JavaScript `Date` or Python `datetime` mix naive and timezone-aware timestamps, leading to subtle bugs where dates shift by one day due to unexpected UTC conversions or daylight saving time transitions.
2. **String-based date math:** Programmers often parse and format strings repeatedly, creating brittle code and slow operations on millions of rows.
3. **Implicit type coercion hazards:** Some database systems implicitly compare strings with timestamps, creating non-portable and locale-dependent behavior.

Rank requires clean, dedicated scalar primitives for dates and local date-times that support exact chronological comparisons, intuitive arithmetic, and field extraction via symbols, without timezone confusion.

## Decision

Rank establishes **First-Class Calendar Dates and Local Date-Times via `use dates`**:

```rank
use dates

Start = "2026-09-20" date
Deadline = Start + 14
DaysLeft = Deadline - Start
```

### 1. Dedicated Scalar Types (`date`, `datetime`)
Rank introduces two first-class scalar types:
- `date`: Represents a civil calendar day (year, month, day) following the proleptic Gregorian calendar.
- `datetime`: Represents a local wall-clock timestamp (year, month, day, hour, minute, second, microsecond).
- Constructors convert ISO-8601 text strings directly:
  ```rank
  D = "2026-09-20" date
  T = "2026-09-20 14:30:00" datetime
  ```

### 2. Symbol Field Extraction
Date and datetime fields are accessed using Rank's standard symbol addressing (ADR-0105):
```rank
Year = D .year
Month = D .month
Day = D .day
Weekday = D .weekday
Hour = T .hour
Minute = T .minute
Second = T .second
```

### 3. Chronological Ordering and Type Safety
- Dates and datetimes form dedicated comparison families.
- Chronological comparisons use Rank's standard comparison words:
  ```rank
  if Today at least Deadline
    ...
  end
  ```
- **Strict type isolation:** Dates and datetimes compare only within their own type. Comparing a `date` with a `datetime` or with a `text` string raises an immediate `.TypeError`. There is no implicit coercion from text.

### 4. Natural Arithmetic and Durations
- Adding an integer $N$ to a `date` adds $N$ calendar days:
  ```rank
  NextWeek = Today + 7
  ```
- Subtracting two dates (`Date2 - Date1`) produces an exact integer representing the difference in days.
- Subtracting two datetimes produces a duration.

### 5. Vectorized Date Operations
Because date comparisons and field extractions have intrinsic rank 0 (ADR-0200), they broadcast automatically over arrays, tables, and SQLite columns:
```rank
RecentMask = Users .Joined at least "2026-01-01" date
ActiveUsers = Users RecentMask
```

## Consequences

### Positive
* **Zero timezone bugs:** Avoids the pitfalls of implicit UTC conversions by focusing strictly on civil calendar dates and local wall-clock timestamps.
* **Readable field access:** Reuses symbol addressing (`D .year`) rather than verbose getter methods (`d.getFullYear()`).
* **Safe tabular integration:** Tables and SQLite views treat dates as typed scalars rather than arbitrary text strings.
* **40-column clarity:** Date math and filtering fit cleanly on single lines.

### Negative / Trade-offs
* **No multi-timezone math in core:** Cross-timezone conversions and leap-second tracking are excluded from the standard date types to preserve simplicity and deterministic reproducibility.
