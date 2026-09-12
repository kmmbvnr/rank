# PostgreSQL Exercises: basic

Work through the [basic questions](https://pgexercises.com/questions/basic/)
one at a time, in their published order. Use a local SQLite copy of the club
data, with the PostgreSQL `cd` schema flattened to the SQLite tables
`facilities`, `members` and `bookings`. Keep that database in the ignored
`../data/` directory. The original PostgreSQL data and setup instructions are
on the [Getting Started](https://pgexercises.com/gettingstarted.html) page.

From the repository root, prepare the ignored SQLite database once:

```sh
mkdir -p demos/pgexercises/data
curl -L --fail -o demos/pgexercises/data/clubdata.sql \
  https://raw.githubusercontent.com/AlisdairO/pgexercises/master/database/clubdata.sql
python3 demos/pgexercises/import_clubdata.py
```

The converter expects the official dump's three `COPY` blocks and refuses to
overwrite an existing SQLite file. The current dump produces 9 facilities, 31
members and 4044 bookings. The source dump, database and query output all stay
inside the ignored `data/` directory.

The first task is [Retrieve everything from a table](https://pgexercises.com/questions/basic/selectall.html):
read every facility row and all six columns. [The Rank solution](001_select_all.ra)
opens the local database and writes a CSV result to the same ignored `data/`
directory. Its CLI test creates a temporary SQLite database and checks every
column and row, so the repository test suite needs no downloaded club data.
No row order is specified by the task.
Run it from the repository root with
`npm run rank -- demos/pgexercises/basic/001_select_all.ra`.
