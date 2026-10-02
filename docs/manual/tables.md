# tables manual

## csv

Read a CSV file as a table, or save a
table as CSV.

```rank
use tables
use io
"id\n1\n2\n" "rows.csv" write
T = "rows.csv" csv
T .id
```

```result
1 2
```

### Usage

```text
Path csv
Table Path csv
```

The first line names the columns. Column
types are worked out from the data.

### See also

table, read

## explain

Show how SQLite plans to run a query.

```rank
use tables
Db = "data.sqlite" sqlite
Q = "SELECT 1 AS n"
P = array shape 0 fill 0
Rows = Db Q P sqlquery
Rows explain
```

### Usage

```text
Query explain
```

Gives a table of plan steps. Useful for
finding slow queries.

### Notes

Needs an existing database file and an
app with SQLite support.

### See also

sql, sqlquery

## labels

The names of a table's columns.

```rank
use tables
use json
Rows = "[{\"id\":1,\"n\":7}]" json
T = Rows table
T labels
```

```result
.id .n
```

### Usage

```text
Table labels
```

### See also

table, select

## table

Turn a list of records into a table with
one column per field.

```rank
use tables
use json
Rows = "[{\"id\":1},{\"id\":2}]" json
T = Rows table
T .id
```

```result
1 2
```

### Usage

```text
Records table
```

Read a column with its label, such as `T
.id`. A field missing from some records
leaves those cells missing.

### See also

csv, json, labels, select

## lookup

For each key, find the matching value in
a pair of lists.

```rank
use tables
Ids = array 2 1
Keys = array 1 2
Vals = array "a" "b"
Ids Keys Vals lookup
```

```result
b a
```

### Usage

```text
Wanted Keys Values lookup
```

Keys and Values have the same length;
the value at each key's position is
returned. If a key appears twice, the
first wins. A key that is not found is
missing, so add default for a fallback.

### See also

leftjoin by, index

## sql

Show the SQL text a query will run, with
its parameters.

```rank
use tables
Db = "data.sqlite" sqlite
Q = "SELECT 1 AS n"
P = array shape 0 fill 0
Rows = Db Q P sqlquery
Rows sql
```

### Usage

```text
Query sql
```

Gives a record; nothing is run.

### Notes

Needs an existing database file and an
app with SQLite support.

### See also

explain, sqlquery

## sqlite

Open a SQLite database file.

```rank
use tables
"data.sqlite" sqlite
```

### Usage

```text
Path sqlite
```

The file must already exist. Data is
read only when you ask for it, so large
databases open instantly.

### Notes

Needs an existing database file and an
app with SQLite support.

### See also

sqlquery, calendar

## sqlquery

Run a SELECT query on a SQLite database
and get a table.

```rank
use tables
Db = "data.sqlite" sqlite
Q = "SELECT 1 AS n"
P = array shape 0 fill 0
Db Q P sqlquery
```

### Usage

```text
Db Query Parameters sqlquery
```

Parameters is a tuple or rank-1 array.
Use a tuple for different value types.
Each ? is filled from it in order. Passing values
this way keeps them safe from SQL
injection. Only reading queries are
allowed.

### Notes

Needs an existing database file and an
app with SQLite support.

### See also

sqlite, sql, explain
