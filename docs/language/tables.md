# Tables

Tables reuse Rank's normal addressing model.

## Mutation and cached columns

A table has one observable revision for cache invalidation. Changing any field,
replacing a row, or adding or removing a field changes that revision. Dependent
projections and tensor computations check it when their result is next demanded;
a write does not eagerly walk expressions or execute them. This also expires
cached columns whose own values did not change. Row maps detect writes so that the containing table can
be considered changed; this does not promise separate row or column versions.

For example, a cached `Data .Age` projection is refreshed after a write to
`Data .Fare` as well as after a write to `Data .Age`. Start with whole-table
invalidation; more selective reuse would be an optimization, not a requirement
for correct programs. Independent copied arrays remain independent.

## SQLite

With `use tables`, an existing SQLite database can be opened read-only:

```rank
Db = "demos/pgexercises/data/club.sqlite3" sqlite
Facilities = Db .facilities
Query = Facilities sql
Rows = Facilities array
```

To inspect the SQL and plan in a program, add `use io` and print
`Query .text` or `(Facilities explain) .detail`.

`Db .facilities` validates the table name and returns a SQLite-backed table
view without loading rows. The variable keeps the database path and query plan.
`Query` is a record with `.text` (parameterized SQL) and `.params` (an ordered
array of bound values). `Facilities explain` runs `EXPLAIN QUERY PLAN` and
returns an ordinary Rank table of plan rows. Postfix `array` executes the query
and returns a rank-1 array of object rows; after that, normal Rank table
operations apply. SQLite `NULL` becomes an absent object field, integer 0/1
stays integer, and row order is unspecified unless the SQL query orders it.

The same table addressing and operators build a query without reading rows:

```rank
Bookings = (Db .bookings) (array .memid .starttime)
Members = (Db .members) (array .memid .firstname .surname)
Joined = Bookings Members innerjoin by .memid
David = (Joined .firstname equal "David") and (Joined .surname equal "Farrell")
Result = (Joined David) (array .starttime)
Statement = Result sql
Result "bookings.csv" csv
```

For a self join, give each use of a table a short role name:

```rank
M = Db .members alias .m
R = Db .members alias .r
J = M R leftjoin on
  .recommendedby equal .memid
Rows = J array
Names = Rows .r .firstname pad ""
```

`alias` accepts a rank-1 array table or SQLite view. Both sides of an aliased
join must have different aliases and the same storage kind. Each result row has
one nested object per matched side: `.m .firstname` and `.r .firstname` remain
distinct without renaming either source column. A left row with no match has no
`.r` object, so a nested projection can use `pad`. For a SQLite view, `J` is
still lazy and `J sql` shows a query with the self join; `array` reads its rows.
The alias changes only the Rank result shape, never the database schema.
An already joined SQLite view cannot itself be aliased yet; multiway joins of
nested views need qualified join keys and nested scope composition.

An ordered `record` names output columns and holds their source expressions:

```rank
Cols = record
  .memfname = J .m .firstname
  .recfname = J .r .firstname
end
Out = J select Cols
```

`select` returns a new flat view with only those fields, in record order. For a
SQLite view, every expression must come from that exact view; scalar values
are bound parameters. The operation builds `SELECT expression AS name` without
reading rows or changing the database. SQL `NULL` leaves the output field
absent, so CSV writes an empty cell. On an array table, fields may be scalars
or rank-1 arrays with one value per row; the output rows are read lazily and
missing source cells remain missing. The source table is unchanged. Put
`sort by` after an ordinary `select` when the exported rows need a guaranteed order.

Inside a `select` block, bare `rownumber` gives each row its one-based position:

```rank
R = Members sort by .joindate .memid
Out = R select
  .row_number = rownumber
  .firstname = .firstname
  .surname = .surname
end
```

On an array table it follows the current row order. On a SQLite view it
requires a preceding `sort by` and generates `ROW_NUMBER() OVER (ORDER BY ...)`
with a final output order by the numbered column. It does not read rows before
output. The field name is chosen by the left side of the `select` entry;
`rownumber` is only valid in this context.

Bare `ranknumber` in a `select` block uses the preceding `sort by` keys.
Rows tied on every key receive the same one-based rank, and the next rank
skips the positions occupied by the tie:

```rank
R = Members sort by .hours descending
Out = R select
  .rank = ranknumber
  .hours = .hours
end
```

Both array tables and SQLite views require `sort by` first. SQLite emits
`RANK() OVER (ORDER BY ...)` without reading the rows early. Sorting by a
secondary key breaks ties for ranking too; sort the result afterwards when
you want a separate display order within tied ranks. `ranknumber` is only
valid in a named `select` field.

For a row-dependent column, build a boolean expression and choose between two
values from the same view:

```rank
Guest = Rows .memid equal 0
GCost = Rows .slots * Rows .guestcost
MCost = Rows .slots * Rows .membercost
Cost = Guest GCost MCost choose
```

This stays in SQL as a bound `CASE` expression. An unknown SQL condition gives
an absent cost. `select` can then name the computed column.

`Ids Keys Values lookup` finds the first matching key for each requested ID:

```rank
Ids = Members .recommendedby
Keys = Members .memid
First = Members .firstname + " "
Names = First + Members .surname
Rec = Ids Keys Names lookup
```

For arrays, `Keys` and `Values` must be aligned rank-1 arrays. A rank-1 `Ids`
array produces a lazy rank-1 result; a scalar ID produces one value. The first
match in source order wins, numeric keys compare by value, and a missing key
or unmatched ID leaves the result cell absent. Source changes invalidate a
derived result. For SQLite, all three operands are column expressions: `Keys`
and `Values` belong to one source view, while `Ids` may belong to another view
of the same database. `lookup` builds a bound correlated scalar subquery, with
no join and no row read until the enclosing view executes. SQL `NULL` or no
match leaves the result field absent. If source keys repeat, SQLite's first
match has no guaranteed order unless the source view has an explicit order;
use unique keys when the answer must be stable.

Selecting one field creates a lazy column expression. Comparing it with a
scalar, combining boolean expressions with `and` or `or`, and using the result
as a table mask extend the SQL plan. Projection with an array of field labels,
`innerjoin by/on`, `leftjoin by/on`, `select`, `lookup`, `unique` and field-keyed `sort by` also
return SQLite views. `len` uses `COUNT(*)`; `sum` of a SQLite column expression
or a product of expressions uses SQL `SUM`. `View from 0 until N` keeps the
first `N` rows as a SQLite `LIMIT` query and checks the bounds against `len`.
`array`, `print` and CSV output execute the
view. `sql` and `explain` inspect the current plan without loading its result
rows. Generated comparisons use bound parameters; field names are checked
against the source schema and quoted. A predicate must come from the exact
table view it filters. Separate views can be joined only when they refer to the
same database file. Numeric SQLite keys match integer and real values, while
numeric and text keys stay distinct as in Rank arrays.

The supported SQLite expression operators are `equal`, `notequal`, `less`,
`greater`, `at least`, `at most`, `and`, `or`, `+`, `-`, `*` and `/`. Division
uses real arithmetic even when both columns hold integers. A scalar
`sum` executes its aggregate; ordinary columns and tables remain lazy until a
terminal operation. Other array operations require explicit `array` for now.
SQLite `NULL` fields are absent when rows are materialized. The database view
cannot be used as a destination for field assignment. SQL
ordering is guaranteed when `sort by` is the final operation before the
terminal read, or when a sorted view is immediately sliced with
`from 0 until N`.

For a query that cannot yet be expressed through Rank's table operations, use
an explicit read-only SQL source with positional bound parameters:

```rank
Text = "SELECT * FROM facilities WHERE facid = ?"
Params = array FacilityId
Result = Db Text Params sqlquery
Rows = Result array
```

`sqlquery` requires exactly one `SELECT` or read-only `WITH` query and a rank-1
parameter array, including an empty array when there are no placeholders.
Values are bound by the SQLite driver, never interpolated into SQL text. Wrong
parameter counts, duplicate result column names and unsupported parameter
types are errors. Table names are selected with labels, checked against the
schema and quoted as identifiers. A SQLite-backed view is read-only; changing
its materialized array never writes to the database. Use `sqlquery` only for
queries not yet expressible through the operations above.

### SQLite writes

`insert`, `update` and `delete` change an existing SQLite database immediately.
They return the number of affected rows. `insert` accepts one or more named
records separated by spaces, or a rank-1 table of rows. A filtered base table
can be updated or deleted; projections, joins and sorts cannot be write targets.

```rank
F = Db .facilities
F insert Spa Squash
T = F filter .facid equal 1
T update
  .initialoutlay = 10000
end
Old = Db .members filter .memid equal 37
Old delete
```

The `update` block uses the input table's fields implicitly, as `select` does.
Its right sides read the row before the write. A record or table supplied to
`insert` names the destination columns; unknown columns and mismatched record
shapes are errors. Values are always bound as SQLite parameters. To inspect a
write without executing it, prefix the same expression with `sql` or `explain`:

```rank
Statement = sql F insert Spa
Plan = explain T delete
```

`Statement` has `.text` and `.params`; `Plan` has SQLite query-plan rows.
`F .facid max` runs the aggregate in SQLite. `not in` accepts a one-column
SQLite view as a subquery, so `Db .members filter .memid not in Booked` stays
lazy. See the [nine worked Updates](../../demos/pgexercises/updates/README.md).

## CSV

Current I/O form:

```rank
Data = "train.csv" csv
```

`csv` reads UTF-8 comma-separated data with a header row and returns a rank-1
array of object rows. Quoted fields may contain commas, line endings and escaped
double quotes. Every data row must have the same field count as the header;
empty and duplicate header names are errors.

Rank infers one fixed type for each column from its nonempty cells. A column is
integer when every value is an integer without ambiguous leading zeroes, real
when every value is numeric, and boolean when every value is exactly `true` or
`false`; otherwise it is text. Empty cells are absent fields and therefore
compose with `pad` when the column is projected:

```rank
Age = Data .Age pad Median
```

Writing mirrors assignment:

```rank
Out "submission.csv" csv
```

Output must be a rank-1 array of object rows. The first row determines column
order. A missing field produces an empty cell, an unexpected field is an error,
and text is quoted when CSV escaping requires it. The file ends with a line
ending.

## Column labels

Literal columns use first-class labels:

```rank
Age = Data .Age
Sex = Data .Sex
```

A variable may hold a label:

```rank
Column = .Age
Values = Data Column
```

## Projection

The first table representation is an array whose cells are objects, such as an
array returned by `json`. With `use tables`, one text or label selector lazily
projects the named field from every object while preserving the source shape:

```rank
Age = Data .Age
Column = "Age"
Age = Data Column
```

The field of each row is read only when the corresponding projected cell is
demanded. A demanded non-object cell raises `.TypeError`; a missing field
raises `.Missing`.

Projection also composes inside a data-first call:

```rank
Count = Data .Age len
```

An ordered rank-1 array of labels or text selects several columns:

```rank
Features = array .Age .Fare .Pclass
X = Data Features
```

The result is a rank-2 `rows × columns` array. Column order and repeated names
are preserved. An empty field array produces an `N × 0` matrix without reading
any row. Selected cells stay lazy: a demanded non-object row raises
`.TypeError`, and a demanded missing field raises `.Missing`.

The selected matrix retains its column names while it remains unchanged.
Writing it with `csv` uses those names as the header, which makes a submission
table a direct column selection:

```rank
Out = Test (array .PassengerId .Survived)
Out "submission.csv" csv
```

CSV output requires selected column names to be unique. Ordinary array
operations return ordinary arrays without the table header metadata.

The same selector can be reused:

```rank
X = Train Features
Xtest = Test Features
```

## Computed columns

```rank
Family = Data .SibSp
Family = Family + Data .Parch + 1

Data .FamilySize = Family
```

The receiver must be a rank-1 table. A scalar value is repeated for every row;
a column value must have the same one-dimensional shape as the table. The right
side is read completely before any row changes, so replacing a column from its
own projection is well-defined. Rows are open objects, so assignment may add a
new field. Compound assignment requires the field to exist in every row.

## Missing values

`pad` is used instead of a table-specific `fill`:

```rank
Median = Data .Age median
Data .Age = Data .Age pad Median
```

The `mean`, `median` and `std` statistical reductions ignore missing cells in a
projected table column. If no cells remain, they raise `.EmptyReduction`.

## Boolean rows

Boolean masks use the normal addressing model:

```rank
Mask = Data .Age greater 18
Adults = Data Mask
```

The mask is an ordinary first-class value and the source table is not mutated.
Table masks follow the language's demand-driven mask semantics. A planner may
combine their predicates and push them into a table scan, including when the
mask is later used by a reduction or projection.

Explicit replacement uses ordinary assignment:

```rank
Data = Data Mask
```

## Filter clause

`filter` returns another table using a predicate over the input columns:

```rank
Adults = Data filter .Age greater 18

Selected = Data filter
  .Age greater 18
  .Score greater 0
end
```

The input is evaluated once. A leading field path in a condition reads that
input: `.Age` means `Data .Age`. Each condition line uses normal precedence;
the complete lines are combined with AND. An explicit OR stays within its
line. Parentheses allow an expression to span several lines. Empty filter
blocks and assignment in a condition are errors.

The array predicate must be a rank-1 boolean mask with one value per row.
Applying it fixes the matching row positions, as ordinary array masks do.
The result is a rank-1 array view whose rows remain lazy; it retains the table
header, including when no row matches. The input rows are not copied or
changed. SQLite extends its parameterized WHERE plan without reading rows.
Existing missing-cell and SQL NULL predicate behavior is unchanged.

Use `Data = Data filter ...` to keep the next step under the same variable
name. Other references to the input retain the preceding table. The earlier
wiki sketch with `filter` on a separate line after a completed assignment
has been replaced by the forms above.

## Select columns

A short list selects a rank-1 named table, including the one-column case:

```rank
Names = Data select .firstname .surname
One = Data select .surname
```

This is different from a multi-column address such as
`Data (array .Age .Fare)`, which produces a rank-2 numerical matrix.

A block names computed output columns and may use local calculations:

```rank
Out = Rows select
  Guest = .memid equal 0
  GCost = .slots * .guestcost
  MCost = .slots * .membercost
  .member = .firstname + " " + .surname
  .cost = Guest GCost MCost choose
end
Out = Out filter .cost greater 30
```

The input is evaluated once. Field paths at the start of operands read it;
`.m .firstname` reads a nested alias. Explicit receivers such as
`Other .firstname` keep ordinary addressing. Function arity establishes the
argument boundaries before implicit receivers are inserted. Literal labels
used as data can be bound outside the block and passed through a variable.

Uppercase local names see earlier calculations and outer variables, then
shadow them within the block. Their types stay fixed and the bindings do not
escape. Output field definitions all read the original input: defining
`.cost` does not change what `.cost` means later in the same block. Use a
local `Cost` to share its expression, or a following table step to read the
output column. Defining a field changes neither the input nor the database.

Expressions support arithmetic, comparisons, parentheses, arrays, field
access, and pure standard-library calls such as `choose` and `lookup`.
Arbitrary Rank function calls, I/O, random operations, mutation, and nested
query blocks are not supported inside contextual expressions. Function aliases
are checked against the resolved function, so renaming an effectful function
does not bypass the rule. SQLite aggregates inside these expressions are not
supported yet; they must not cause an implicit early query.

Fields may be scalars or rank-1 columns aligned with the input. SQLite column
expressions must come from that input view. Missing source cells stay absent;
scalar values broadcast. Empty output schemas, duplicate names and mismatched
column shapes are errors. Column order follows the source text. Array rows
are lazy and follow source revisions; SQLite builds a bound SELECT plan.

For dynamic columns, use an ordered record of expressions:

```rank
Cols = record
  .name = Rows .firstname
end
Out = Rows select Cols
```

`Rows select Cols` uses the same projection implementation as the block form.
It replaces the former postfix `Rows Cols select` function call; `select` is
now table syntax. General `record`, `choose`, `lookup`, aliases and boolean
addressing retain their independent uses.

Named array tables also preserve their header through `unique` and field-keyed
sorts. `unique` compares the named cells, treats absent cells alike, and keeps
the first matching row. Field sorting accepts object rows as well as records.

## Grouping

```rank
G = Data group by .Sex .Pclass
Totals = G select
  .visits = count
  .survived = .Survived sum
  .rate = .Survived mean
end
```

`group by` takes one or more field labels separated by spaces and returns a
grouped view. A `select` block produces a flat table with the key fields and
named aggregate columns. `count` counts rows; `.field count` counts present
cells. `.field sum`, `min`, `max`, `mean`, `median`, and `std` reduce one field
within each group. A bare reduction of a grouped column is not table syntax.
Ordinary reductions outside this block retain their scalar or tensor meaning.

Array groups appear in first-seen order. Missing key cells form one group per
key combination. Missing aggregate cells are skipped; `sum` yields zero and
`count` yields zero when no cells are present. Other reductions leave the
result cell missing. Keys must be scalar and cannot be NaN; repeated keys and
output names are errors.

On SQLite views, `select` creates one lazy `GROUP BY` query for all requested
columns. `count`, `sum`, `min`, `max`, and `mean` translate to SQLite. `median`
and `std` currently require array tables; SQLite reports an error rather than
reading rows early. Use `sql` and `explain` to inspect the generated query,
`filter` for conditions on totals, and `sort by` for a defined output order.
SQLite grouping does not promise first-seen order.
Arithmetic on SQLite columns also supports `//` through SQLite's `floor`,
including negative quotients.

`rollup by` takes the same ordered key list and adds one subtotal for each key
prefix plus a grand total. For `.facid .month`, it groups by both fields, by
`.facid`, and by no fields. Keys omitted at a subtotal level are absent in the
result, including on an empty input: the grand total still has `count` and
`sum` equal to zero. A real missing source key and a subtotal remain separate
groups even when their visible keys are both absent. On SQLite, this remains a
lazy view built from grouped queries joined with `UNION ALL`; bound source
parameters are retained for every branch. `sort by` places absent key cells
last for both array tables and SQLite views, in ascending and descending order.

```rank
G = Rows rollup by .facid .month
Totals = G select
  .slots = .slots sum
end
Totals = Totals sort by .facid .month
```

`N rolling by .field` orders a table by one field and produces one trailing
group per row: the current row and up to `N-1` predecessors. `N` must be a
positive integer. A `select` block uses the same named reductions as `group by`
and retains the ordering field. On arrays, the ordered result rows are lazy and
respond to source changes. On SQLite, `count`, `sum`, `min`, `max` and `mean`
use an ordered `ROWS` window without reading rows until output; `median` and
`std` are not yet available. `sum` of a frame with no present values is zero.
Equal ordering keys use the source order on arrays; for stable SQLite results,
choose a unique ordering field. Filter *after* the rolling `select` when
earlier rows must contribute to the first displayed result:

```rank
W = Daily 15 rolling by .date
R = W select
  .revenue = .revenue sum
end
R = R filter .date at least August
```

## Join

Use `leftjoin by` when every left row must remain, or `innerjoin by` for only
matched rows. The same field names on both sides are listed without `array`:

```rank
Forecast = Test Means leftjoin by .store_nbr .family .weekday
```

When corresponding fields have different names, list explicit `equal` pairs:

```rank
Matched = Orders Customers innerjoin on
  .o_custkey equal .c_custkey
```

Several pairs may follow `on` in left-to-right order; the line may break just
after `on` to keep the source narrow. With two distinct table aliases, a join
returns nested objects named by those aliases instead of flattening their
columns. Without aliases, the flat result and duplicate-name check remain.
Keys use Rank's value equality, so integer `1` and real `1.0` match but text
`"1"` does not. Missing
join keys never match. Repeated right keys multiply matching rows. Array-backed
joins preserve left row order and, within each left row, right row order. The
right key columns of a flat join are omitted; a shared non-key column name
raises `.TypeError` instead of being renamed automatically. Unmatched right
fields are missing and
can be projected with `pad`. A nonexistent key field raises `.Missing`.

The same joins work on SQLite-backed views and compile to SQL. Sorting a nested
aliased result by its fields still requires materialization; a database source
has no reliable row order without an explicit final sort.

## Labels

With `use tables`, `Table labels` returns a rank-1 array of column labels.
CSV header order is retained even when a column is entirely empty or the CSV
has no data rows. For a table of ordinary objects without a CSV schema, fields
appear in first-seen order across rows. An empty schema-less table returns an
empty array; a non-object row raises `.TypeError`, and a non-rank-1 value raises
`.DimensionMismatch`.

```rank
Features = Train labels
Mask = Features not equal .label
Features = (Features Mask) array
```

## Text columns

Text operations may lift over a whole column:

```rank
Cabin = Train .Cabin pad "U/0/U"
Parts = Cabin "/" split

Train .Deck = Parts 0
Train .Number = Parts 1
Train .Side = Parts 2
```

Rank does not require a pandas-like `.str` namespace.

## Date columns

CSV date columns remain text until explicitly parsed. Date operations then
lift over the resulting column:

```rank
use dates

Times = Data .datetime datetime
Data .hour = Times hour
Data .weekday = Times weekday
Data .month = Times month
Data .year = Times year
```

`date` also takes a datetime and discards its time. On a SQLite datetime
column, `datetime date` compiles to `date(...)`, allowing grouping by calendar
day. `datetime date datetime` compiles to `datetime(date(...))`, producing
midnight without loading the rows. `Start End calendar` creates a rank-1 array
table with one `.date` per inclusive day; `Db Start End calendar` creates the
corresponding lazy SQLite view. Its endpoints are valid ISO dates or Rank date
values. The first day
after the end is excluded, and reversed bounds produce an empty table.

Two `datetime` values can be subtracted to make an exact signed `duration`:

```rank
Start = "2012-08-31 01:00:00" datetime
End = "2012-09-02 00:00:00" datetime
Elapsed = End - Start
Elapsed seconds
```

The result here is `169200`. `datetime` is a local wall-clock value without a
time zone. `duration` prints as days and, when needed, `HH:MM:SS`; `seconds`
returns its integer total. Subtraction and `seconds` work cellwise on arrays.
For a SQLite view, explicitly parsed `datetime` columns subtract through
`unixepoch(...)`; the expression and any timestamp parameters remain in SQL
until output. A date is distinct from a datetime and cannot be subtracted by
this operation.

`monthstart` and `nextmonth` accept a date or datetime and return a datetime
at midnight on the first day of the current or following calendar month:

```rank
Month = Moment monthstart
Next = Moment nextmonth
Length = Next - Month
```

Both operations map lazily over arrays and sequences. On a SQLite date or
datetime expression they stay in SQL as `datetime(..., 'start of month')`
with an additional `'+1 month'` modifier for `nextmonth`. `nextmonth` raises
`.InvalidDate` when its answer would exceed year 9999 on an ordinary value;
SQLite invalid source text yields a missing result.
