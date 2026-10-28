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
"a" write "notes.txt"
"b" append "notes.txt"
"notes.txt" read
```

```result
ab
```

### Usage

```text
Text append Path
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
F = "notes.txt" open .write
F writebytes ("hi" bytes)
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
"hello" write "notes.txt"
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
F = "notes.txt" open .write
F writebytes ("hello" bytes)
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
"hello" write "notes.txt"
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
"hello" write "notes.txt"
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

The REPL shows a printed value once.

```rank
use io
"hello" print
```

```result
hello
```

### Usage

```text
Value print
```

print gives back the same value, so you
can put it in the middle of a
calculation to watch it.

In the REPL, printed output takes at
most five visible lines. Longer output
shows four lines and an ellipsis.
Tap the output to open all of it in
the viewer. Program output itself is
not shortened.

### See also

write, text

## read

Read a whole text file.

```rank
use io
"hello" write "notes.txt"
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
"hello" write "notes.txt"
"notes.txt" 1 2 readbytes
```

```result
0x656c
```

### Usage

```text
Path Offset Count readbytes
File readbytes Count
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
"a\nb" write "notes.txt"
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
"hello" write "notes.txt"
F = "notes.txt" open
F seek 2
F position
```

```result
2
```

### Usage

```text
File seek Offset
```

Offset counts bytes from the start of
the file.

### See also

position, readbytes

## size

How many bytes an open file holds.

```rank
use io
"hello" write "notes.txt"
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
"hello" write "notes.txt"
"notes.txt" read
```

```result
hello
```

### Usage

```text
Text write Path
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
F = "notes.txt" open .write
F writebytes ("hello" bytes)
F close
"notes.txt" read
```

```result
hello
```

### Usage

```text
File writebytes Bytes
```

Turn text into bytes first with bytes.

### See also

open, bytes, readbytes

## safetensors and tensor

Inspect a Safetensors checkpoint through an open file. `F safetensors` lists
`.name`, `.dtype`, `.shape` and `.bytes` without reading tensor payloads.
`F tensor Name` returns the named array, or a scalar for a rank-zero tensor.

```rank
use io
use sequences
F = "model.safetensors" open
F safetensors
W' = F tensor "wte.weight"
W 0 0
Preview = W (0 till 3) #
Preview
```

Use the existing deferred binding (`W' =`) for large tensors. Ordinary `W =`
materializes the array, just as it does for other Rank expressions. The reader
holds at most one 64 KiB payload block per view; the index is limited to 16 MiB.
Selecting a small slice and assigning it normally creates an ordinary in-memory
array. A full reduction still reads the full tensor. Keep the file open while
using a deferred view; `F close` invalidates it. File resources follow the usual
program/REPL lifetime.

Supported dtypes: F16, BF16, F32, F64, signed/unsigned 8/16/32/64-bit integers,
and BOOL. Integers remain exact Rank integers; floating values become Rank reals.
Empty tensors and rank-zero scalars are supported. Packed/sub-byte types are not.
Shapes, offsets, byte lengths, duplicate keys and complete payload coverage are
validated before access. Hosts with file revisions reject modified files; do not
modify a checkpoint while it is open. Safetensors itself contains no payload
checksum: structural validation is not a content-integrity check.

On Android, `"models/model.safetensors" open` reads a file already placed in the
app's `files/models` directory. This is separate from notebook attachments and
is not included in notebook ZIP exports. The file-picker/import UI and automatic
shard-index loading are not implemented yet. Desktop uses ordinary file paths;
individual shard files can be opened separately.

A whole deferred F32 tensor can also be passed directly to a `.ram` function with
an `.f32` input. Keep its file open until the call completes:

```rank
use io
use "doubleweights.ram"
F = "models/gpt2-ln1.safetensors" open
Weights' = F tensor "h.0.ln_1.weight"
Result = Weights doubleweights
F close
Result
```

The GPU bridge sends the file path, revision, byte range and shape instead of
reading `Weights` into JavaScript. The native runtime checks the revision and
range, validates finite FP32 values, and fills the GPU input buffer. Desktop uses
a read-only memory mapping for the selected range. Android reads it natively in
bounded chunks into the `float[]` required by LiteRT's Kotlin API. Neither path
promises zero-copy GPU access. Binding checks still apply; unsupported dtypes,
closed files and changed files fail explicitly. An ordinary assignment or an
operation that transforms the array uses the usual Rank evaluation rules.

## verify

`File verify Sha256` checks a lowercase 64-character SHA-256 digest and returns
the same open file. Verification streams through a 64 KiB native buffer and
preserves the file cursor. A changed verified file must be reopened. This is
available for desktop files and Android `models/` files; hosts without a streaming
checksum API report an error.

```rank
use io
F = "models/locked.safetensors.index.json" open
F verify "4945fc6c0c6606c66afc79d27bd228468febc6a3a41e4ccbc3028f6f4305c060"
F safetensors
```

That digest belongs to the bundled GPT-2 checkpoint demonstration's generated
index. Use the digest reported by the importer for your own files.

### Multi-file Safetensors checkpoints

The existing `safetensors` and `tensor` operations also accept an open
`.safetensors.index.json` file. Its `weight_map` maps tensor names to sibling
`.safetensors` files. `F safetensors` reads the index and shard headers only,
returning the ordinary metadata columns plus `file`. An unlocked Hugging Face
index can be inspected this way.

Tensor access additionally requires a `files` map with each shard's `size` and
`sha256`. Create this locked index beside the source files:

```sh
node scripts/mlrank-lock-checkpoint.mjs \
  /path/to/model.safetensors.index.json /path/to/locked.safetensors.index.json
```

The command verifies shard tensor names and ranges, hashes each shard in bounded
chunks, and writes a new index without copying the weights. It prints the locked
index's SHA-256. Pin that digest with `F verify "..."` before selecting tensors.
This pins local content; it does not establish who published the source files.

```rank
use io
F = "models/locked.safetensors.index.json" open
Weights' = F tensor "weight"
First = Weights 0 0
F close
First
```

The first tensor selection from a shard verifies its complete file checksum.
Further selections from the same open checkpoint check the file revision without
rehashing. Reopening the checkpoint verifies selected shards again. This reads the
whole selected shard once but does not materialize it in JS memory. Inspection of
metadata alone does not verify payload checksums. Close the parent index to close
its opened shards; tensor views must not outlive it. File-backed F32 tensors keep
their native GPU descriptors through this selection.

Indexes are limited to 16 MiB and 1024 shards. Shards must be simple sibling
filenames: nested paths and parent-directory references are rejected. Duplicate
JSON keys, mismatched tensor names, missing integrity records, changed files and
checksum failures are errors. Files remain external to notebook exports; the
checkpoint import UI and file bundling are separate work.
