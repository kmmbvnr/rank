# testing manual

## test

A named group of checks that should all
be true.

```rank
use testing
test "addition"
  1 + 1 equal 2
end
```

### Usage

```text
test "name"
  Condition
end
```

Each line in the block is a condition.
The test fails if any condition is false
or anything raises an error.

### See also

equal, try
