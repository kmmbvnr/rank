# PostgreSQL Exercises: string

The seven [String questions](https://pgexercises.com/questions/string/) are
solved in published order. They use the ignored SQLite database described in
[Basic](../basic/README.md), and every program also runs with an in-memory
array of the same records. Each SQLite view remains lazy until CSV output.

| # | Question | Rank program |
|---|---|---|
| 1 | [Format names](https://pgexercises.com/questions/string/concat.html) | [001](001_names.ra) |
| 2 | [Name prefix](https://pgexercises.com/questions/string/like.html) | [002](002_prefix.ra) |
| 3 | [Case-insensitive prefix](https://pgexercises.com/questions/string/case.html) | [003](003_case.ra) |
| 4 | [Parentheses in phones](https://pgexercises.com/questions/string/reg.html) | [004](004_phone.ra) |
| 5 | [Padded ZIP codes](https://pgexercises.com/questions/string/pad.html) | [005](005_zip.ra) |
| 6 | [Surname initials](https://pgexercises.com/questions/string/substr.html) | [006](006_initial.ra) |
| 7 | [Clean telephone numbers](https://pgexercises.com/questions/string/translate.html) | [007](007_clean.ra) |

`lower`, `startswith`, `lpad`, `translate`, text casts, substring membership
and text slices compile into SQLite expressions. Rank registers deterministic
text functions on its SQLite connections so Unicode behavior matches arrays;
standalone SQLite clients must register those `rank_*` functions to run SQL
copied from `Result sql`. The [CLI oracle](../../../packages/cli/test/pgexercises-string.test.mjs)
compares all seven answers on both backends and checks the generated plans.
