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

Loop iteration rows participate in Up/Down navigation without activating a
selector or executing code. Enter on an iteration row enables selection;
Left/Right then select and evaluate the preview. Ctrl-G opens the same selector
from a source line in the innermost enclosing loop, opening its preview even if
it was already executed. Enter leaves selection; when entered from the header,
it advances to the first body line without evaluating it. Otherwise it restores
the source cursor.
Esc (or Ctrl-G during selection) also closes a completed instruction's live
preview without changing its source: Enter then inserts a newline again.
Up/Down can leave the iteration
row directly for the header/body. Only an active selector has a highlighted
background. Enter on a loop header does not activate it automatically.
Ctrl-R on a loop header evaluates the header and immediately activates iteration
selection; no extra Enter is needed. Arrow navigation still reaches the passive
iteration row, where Enter activates selection. Source editing has a bar cursor. Places where
Enter evaluates code use a block cursor, as does the iteration row whether or
not selection is active. The terminal's default
cursor style is restored on exit.
The `▶` source marker identifies the next line to evaluate, including while the
cursor is on the iteration selector. Changing the iteration recalculates only
the prefix above that marker. Ctrl-R advances it with evaluation; ordinary
text editing has no marker. If the selector and marker fit together they remain
visible; otherwise the footer names the next source line, for example `▶ line 6`.
Ctrl-R on a function body line evaluates through that line using the existing
example arguments; it asks for arguments only when values are missing or skipped.
Entering evaluation with Ctrl-R keeps the cursor at the same screen row when example fields and preview
results appear above it, scrolling the viewport as needed.
During source evaluation, Enter inserts a temporary newline, including before
`end`. Leaving that line empty removes it; entering code keeps it. Existing blank
lines are preserved. Ctrl-R continues evaluation with the saved example arguments.
Enter still accepts parameter examples and iteration selections.
Ctrl-T reopens function example arguments. Up from the first visual row of the
function body focuses the last parameter's example value; Up/Down then move
between parameters. Up from the first parameter reaches the function header;
Down from the last reaches the first body line. Down from the header returns to
the first parameter. Arrow navigation preserves example edits without evaluating
them. Enter accepts the example and returns to the body.
The mouse wheel scrolls the terminal viewport by three rows without moving the
editing cursor. Typing or cursor navigation brings the cursor back into view.
In the terminal, a left click places the cursor in source or an example value,
including wrapped rows. Clicking results does not edit them. Copy view disables
mouse capture so the terminal can select text normally; leaving the REPL restores
normal mouse handling.
Accepted examples display a bounded value summary below each parameter, unless
it repeats the expression already shown in the field. Text
keeps its quotes, and arrays show their shape and up to eight items. Editing the
expression hides its old summary until it is accepted again. Summaries do not
consume sequences or evaluate lazy array items.

Runtime errors inside user functions include the function name and argument
values, including the actual cell passed by `rank`. Nested calls retain up to
eight frames; tail calls show the current call. These details also appear in
compact REPL errors without replacing the original error kind or source location.

Up above the first source row opens a blank instruction before it, so imports
can be added above an unfinished first block. Up on that empty instruction does
not add more rows. The existing block retains its draft and live editing state.
The inserted row is temporary until it contains text. Leaving it empty with
Down or returning to `rank>` removes it and restores the previous numbering.
Existing blank source rows are not removed.

Leaving an unfinished live block to edit earlier source suspends its live controls
and preserves the draft. Enter in earlier source edits that instruction; Ctrl-R
executes the selected instruction above the draft without submitting it. Returning
to the unfinished block resumes its live controls.

Submitting a draft adds it to the document **before** execution starts. If earlier
source changed, execution starts at the earliest changed instruction, continues
through the following instructions, then reaches the newly submitted one. An
empty Enter at the bottom resumes pending work. When nothing is pending, it adds
a blank source line.
Blank lines have no status circle and are saved as spacing, without execution.
Ctrl-R on committed source executes only the selected top-level instruction,
against retained interpreter state, then stops at the next instruction. Enter
continues one step at a time; at a loop it opens the iteration preview rather
than executing the whole loop. Completing an existing block also stops before
the next instruction. A grouped cell keeps its surrounding source intact when
only one of its statements is run. Partial grouped-cell execution remains pending.
When Ctrl-R runs a whole cell, it removes bindings first declared by that cell
before evaluating it again, so an edited declaration can change its type or name.
Assignments to names declared in other cells still check their existing types.
Ctrl-R at the bottom prompt retains submission behavior.
On the first nonempty source instruction, Ctrl-R resets interpreter state first,
but still executes just that instruction. Continuing with Enter from there is a
clean sequential run; live iteration previews remain experiments until committed.
Esc leaves stepping. Moving up from `rank>` into earlier source always returns
to text editing, even if that instruction previously had an open live preview.
During this evaluation mode Ctrl-R confirms an iteration selection, advances to
the body, and evaluates subsequent lines. Enter in source inserts a temporary line.
After leaving evaluation mode it resumes its normal start/restart behavior.

Ctrl-L restarts the document from fresh interpreter state, resetting variables,
generators, and execution provenance. It runs current source from the beginning
and stops at the first error. A complete bottom draft is included; an unfinished
draft is preserved for further editing, with its old live previews cleared.
The restart does not save or reload the file and preserves its saved/unsaved
status. External effects from the previous run are not undone.

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
- Green: finished successfully in sequence from fresh interpreter state.
- Orange: finished after replaying previously executed code against retained
  state. The replayed instruction and subsequent results, including new
  instructions, keep this provenance until the document is loaded into a fresh
  interpreter or restarted with Ctrl-L. This is conservative and does not analyze side effects.
- Red: execution stopped with an error.

Live line previews also use orange for evaluated lines, red for errors, and gray
for lines not yet evaluated. They are experiments, not a sequential document run.
Navigation and editing alone do not change execution provenance. Pending edited
instructions remain gray until execution; errors and running states take priority.

Each run replaces that instruction's previous output. A successful correction
therefore removes the old error. Output below the first error retains its previous
value until rerun; its gray instruction circle identifies it as pending.
Retained output awaiting execution also has a `~` gutter marker.
Normal output is gray; error output is red.
Errors in the REPL source show only their type and message inline; the repeated
`error: RankError` prefix is omitted (for example, `TypeError: ...`). The
path, source excerpt, and caret are omitted. Errors originating in imported files
retain their location. Full diagnostics remain available in session output for
non-interactive execution.
Live expression errors retain the evaluated expression with its parentheses,
without the generated preview variable assignment.
Inline errors wrap within 40 display columns including their gutter and indentation,
or within the terminal width when it is narrower.
Messages wrap at word boundaries; a word is split only when it cannot fit on a
line by itself.
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

Bracketed paste inserts text, including newlines, without executing it. On Enter,
top-level instructions become separate cells with their own results, while blocks
and multiline expressions stay together. Home/End
move to the logical line boundaries. Backspace/Delete operate on grapheme clusters.
Page Up/Page Down scroll through output without moving the source cursor.
Ctrl-Z/Ctrl-Y undo and redo edits within the current instruction. Ctrl-P/Ctrl-N
recall typed history. Ctrl-C without a selection returns to the prompt and clears
the draft; Ctrl-Q exits.

Shift+arrows and Shift+Home/End select source, including across instructions.
Selection excludes prompts, outputs, and command cells. In the browser, Cmd-C/X/V
on macOS and Ctrl-C/X/V on other platforms copy, cut, and paste without executing.
The CLI uses Ctrl-C/X/V for its internal selection on all platforms: terminal
applications handle Command shortcuts themselves and do not forward them to Rank.
On macOS, terminal Cmd-C copies the terminal's native selection and Cmd-V pastes;
it does not copy Rank's internal Shift selection. Typing, Backspace, Delete, or a paste
replaces the selection; Esc clears it. Ctrl-Z/Ctrl-Y undo and redo edits.
Example argument fields support the same selection and clipboard keys.
The CLI uses the system clipboard: `pbcopy`/`pbpaste` on macOS, PowerShell on
Windows, or `wl-copy`/`wl-paste` on Wayland and `xclip` on X11. If the clipboard
is unavailable, it reports the failure and leaves the selection intact.
The terminal's own paste shortcut and bracketed paste remain supported.
While execution is running, Ctrl-C still interrupts it.

In the terminal, dragging the left mouse button selects source. The browser also
supports native mouse selection and touch long-press selection with the system
Copy menu. Copying a range containing source omits prompts, markers, and output.
Rendering waits while a native selection is active so selection handles survive
viewport changes. A quick vertical swipe scrolls; long-press selection is left
to the browser. Browser copy, cut, and paste use native clipboard events,
including Cmd-C/X/V on macOS, without requesting clipboard API permissions.

In the terminal, Ctrl-H toggles a read-only copy view: only source remains,
including the unfinished draft, without prompts, line numbers, results, example
fields, or the footer. Arrows and Page Up/Down scroll; Home/End jump to the ends.
Ctrl-H or Esc restores the previous view and editing cursor. Typing and pasting
in copy view do not edit the document. Ctrl-H uses byte 0x08; Backspace sent as
DEL (0x7f) still deletes normally.
History persists in `~/.rank_history`.

## Saving and exiting

The footer shows the current file name and `saved` or `unsaved`. A successful
`load FILE` or `save FILE` binds that path to the document. Ctrl-S writes to that
file; a new document opens a filename editor. Saving includes source still in the
bottom prompt, without executing it, and excludes commands and their output.
Undoing an edit back to the saved text clears the unsaved marker. Execution status
and saved status are independent.

Run hints fit within 40 terminal columns (reserving the last column for safe
terminal rendering). The bottom prompt shows `Ctrl-L run all` without an Enter
hint. The source editor shows `Ctrl-R run · Ctrl-L run all`;
`^` means Ctrl. Live loop source shows `Eval · ^G loop · Esc edit · ^L run all`,
an iteration row shows `Enter select · Esc edit · ^L run all`, and active
selection shows `←/→ select · Esc edit · ^L run all`.

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

Tab in leading whitespace first moves to the code indentation, inserting missing
spaces according to the enclosing blocks. Once there, Tab offers completion.
