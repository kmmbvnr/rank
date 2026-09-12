# PostgreSQL Exercises: basic

Work through the [basic questions](https://pgexercises.com/questions/basic/)
one at a time, in their published order. Use a local SQLite copy of the club
data, with the PostgreSQL `cd` schema flattened to the SQLite tables
`facilities`, `members` and `bookings`. Keep that database in the ignored
`../data/` directory. The original PostgreSQL data and setup instructions are
on the [Getting Started](https://pgexercises.com/gettingstarted.html) page.

The first task is [Retrieve everything from a table](https://pgexercises.com/questions/basic/selectall.html):
read every facility row and all six columns. No row order is specified. The
Rank solution and its neighboring test will be added after the SQLite table
interface is agreed; see the [proposal](../../../docs/design/sqlite-tables.md).
