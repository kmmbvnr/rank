# Simpler table programs: design decision

Accepted and implemented on 2026-09-12. The language owner approved contextual
filter/select and sort directions, and asked to remove superseded recent forms.
The current rules are in [Tables](../language/tables.md#filter-clause) and
[Ordering](../language/sequences-arrays.md#ordering-and-uniqueness).

## The decision

Keep ordinary named steps. Add `Rows filter Condition` and `Rows filter ... end`
with implicit input columns. Add `Rows select .first .second` and a select block
that contains private calculations and output field definitions. Add ascending
and descending directions to sorts and individual sorting keys.

Dynamic column records use `Rows select Cols`. The former `Rows Cols select`
function was removed: select now has one table-first syntactic family and one
projection implementation. General records, `choose`, `lookup`, join aliases,
and boolean addressing remain independently useful.

The old wiki-only source clause, with `filter` on a separate line after a
completed assignment, was removed. Filter lines now have a defined grouping:
normal precedence within each expression, then AND between complete lines.

## Costly bookings

With `Db` already open, Joins 6 is now:

```rank
R = Db .bookings
M = Db .members
F = Db .facilities
R = R M innerjoin by .memid
R = R F innerjoin by .facid
R = R filter
  .starttime at least "2012-09-14"
  .starttime less "2012-09-15"
end
R = R select
  Guest = .memid equal 0
  GCost = .slots * .guestcost
  MCost = .slots * .membercost
  .member = .firstname + " " + .surname
  .facility = .name
  .cost = Guest GCost MCost choose
end
R = R filter .cost greater 30
Result = R sort by .cost descending
```

The query body changed from 29 to 19 nonblank lines, including `end` and
excluding imports, input arguments, opening the database and CSV output.
Every new query-body line fits within 40 columns. Some savings come from
ordinary cleanup and shorter names, not from new syntax alone.

The `Cols` helper, negative `.sortcost`, cleanup projection and explicit final
`array` are gone. CSV executes the complete SQLite query. Joins 8 keeps the
name `Priced` to make the calculated intermediate visible.

The self join in task 4 changed from 12 to 11 lines. It still needs four
output names because the exercise asks for a flat member/recommender table.
Its aliases continue to distinguish source roles without renaming input data.

## Boundaries and implementation

Contextual expressions resolve field paths against one captured input. Call
arity determines argument boundaries before an implicit receiver is inserted.
Local calculations shadow outer names only within select; their right sides
see preceding bindings. Field definitions all read the original input and
never write to the database or source rows.

The first implementation supports pure standard-library calculations. It
rejects user functions and effectful calls inside contextual expressions.
A function alias cannot hide an effectful call. SQLite aggregates there also
remain unsupported, rather than silently causing early row reads. Dynamic
records can still be prepared with ordinary Rank code outside the block.

Array filter results retain a rank-1 table view, a fixed set of selected row
positions, and lazy row access. Table headers survive empty filters, unique
and field-keyed sorting. Named array-table unique compares column values and
missing cells; sort directions preserve array ties. These details let the
same exercise source run on local arrays and SQLite.

A general `query ... end` pipeline wrapper was deferred. Explicit assignments
already show the sequence and give intermediate results useful names. The
wrapper would add scope and stage rules and lengthen the short self join.
Lazy field assignment was also deferred because it would need a separate
answer about mutation visible through aliases. Select returns a new view.

## Remaining SQL translation work

Basic tasks 1–8 now run in SQLite until CSV; task 5 retains bound raw SQL for
case-insensitive substring matching. Task 9 performs its limit locally after
SQL projection, distinct and sorting. Task 10 reads projected name columns for
a local union. Tasks 11 and 12 still calculate the latest date locally.

Future steps are limits, text matching, table union, grouped reductions and
scalar aggregates inside expressions. Multiway aliased joins need qualified
keys and nested scope composition. These backend gaps were not concealed by
new notation. See the [SQLite roadmap](sqlite-tables.md).

## Evidence and comparisons

The CLI SQL oracles cover all 12 Basic and 8 Joins solutions. Every Joins
source also runs on ordinary array tables against the same SQL reference,
including ordering, duplicate values and unmatched recommenders. Counting-I/O
tests check that contextual calculations remain SQL plans until a terminal
read. Runtime tests cover local shadowing, input preservation, missing fields,
function argument boundaries, empty headers, text sort and stable ties.

[PRQL transforms](https://prql-lang.org/book/reference/stdlib/transforms/)
provide a precedent for composing table operations in order. Its
[filtering tutorial](https://prql-lang.org/book/tutorial/filtering.html)
explains adding successive filters without manually writing SQL subqueries.
[dplyr's data masking](https://dplyr.tidyverse.org/articles/programming.html)
reduces repeated table prefixes while exposing the complexity of mixing
column names with programming variables. Rank keeps `.column` and uppercase
local names visually distinct.
[dbplyr's backend design](https://dbplyr.tidyverse.org/articles/new-backend.html)
separates lazy transformations from SQL building and rendering.

Shorter source is measurable; improved usability still needs observation.
A useful check is whether a new reader can identify which rows remain, what a
computed column means, and whether the source changes in both spellings.
