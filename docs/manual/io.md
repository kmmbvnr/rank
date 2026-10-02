# io manual

## stdin

### NAME

Read typed tokens from standard input.

### SYNOPSIS

```text
stdin .Type
Count stdin .Type
Result: typed token or sequence
Count: nonnegative integer
.Type: .integer, .real or .text
```

### DESCRIPTION

The label selects the token type, such
as .integer, .real or .text. A preceding
count requests a lazy sequence of
tokens. This example needs an input
token.

### EXAMPLES

Read one integer token from input.

```rank
use io
stdin .integer
```

## append

### NAME

Appends UTF-8 text to a file, creating
it when missing.

### SYNOPSIS

```text
Text Path append -> text
Text, Path: text
```

### DESCRIPTION

Operands are text followed by a path.
Creates the file when absent; the host
must provide writable file storage.

### EXAMPLES

Append b after a without replacing a.

```rank
use io
"a" "notes.txt" write
"b" "notes.txt" append
```

## close

### NAME

Closes a file early; closing an already
closed file does nothing.

### SYNOPSIS

```text
File close -> file
File: open file handle
```

### DESCRIPTION

Closes the handle immediately. Reading
or writing through a closed handle
raises an error; owned handles also
close when their scope ends.

### EXAMPLES

Release an open file handle.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F close
```

## eof

### NAME

True when the position is at or past the
end of the file.

### SYNOPSIS

```text
File eof -> boolean
File: open file handle
```

### DESCRIPTION

Tests whether the current byte position
is at the file end. Reading or seeking
changes this result.

### EXAMPLES

The new cursor is not at end: false.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F eof
```

## flush

### NAME

Asks the host to write buffered output
to the file system.

### SYNOPSIS

```text
File flush -> file
File: open file handle
```

### DESCRIPTION

Requires an open file handle. Makes its
pending writes visible according to the
host file implementation.

### EXAMPLES

Flush buffered writes to the host.

```rank
use io
F = "notes.txt" .write open
F ("hello" bytes) writebytes
F flush
```

## open

### NAME

Opens a file, read-only unless a mode
label selects write, update or append.

### SYNOPSIS

```text
Path open -> file
Path: text; optional mode label
```

### DESCRIPTION

The default mode is read. Put .write,
.append or .update before open to choose
another mode. File handles are closed
when their owning scope ends.

### EXAMPLES

Open a file and read its size in bytes.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F size
```

## position

### NAME

Current byte offset of an open file.

### SYNOPSIS

```text
File position -> integer
File: open file handle
```

### DESCRIPTION

Returns the file cursor position in
bytes. Text code points and bytes are
different for non-ASCII text.

### EXAMPLES

A newly opened reader is at byte offset
zero.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F position
```

## print

### NAME

Writes one line and returns the value,
so a pipeline continues.

### SYNOPSIS

```text
Value print -> same
Value: any supported value
```

### DESCRIPTION

Formats the value and writes it to
standard output. Returns the same value
so a pipeline can continue.

### EXAMPLES

Send hello to program output.

```rank
use io
"hello" print
```

## read

### NAME

Complete decoded UTF-8 text of a file,
final line ending included.

### SYNOPSIS

```text
Path read -> text
Path: text path or open file handle
```

### DESCRIPTION

Reads a path as UTF-8 text. A missing
file raises an error; the host must
provide file access.

### EXAMPLES

Read the complete text back.

```rank
use io
"hello" "notes.txt" write
"notes.txt" read
```

## readbytes

### NAME

Reads a block of bytes by offset, or the
next Count bytes of an open file.

### SYNOPSIS

```text
Path Offset Count readbytes -> bytes
Path: text; Offset, Count: integers
```

### DESCRIPTION

A path form takes Offset and Count. A
file-handle form takes Count and
advances its cursor. Offsets and counts
are nonnegative integers.

### EXAMPLES

Read two bytes starting at byte offset
1.

```rank
use io
"hello" "notes.txt" write
"notes.txt" 1 2 readbytes
```

## readlines

### NAME

Lines of a file with their separators
removed.

### SYNOPSIS

```text
Path readlines -> array
Path: text path or open file handle
```

### DESCRIPTION

Lines are produced lazily. Line
terminators are not part of each
returned line; file access is supplied
by the host.

### EXAMPLES

Read the file as a sequence of text
lines.

```rank
use io
"a\nb" "notes.txt" write
"notes.txt" readlines
```

## seek

### NAME

Sets an absolute byte offset from the
beginning.

### SYNOPSIS

```text
File Offset seek -> file
File: open handle; Offset: integer
```

### DESCRIPTION

Offset is a nonnegative integer. It is
an absolute byte position, not a
relative move or character count.

### EXAMPLES

Move to absolute byte offset 2.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F 2 seek
F position
```

## size

### NAME

Length of an open file in bytes.

### SYNOPSIS

```text
File size -> integer
File: open file handle
```

### DESCRIPTION

Returns the file length in bytes, not
Unicode characters. The cursor position
is unchanged.

### EXAMPLES

The ASCII text occupies five bytes.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F size
```

## write

### NAME

Creates or replaces a file with UTF-8
text.

### SYNOPSIS

```text
Text Path write -> text
Text, Path: text
```

### DESCRIPTION

Operands are text followed by a path.
Existing content is replaced; the host
must provide writable file storage.

### EXAMPLES

Create or replace notes.txt.

```rank
use io
"hello" "notes.txt" write
```

## writebytes

### NAME

Writes a bytes value to an open file.

### SYNOPSIS

```text
File Bytes writebytes -> file
File: writable handle; Bytes: bytes
```

### DESCRIPTION

Arguments are a writable file handle
followed by bytes. Writing advances the
cursor; text must first be converted
with bytes.

### EXAMPLES

Write UTF-8 bytes to an opened file.

```rank
use io
F = "notes.txt" .write open
F ("hello" bytes) writebytes
F close
```
