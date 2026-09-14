# Editable terminal REPL

`rank` without a file opens a full-screen REPL. Its document contains instructions
and their latest output. The bottom `rank>` prompt accepts new code. Source stays
plain Rank and `save FILE` writes a `.ra` file.

## Enter, editing and replay

At the bottom prompt, Enter submits a complete instruction. A block or an
expression ending in an operator continues on the next line. A blank line closes
an open block. Quotes and parentheses at the end of a completed draft retain the
REPL's automatic closing rules.

Up and Down move through the displayed source, including wrapped rows. Moving up
from the first row of the draft enters the end of the preceding instruction. Moving down
past the last instruction returns to the draft. Navigation does not execute code,
and leaving a line preserves its edits. Enter inside earlier source inserts a
newline. Esc returns to the bottom prompt; when a completion is visible, the
first Esc dismisses it.

Submitting a draft adds it to the document **before** execution starts. If earlier
source changed, execution starts at the earliest changed instruction, continues
through the following instructions, then reaches the newly submitted one. An
empty Enter at the bottom resumes pending work. When nothing is pending, it adds
a blank source line.
Blank lines have no status circle and are saved as spacing, without execution.
Ctrl-R returns to the bottom prompt and submits it as well.

The first error stops replay and places the cursor at the end of the failing line
when its location belongs to the current instruction. Later instructions, including
the newly submitted one, stay in the document waiting to run. Correct the error,
return to the prompt and press Enter to continue.
The viewport scrolls to show the diagnostic below the failing line and includes
the bottom prompt when they fit together. If the diagnostic is taller than the
screen, the failing line stays visible; Page Down reveals the rest without moving
the editing cursor.

The interpreter retains variables within the document. Before replay, bindings
first declared in the replayed suffix are removed together with their inferred
types. Editing `X = 1` into `X = array 1 2 3` therefore creates a fresh declaration;
renaming or deleting that declaration removes the old name. Variables declared
above the replay boundary retain their value and type. Instructions above the edit are not executed
again, and replay does not restore an earlier snapshot of memory. For example,
rerunning `Count += 1` increments the current value. Generator consumption on the
replayed suffix is released through the existing sequence tape; navigation alone
does not release it.

## Status and output

Each instruction starts with a filled circle:

- Gray: needs execution. Editing an instruction marks it and everything below it
  pending, even if the later source did not change.
- Yellow: currently executing.
- Green: finished successfully.
- Red: execution stopped with an error.

Each run replaces that instruction's previous output. A successful correction
therefore removes the old error. Output below the first error retains its previous
value until rerun; its gray instruction circle identifies it as pending.
Normal output is gray; error output is red.
Displaying a generator shows its unread tail without consuming it. After the
generator has been fully consumed, displaying its name produces an empty result.

Results use the existing bounded previews. `full` displays the complete last
value. `help` opens a temporary screen: arrows and Page Up/Page Down scroll it,
and Esc closes it completely. Neither the command nor its output enters the
document. Other commands have output but are excluded from saved source and automatic
replay. Commands such as `save` and `exit` remain available while code has an error.
`load FILE` replaces the document with separate pending instructions without executing
them. Unsaved source can be saved, discarded, or kept by cancelling the load.
The old document and interpreter are cleared only after the target file has been
read and that choice has been made. The new interpreter has no old variables,
inferred types, functions, imports, generator tapes, or last result.
Enter at the bottom prompt or Ctrl-R starts execution, stopping at the first
error. Code can be edited before that first run. Blocks remain whole instructions and blank lines
remain spacing. Output is stored separately and never written by `save`.

## Completion and text input

Tab inserts a completion. When several candidates match, repeated Tab cycles them
in place and one footer shows the current candidate and count. Typing or navigation
removes the footer. Completion uses session names, module exports, keywords,
operator aliases and context such as the type after `option Limit`.
After `load`, Tab completes directory names and `.ra` files. Directory completions
end with `/`; paths can be relative, absolute, or start with `~/`.

A comma typed outside text and comments becomes `=`. Other operator spacing is
formatted on submission, so typing `+=` never rewrites it midway through the
keystroke sequence. Operator aliases such as `gets`, `plus` and `times` retain
their existing rules and can be disabled with `alias off`.

Bracketed paste inserts text, including newlines, without executing it. Home/End
move to the logical line boundaries. Backspace/Delete operate on grapheme clusters.
Page Up/Page Down scroll through output without moving the source cursor.
Ctrl-Z/Ctrl-Y undo and redo edits within the current instruction. Ctrl-P/Ctrl-N
recall typed history. Ctrl-C returns to the prompt and clears the draft; Ctrl-Q exits.
History persists in `~/.rank_history`.

## Saving and exiting

The footer shows the current file name and `saved` or `unsaved`. A successful
`load FILE` or `save FILE` binds that path to the document. Ctrl-S writes to that
file; a new document opens a filename editor. Saving includes source still in the
bottom prompt, without executing it, and excludes commands and their output.
Undoing an edit back to the saved text clears the unsaved marker. Execution status
and saved status are independent.

Ctrl-Q, Ctrl-D on an empty line, `exit`, and `quit` offer to save if source has
changed. Enter or S saves, D discards changes, and Esc cancels the exit. Saving a
new program asks for a filename; an existing binding supplies it automatically.
If writing fails, the dialog keeps the source and displays the error so the user
can correct the filename or cancel. Piped input exits without an interactive prompt.

## Screen ownership

`notebook.ts` owns source, cursor offsets and instruction state. `repl.ts` handles
keys and schedules replay. `repl-session.ts` owns the persistent interpreter,
commands and captured output. `screen.ts` maps source offsets to visual rows and
draws the viewport using absolute terminal coordinates.

When an instruction runs, source formatting targets 40 columns and adds an outer
parenthesized group with breaks at operators where needed. Existing groups are
reused. The parsed expression tree is checked before accepting a rewrite; string
literals and application chains with no safe break stay intact. Formatted source
appears in the editor and is what `save` writes, including after `load`.

Terminal wrapping is separate from source formatting and does not edit code.
Layout uses grapheme clusters and display widths; terminal resize recomputes
the viewport. The final terminal column is reserved to avoid native auto-wrap.
The alternate screen and raw input mode are restored on exit.

`readline` decodes keys and reads piped input; it does not own an interactive line,
history cursor, completion display or screen erasure. Piped input keeps the earlier
statement-oriented behavior and emits no screen controls.

Tests cover document replay with the interpreter, final screen contents and cursor
positions in a terminal emulator, and real keyboard input through a PTY. These
include exact-width wraps, Unicode, resize, scrolling, completion replacement,
paste, error focus and recovery.
