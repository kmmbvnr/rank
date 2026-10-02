# cli manual

## args

Set the command-line arguments for the
next program run.

```rank
use cli
args "--limit" "10"
```

### Usage

```text
args Words
```

Each quoted word is one argument, as if
typed after the program name in a
terminal. Lets you try a program's
options inside the app.

### See also

argument, option, flag, run

## argument

Declare an input that the program takes
by position.

Run without arguments, N gets its
default of 3.

```rank
use cli
argument N integer = 3
N * 2
```

```result
6
```

### Usage

```text
argument Name Type = Default
```

Arguments are filled in the order they
are declared. Type is integer, real or
text. Without a default, the argument is
required.

### See also

option, flag, args

## flag

Declare an on/off switch, such as
--verbose.

```rank
use cli
flag Verbose
Verbose
```

```result
false
```

### Usage

```text
flag Name
```

The name is true when the flag is given
and false otherwise. Unlike option, a
flag takes no value.

### See also

option, argument

## option

Declare a named input, such as --limit
10.

```rank
use cli
option Limit integer = 10
Limit
```

```result
10
```

### Usage

```text
option Name Type = Default
```

Type is integer, real or text. The
default is used when the option is left
out.

### See also

flag, argument, args
