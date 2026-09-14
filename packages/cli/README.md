# Rank CLI

`rank` runs a `.ra` source file. With no file argument it opens the terminal REPL.

```console
rank program.ra --limit 10
rank test path/to/program_test.ra
rank test path/to/directory
```

`rank test` runs test files ending in `_test.ra`.

In the REPL, Enter submits the bottom prompt. Up returns to earlier code for
editing; Down or Esc returns to the prompt. Enter inside earlier code inserts a
line. Ctrl-R submits the prompt from anywhere in the document.
Submitting the prompt reruns the document from its first edit and stops at
the first error, with the cursor ready to correct it. Newly submitted code stays
in the document even when an earlier instruction fails.
An empty Enter runs pending instructions without adding a line; when everything
has run, it adds a blank line.

Gray circles mark pending instructions, yellow marks the current run, green marks
success and red marks an error. Rerunning replaces the previous output. Long
expressions are formatted to 40 columns with parentheses when a safe break exists.
Terminal wrapping also fits the display to the window width.

During execution the footer shows elapsed time. Ctrl-C stops the current cell
and returns to `rank>`; queued cells wait. The stopped cell keeps its source and
an interruption message, including the source location when available. Select
that cell and press Ctrl-R to retry it. Earlier bindings remain available.
Cancellation runs `finally` blocks but does not undo mutations, consumed input,
or file writes. It also covers lazy evaluation during result previews and `full`.
The terminal runs separately from the interpreter; cancellation is checked in
Rank loops, number calculations, sequence and array materialization, sorting,
statistics, matrix operations, graph traversal and table processing. Generated
tensor kernels also check for cancellation in interactive mode. File execution
and piped input do not start a worker or poll a cancellation signal. A blocking native
operation without a checkpoint must return before cancellation can take effect.

Tab completes and cycles matches in one footer. Ctrl-Z/Ctrl-Y undo and redo edits;
Ctrl-Q exits. Type `help` for the other keys and commands, `save FILE` to save the
source, or `load FILE` to open source in the session.
Loading replaces the current document and clears interpreter state. Unsaved code
can be saved before replacement, or the load can be cancelled. The new code stays
pending; press Enter at `rank>` or Ctrl-R to run it.
The footer shows the file name and `saved` / `unsaved`. Ctrl-S saves to the last
loaded or saved file, or asks for a name for a new program. Saving includes any
unsubmitted source without running it. Exiting with unsaved changes offers to
save, discard changes, or cancel with Esc.

See [REPL input](../../docs/design/repl-input.md) for execution and input details.

Stored native sources in the REPL keep their read position. After
`G = primes` and `G until 100 sum`, inspecting `G` starts at `101`.
Previews do not consume values; `H = G` shares the cursor, while `H = primes`
starts a fresh stream. Editing a consuming line restores the position left by
its preceding lines. Normal file execution retains repeatable native sources.
See [sequence previews](../../docs/design/generator-previews.md).
