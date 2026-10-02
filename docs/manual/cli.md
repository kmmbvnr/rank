# cli manual

## args

### NAME

Set arguments for the next program run.

### SYNOPSIS

```text
args Values
Capitalized words stand for your values.
```

### DESCRIPTION

Sets command-line inputs used by a later
run. Quoted words are individual
argument tokens; this requires the cli
module. Begin the program with use cli.

### EXAMPLES

Supply arguments for the next run.

```rank
use cli
args "--limit" "10"
```

## argument

### NAME

Declare a positional program input.

### SYNOPSIS

```text
argument Name Type = Default
Capitalized words stand for your values.
```

### DESCRIPTION

Declares an input consumed in argument
order. The declared type parses the
token; a default supplies the value when
it is absent. Begin the program with use
cli.

### EXAMPLES

Use the positional input, defaulting to
3.

```rank
use cli
argument N integer = 3
N * 2
```

## flag

### NAME

Declare a boolean command-line flag.

### SYNOPSIS

```text
flag Name
Capitalized words stand for your values.
```

### DESCRIPTION

Declares a boolean command-line flag.
Its presence sets true; unlike option it
takes no value token. Begin the program
with use cli.

### EXAMPLES

An omitted --verbose flag is false.

```rank
use cli
flag Verbose
Verbose
```

## option

### NAME

Declare a named program input.

### SYNOPSIS

```text
option Name Type = Default
Capitalized words stand for your values.
```

### DESCRIPTION

Declares a named command-line input. Its
type controls parsing and its default is
used when the option is omitted. Begin
the program with use cli.

### EXAMPLES

Use --limit, or the default 10.

```rank
use cli
option Limit integer = 10
Limit
```
