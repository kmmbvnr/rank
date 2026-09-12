# Tables

Tables reuse Rank's normal addressing model.

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

Multiple-column table views remain future work. The intended direction is:

```rank
X = Data .Age .Fare .Pclass
```

A sequence of labels can be used as a reusable selector:

```rank
Features =
  .Age .Fare .Pclass

X = Train Features
Xtest = Test Features
```

These future selectors will extend the same addressing model rather than add a
separate query syntax.

## Computed columns

```rank
Family = Data .SibSp
Family = Family + Data .Parch + 1

Data .FamilySize = Family
```

## Missing values

`pad` is used instead of a table-specific `fill`:

```rank
Median = Data .Age median
Data .Age = Data .Age pad Median
```

Statistical reductions on table columns are expected to ignore `missing` by
default unless explicitly configured otherwise.

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
Keys =
  .Sex .Pclass

Groups = Data Keys group
Rate = Groups .Survived mean
```

`group` returns a grouped view suitable for reductions.

## Join

Relational joins are fundamental table operations:

```rank
Forecast = Test Keys Means join
```

Exact join variants and collision rules remain an open design detail.

## Labels

The table schema itself is accessible as labels:

```rank
Features = Train labels
Mask = Features not equal .label
Features = Features Mask
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

Date operations also lift naturally:

```rank
Data .hour = Data .datetime hour
Data .weekday = Data .datetime weekday
Data .month = Data .datetime month
Data .year = Data .datetime year
```
