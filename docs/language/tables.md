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

A table source may be refined as part of its definition:

```rank
Data = "data.csv" csv
filter
.Age greater 18
.Score greater 0
end
```

The clause continues the construction of `Data`. It is not a later mutation of
an already-defined table.

Inside the clause, the current collection is implicit. Therefore:

```rank
.Age greater 18
```

means the condition on the `.Age` column of the current table without repeating
`Data`.

Multiple condition lines are combined with logical AND:

```rank
filter
.A greater 0
.B less 10
end
```

corresponds to the combined condition:

```rank
.A greater 0 and .B less 10
```

Separate lines are preferred when AND is all that is needed.

The exact interaction between implicit AND and explicit `or` is not yet fixed.
For complex OR conditions, first-class boolean masks remain the primary,
unambiguous mechanism.

## Grouping

```rank
Groups = Data group by .Sex .Pclass
Rate = Groups .Survived mean
```

`group by` takes one or more field labels separated by spaces. A single key is
`Data group by .Sex`. It returns a grouped view, not nested arrays of rows.
`Groups .Survived mean`, `median`, `std` and `sum` return ordinary rank-1 tables:
one row per key, with the key fields followed by the aggregate field. Groups
appear in first-seen order, and the source rows are captured when `group by`
runs. Missing key cells form one group per key combination. The statistical
reductions skip missing values; when a group has none, its aggregate cell is
missing and may be filled with `pad`. `sum` retains its integer-zero result for
an empty group. Keys must be scalar and cannot be NaN; repeated key fields are
errors.

## Join

Use `leftjoin by` when every left row must remain, or `innerjoin by` for only
matched rows. The same field names on both sides are listed without `array`:

```rank
Forecast = Test Means leftjoin by .store_nbr .family .weekday
```

When corresponding fields have different names, list explicit pairs:

```rank
Matched = Orders Customers innerjoin on .o_custkey = .c_custkey
```

Several pairs may follow `on` in left-to-right order. Keys use Rank's value
equality, so integer `1` and real `1.0` match but text `"1"` does not. Missing
join keys never match. Repeated right keys multiply matching rows. Array-backed
joins preserve left row order and, within each left row, right row order. The
right key columns are omitted; a shared non-key column name raises `.TypeError`
instead of being renamed automatically. Unmatched right fields are missing and
can be projected with `pad`. A nonexistent key field raises `.Missing`.

These operations currently work on rank-1 arrays of object rows. SQLite-backed
table sources and SQL pushdown are future work; a database source will need an
explicit ordering contract where row order matters.

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
