# Seeded reachability in table views

The three [PostgreSQL Exercises Recursive questions](https://www.pgexercises.com/questions/recursive/)
ask for a recommendation chain upward from one member, a tree downward from
one member, and chains upward from all members. A fixed number of joins loses
longer chains. Handwritten `sqlquery` would work only on SQLite and hide the
Rank table operations these exercises are meant to test.

The accepted interface uses an edge table, one or more starts, and two directed
field names:

```rank
M = Db .members
E = M select
  .member = .memid
  .recommender = .recommendedby
end
Up = E 27 reach by .member .recommender
Down = E 1 reach by .recommender .member
Starts = M .memid
All = E Starts reach by .member .recommender
```

The first field says where a current ID is found in an edge row; the second
gives the next ID. The output pairs each start with every distinct reachable
endpoint, using those two field names. It excludes a start paired with itself,
including a cycle return. Missing edge endpoints and missing array starts are
ignored. Duplicate starts and edges produce no duplicate pairs. Array tables
are traversed locally; SQLite views compile to a lazy `WITH RECURSIVE` whose
seed is restricted to the supplied starts. The source table is unchanged.
`sql` and `explain` inspect the generated query; `sort by` establishes output
order. The [CLI oracle](../../packages/cli/test/pgexercises-recursive.test.mjs)
checks both backends, including cycles and duplicates.

## Why a seeded relation operation

Lil offers `while` and recursive functions. APL's power operator, J's power
conjunction and q's Converge repeat a function until a fixed point. A fold or
scan instead consumes an existing collection; a recursive graph step discovers
new rows. NumPy and pandas offer array and join building blocks but leave
repetition to Python or a graph library. See the
[Lil reference](https://beyondloom.com/decker/lil.html),
[APL course](https://course.dyalog.com/Operators/),
[J Learning](https://www.jsoftware.com/help/learning/10.htm),
[q iterators](https://code.kx.com/q/wp/iterators/), and
[pandas merge](https://pandas.pydata.org/docs/reference/api/pandas.merge.html).

A general `Step until stable` operation would be useful on in-memory arrays,
but an arbitrary Rank function cannot automatically become a SQLite recursive
query. `reach by` names a relational step with a stable two-column schema,
which both backends can execute. An unseeded `closure by` would derive all
reachable pairs even when the question asks about one starting member. For
depth, full paths or accumulated values, a future general recursive-table
block will need an explicit seed and a representable row-producing step.
