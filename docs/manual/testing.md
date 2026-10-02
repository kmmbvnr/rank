# testing manual

## test

### NAME

Declare a block of boolean assertions.

### SYNOPSIS

```text
test "name"
  Condition
end
Capitalized words stand for your values.
```

### DESCRIPTION

A test block contains boolean
assertions. The runner collects these
blocks; a false assertion or raised
error fails the test. Begin the program
with use testing.

### EXAMPLES

Check that addition gives the expected
value.

```rank
use testing
test "addition"
  1 + 1 equal 2
end
```
