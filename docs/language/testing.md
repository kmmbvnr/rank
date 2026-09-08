# Testing

Rank tests live in separate files ending in `_test.ra` and run with:

```console
rank test path
```

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

Standalone boolean expression statements are assertions. Every such expression
must evaluate to `true`.

Arguments exercise the same input declarations through the host adapter:

```rank
test "argument input"
  use "001_multiples"
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
