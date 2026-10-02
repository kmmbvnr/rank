# io manual

## stdin

Read the next number or word typed as
input.

```rank
use io
stdin .integer
```

```result
7
```

### Usage

```text
stdin .Type
Count stdin .Type
```

.Type is .integer, .real or .text. Input
is split at spaces and line breaks. With
a Count in front, reads that many values
as a sequence.

### See also

argument, read

## append

Add text to the end of a file.

```rank
use io
"a" "notes.txt" write
"b" "notes.txt" append
"notes.txt" read
```

```result
ab
```

### Usage

```text
Text Path append
```

Creates the file if it does not exist
yet. Nothing is added between the old
text and the new one; include "\n"
yourself to start a new line.

### See also

write, read

## close

Close an open file.

```rank
use io
F = "notes.txt" .write open
F ("hi" bytes) writebytes
F close
"notes.txt" read
```

```result
hi
```

### Usage

```text
File close
```

Files close by themselves when the
function that opened them ends. Close
early to make sure writes are finished.
Closing twice is harmless.

### See also

open, flush

## eof

Check whether an open file has been read
to the end.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F eof
```

```result
false
```

### Usage

```text
File eof
```

### See also

readbytes, position, seek

## flush

Make sure everything written so far
reaches the file.

```rank
use io
F = "notes.txt" .write open
F ("hello" bytes) writebytes
F flush
"notes.txt" read
```

```result
hello
```

### Usage

```text
File flush
```

Writes may be held back to make them
faster; flush sends them now. close does
this too.

### See also

close, writebytes

## open

Open a file to read or write it bit by
bit.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F size
```

```result
5
```

### Usage

```text
Path open
Path .write open
```

A file opens for reading unless you add
.write, .append or .update before open.

### Notes

To read or write a whole file at once,
read and write are simpler.

### See also

close, readbytes, writebytes, seek

## position

Where in an open file the next read or
write happens, counted in bytes.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F position
```

```result
0
```

### Usage

```text
File position
```

A freshly opened file starts at 0.

### Notes

Bytes are not characters: letters like é
take two bytes.

### See also

seek, size

## print

Show a value as a line of output.

print shows hello, then the REPL shows
the value print hands back.

```rank
use io
"hello" print
```

```result
hello
hello
```

### Usage

```text
Value print
```

print gives back the same value, so you
can put it in the middle of a
calculation to watch it.

### See also

write, text

## read

Read a whole text file.

```rank
use io
"hello" "notes.txt" write
"notes.txt" read
```

```result
hello
```

### Usage

```text
Path read
```

The file is read as UTF-8 text. A
missing file is an error.

### See also

readlines, write, open

## readbytes

Read raw bytes from a file.

Two bytes from position 1: the letters e
and l.

```rank
use io
"hello" "notes.txt" write
"notes.txt" 1 2 readbytes
```

```result
0x656c
```

### Usage

```text
Path Offset Count readbytes
File Count readbytes
```

With a path, reads Count bytes starting
at Offset. With an open file, reads the
next Count bytes and moves on.

### See also

read, open, seek

## readlines

Read a text file line by line.

```rank
use io
"a\nb" "notes.txt" write
"notes.txt" readlines
```

```result
a b
```

### Usage

```text
Path readlines
```

Line endings are removed. Lines are read
as you use them, so even very large
files are fine.

### See also

read, split

## seek

Jump to a byte position in an open file.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F 2 seek
F position
```

```result
2
```

### Usage

```text
File Offset seek
```

Offset counts bytes from the start of
the file.

### See also

position, readbytes

## size

How many bytes an open file holds.

```rank
use io
"hello" "notes.txt" write
F = "notes.txt" open
F size
```

```result
5
```

### Usage

```text
File size
```

### See also

position, open

## write

Save text to a file, replacing what was
there.

```rank
use io
"hello" "notes.txt" write
"notes.txt" read
```

```result
hello
```

### Usage

```text
Text Path write
```

Creates the file if needed. Any old
content is lost; to add to the end
instead, use append.

### See also

append, read

## writebytes

Write raw bytes to an open file.

```rank
use io
F = "notes.txt" .write open
F ("hello" bytes) writebytes
F close
"notes.txt" read
```

```result
hello
```

### Usage

```text
File Bytes writebytes
```

Turn text into bytes first with bytes.

### See also

open, bytes, readbytes
