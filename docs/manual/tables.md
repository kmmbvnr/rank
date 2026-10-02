# tables manual

## csv

### NAME

Reads a CSV file into a rank-1 table, or
writes a table to a path.

### SYNOPSIS

```text
Path csv -> table
Path: text; optional Table: table
```

### DESCRIPTION

A path reads a table, inferring its
columns from the file. A table and path
write CSV; both require host file
access.

### EXAMPLES

Read a CSV file with one id row.

```rank
use tables
use io
"id\n1\n" "rows.csv" write
"rows.csv" csv
```

## explain

### NAME

SQLite query plan rows for a prepared
query view.

### SYNOPSIS

```text
Query explain -> table
Query: SQLite-backed table view
```

### DESCRIPTION

Input is a SQLite-backed query view.
Requires an existing database and a host
with SQLite support.

### EXAMPLES

Ask SQLite for its query-plan rows.

```rank
use tables
Db = "data.sqlite" sqlite
Q = "SELECT 1 AS n"
P = array shape 0 fill 0
Rows = Db Q P sqlquery
Rows explain
```

## labels

### NAME

Ordered column labels of a rank-1 table.

### SYNOPSIS

```text
Table labels -> array
Table: table
```

### DESCRIPTION

The input is a one-dimensional table.
Column labels are returned in their
defined order.

### EXAMPLES

Read the table column labels.

```rank
use tables
use json
Rows = "[{\"id\":1}]" json
T = Rows table
T labels
```

## table

### NAME

Builds a column table from a rank-1
array of objects.

### SYNOPSIS

```text
Rows table -> table
Rows: one-dimensional object array
```

### DESCRIPTION

Input is a one-dimensional array of
objects. Field names become column
labels; absent values become missing
cells.

### EXAMPLES

Turn object rows into a column table.

```rank
use tables
use json
Rows = "[{\"id\":1}]" json
Rows table
```

## lookup

### NAME

First keyed match; SQLite expressions
become a correlated subquery.

### SYNOPSIS

```text
Ids Keys Values lookup -> value
Ids: requested keys; Keys: key array
Values: corresponding value array
```

### DESCRIPTION

Keys and Values have matching lengths.
Returns the first keyed match for each
requested id; missing matches can be
handled with default. Values are
produced on demand; storing the result
does not force every item.

### EXAMPLES

Look up 2 and 1: b, a.

```rank
use tables
Ids = array 2 1
Keys = array 1 2
Vals = array "a" "b"
Ids Keys Vals lookup
```

## sql

### NAME

Statement text and bound parameters of a
query view.

### SYNOPSIS

```text
Query sql -> record
Query: SQLite-backed table view
```

### DESCRIPTION

Input is a SQLite-backed query view.
Returns a record instead of executing
the query; requires the database setup
shown in the example.

### EXAMPLES

Inspect a query's SQL text and bound
parameters.

```rank
use tables
Db = "data.sqlite" sqlite
Q = "SELECT 1 AS n"
P = array shape 0 fill 0
Rows = Db Q P sqlquery
Rows sql
```

## sqlite

### NAME

Opens an existing SQLite database; reads
are lazy, writes explicit.

### SYNOPSIS

```text
Path sqlite -> database
Path: text naming an existing database
```

### DESCRIPTION

Requires a host with SQLite support and
an existing data.sqlite file. Reads are
lazy; database writes require explicit
writable operations.

### EXAMPLES

Open an existing local SQLite database.

```rank
use tables
"data.sqlite" sqlite
```

## sqlquery

### NAME

Read-only SELECT view with bound
positional parameters.

### SYNOPSIS

```text
Db Text Parameters sqlquery -> table
Db: database; Text: SQL; Parameters:
array
```

### DESCRIPTION

Requires an existing database and SQLite
host support. Text is a SELECT query;
Parameters is a one-dimensional array
matching its positional placeholders.

### EXAMPLES

Prepare a read-only query with no
parameters.

```rank
use tables
Db = "data.sqlite" sqlite
Q = "SELECT 1 AS n"
P = array shape 0 fill 0
Db Q P sqlquery
```
