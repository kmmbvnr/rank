# cli manual

## env

Read a session environment variable.
An absent variable returns `.NA`; an
empty string remains a present value.

```rank
use cli
Host = "HOST" env default "localhost"
Port = (
  "PORT" env default "8080"
) integer
env "HOST" = "example.org"
Name = "HOST"
env Name = ""
env Name = .NA
```

```result
.NA
```

### Usage

```text
Name env
env Name = Value
```

`default` is lazy and does not write a
value. A present but invalid value
still reports a conversion error.
Writes accept text; `.NA` deletes the
variable. Deleting an absent variable
is harmless. Compound writes are not
supported. Invalid names are rejected
before evaluating the right-hand side.

An alias such as `e = env` retains the
write capability: `e Name = Value`.
Without `use cli`, `env Name = Value`
can remain an ordinary function
definition using the unopened name.

The CLI takes an initial snapshot of
its process environment. Later writes
belong to the Rank session and do not
change the parent shell or process
environment. Windows names are
case-insensitive in both direct and
worker execution; other hosts use
case-sensitive names.

Clean program restarts preserve the
session environment. Opening another
notebook resets it to the initial
environment. Browser and Android
notebooks start empty; environment
values are not saved with notebooks
and do not survive app restarts.

Imported modules share the session
environment. Each preview and each
test has a disposable overlay; writes
are visible within that overlay only.
Ordinary functions observe preceding
writes. An explicit `memo` function
can cache an environment-derived
result, just as it caches other calls.

Names must be nonempty text without
`=` or NUL. Values cannot contain NUL.

### See also

args, option

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
are declared. Type is integer, real,
text, path or boolean. An argument is
required unless it has a default.

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

Type is integer, real, text, path or
boolean. The default is used when the
option is left out.

`text` accepts any text, including empty
and multiline values. In zsh or bash,
pass newlines inside one quoted
argument:

```sh
rank program.ra \
  --message=$'first\nsecond'
```

Use `--message=--hello` for a value that
starts with `--`. For positional text,
put `--` before such a value.

`path` marks text intended as a
filename.
Input binding preserves it unchanged;
it does not resolve it against the
program's directory or read the file.

### See also

flag, argument, args
