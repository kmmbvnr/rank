# Testing

Rank tests live in separate files ending in `_test.ra` and run with:

```console
rank test path
```

Recursive discovery skips compiled project archives containing `rank-compile.json`.
An archived test can still be run by passing its file path explicitly.

Rust verification is paused in ordinary tests and CI. Run `npm run verify:rust`
for the Euler rewrites, or `RANK_TEST_RUST=1 npm test --workspace @arrrank/compile`
for the compiler integration checks.

The corpus audits compare both execution modes on bounded inputs for expensive
workloads listed in `scripts/demo-execution-exclusions.json`. Full compiled
answers for Euler 299 and 426 are checked by
`packages/interpreter/test/full-scale-demos.test.ts`; `rank test .` also runs
their separate `_default_test.ra` files.
The differential audit reads checked-in data only; locally downloaded datasets
do not change its inputs. Embedded tests supply their own bounded fixtures.

A test block contains ordinary Rank statements. Its body uses two spaces of
indentation:

```rank
use testing

test "limit 10"
  use "001_multiples" as sum35
  Answer = sum35 10

  Answer equal 23
end
```

Each test receives a clean workspace. A source module is loaded without running
its top-level lines; calling a file that returns a value runs it and gives the
test that value. The names the file assigns stay private to that call.

Standalone boolean expression statements are assertions. A scalar assertion
must evaluate to `true`. An array or tensor of booleans is a single assertion
and passes only when every element is `true`, so an entire result can be checked
without addressing each element:

```rank
Answer equal array 7 0 8
```

Finite lazy boolean sequences and masks are also evaluated and checked element
by element; a false element fails the test. Known infinite sequences cannot be
used as standalone assertions: bound them first. Standalone sequence expressions
are consumed by the test runner, including generator effects and errors.

`equal` remains elementwise. Mixed sequence/array comparisons use array
broadcasting rules, and incompatible shapes raise `.DimensionMismatch`.

A call argument exercises the same input declarations that the host adapter
binds. A file that returns several values returns a record, and the test reads
its fields:

```rank
test "record result"
  use "pair" as pair
  Out = pair 3
  Out .total equal 12
end
```

Functions exposed by a loaded source module may be called as normal Rank code.
An open import uses their names directly; an aliased import uses names such as
`E.solve`.
