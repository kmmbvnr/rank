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
  use "001_multiples"
  Limit = 10
  run

  Answer equal 23
end
```

Each test receives a clean workspace. Source modules are loaded without running
their top-level lines, so the test may prepare values before transferring
control with `run`. Values created by the program remain available after it
returns.

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

Arguments exercise the same input declarations through the host adapter:

```rank
test "argument input"
  use "001_multiples"
  use cli
  args "--limit" "10"
  run

  Answer equal 23
end
```

An alias provides isolation when a test loads several programs:

```rank
test "aliased program"
  use "001_multiples" as E
  E.Limit = 10
  E.run

  E.Answer equal 23
end
```

Functions exposed by a loaded source module may be called as normal Rank code.
An open import uses their names directly; an aliased import uses names such as
`E.solve`.
