# PostgreSQL Exercises: recursive

All three [Recursive questions](https://www.pgexercises.com/questions/recursive/)
have runnable Rank solutions. They use the ignored SQLite club database from
[Basic](../basic/README.md), or an array table with the same members. `reach by`
follows recommendation edges from one or more starting IDs; SQLite keeps the
walk in a lazy recursive query until CSV output.

| # | Question | Rank program |
|---|---|---|
| 1 | [Upward chain from 27](https://pgexercises.com/questions/recursive/getupward.html) | [001](001_up.ra) |
| 2 | [Downward chain from 1](https://pgexercises.com/questions/recursive/getdownward.html) | [002](002_down.ra) |
| 3 | [Upward chains for any member](https://pgexercises.com/questions/recursive/getupwardall.html) | [003](003_all.ra) |

Run a program from the repository root:

```sh
npm run rank -- demos/pgexercises/recursive/001_up.ra
```

The [CLI oracle](../../../packages/cli/test/pgexercises-recursive.test.mjs)
compares all three programs with independent recursive SQL on a temporary
database and runs each against an equivalent array source. It also checks a
cycle, duplicate edges and starts, missing endpoints, generated SQL and
`explain`. Generated CSV stays in ignored `../data/`.
