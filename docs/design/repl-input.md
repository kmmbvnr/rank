# REPL input on a phone keyboard

The REPL is the first place Rank is typed rather than read, and the first place
principle 2 — prefer letters, digits, spaces and easy keyboard symbols — is
tested against a real keyboard. This page is the inventory of what the language
asks a thumb to do, and the rules `rank` now applies to make that cheaper.

No highlighting is involved. The REPL helps with quotes, brackets, blocks and
indentation, and the source it runs stays plain Rank text, as principle 6 says.

## What the language actually requires

The grammar has **50 word keywords** and **22 symbol tokens**:

```text
words    and args argument array as at break by catch continue elif
         else end equal false finally flag for fun greater if in
         index is least less many memo most multiple new not option
         or pad push record return run shape stdin test to true try
         unpack until use xor yield
symbols  = += -= *= **= /= //= %= and= or= xor=
         + - * ** / // % ( ) . #
```

Plus `"` for text and the digits. Every operator that could have been a symbol
already is a word: `and or xor not`, `equal less greater`, `at least`,
`at most`, `multiple by`, `in`, `is`, `to until by`, `pad`. So the symbols that
remain are not decoration — each one is load-bearing.

## Which construct costs what

| Construct | Typed as | Symbols |
| --- | --- | --- |
| module | `use numbers` | none |
| aliased file | `use "lib" as Lib` | `"` |
| function | `fun name X` … `end` | none |
| memo function | `memo name X` … `end` | none |
| loop | `for i in 1 until N` … `end` | none |
| condition | `if A greater B` … `else` … `end` | none |
| error handling | `try` … `catch .kind E` … `end` | `.` |
| test | `test "name"` … `end` | `"` |
| exit | `return X`, `yield X`, `break` | none |
| queue, set, counter | `Q push X`, `set add X` | none |
| structure | `new graph`, `new index` | none |
| comparison, logic | `A at least B and not C` | none |
| range | `1 to 10 by 2`, `1 until N` | none |
| application | `A sum print`, `A sort by .x` | `.` for a field |
| materialize | `1 to 5 array` | none |
| array by items | `array 1 2 3` | none |
| array by shape | `array shape 2 3` … `end` | none |
| filled array | `array shape 2 3 pad 0` | none |
| input | `stdin .integer` | `.` |
| **assignment** | `A = 3` | **`=`** |
| compound assignment | `A += 3`, `A and= B` | `=` |
| array assignment | `A 2 3 = V` | `=` |
| index, unpack | `index K = V`, `unpack A B = X` | `=` |
| record | `record` … `.x = 1` … `end` | `.` `=` |
| arithmetic | `A + B * C` | `+ - * / // % **` |
| grouping | `(A + B) * C` | `( )` |
| whole axis | `M # 2` | `#` |
| text, real number | `"hi"`, `1.5` | `"` `.` |

Read the table as one finding: **assignment is the most frequent statement in
Rank and `=` is the symbol a phone keyboard is least likely to put on its first
layer.** On a typical Android layout the digits layer carries
`@ # $ _ & - + ( ) / * " ' : ; ! ?`, and `=` and `%` sit one layer deeper.
Layouts vary by keyboard and locale, so nothing here bets on one layout.

## Three ways to type `=`

`=` must stay in the source. It is the shape assignment has in every language a
reader has met, and a program written with a word in its place reads worse than
one that costs an extra tap. So the answer is not to replace the symbol but to
replace the *keystroke*:

1. **The comma or colon key.** Type `,` or `:` and the REPL turns it into `=`
   the moment it is typed. Neither is a Rank token: a scan of all 683 demo
   programs finds **zero** commas and **zero** colons outside a text literal or
   a `rem` comment, so either one elsewhere could only ever have meant `=`. The
   rewrite is therefore unambiguous rather than a guess. The comma is the
   cheaper key — it sits on the letter layer, next to the space bar, so
   assignment costs no layer switch at all. These replace the `=` *key*, not a
   token, so `*,` gives `*=` and `and,` gives `and=` with no extra rule.
2. **A keyboard row.** In Termux, `extra-keys` in `~/.termux/termux.properties`
   puts a permanent row above the keyboard; adding `=` there makes it one tap in
   every program, not just this REPL. Some keyboards can also put a number row,
   which usually carries `=` with it.
3. **The word `gets`**, for a keyboard that offers neither.

The first two leave the symbol in the source and only change how the key is
reached. The third is the fallback described below.

## The rules the REPL applies

**One statement per Enter.** A line runs when it can end a statement and no
block is open.

**A line that cannot end a statement folds.** If the last token is an operator,
an `=`, an open bracket, or a word that demands a right operand, the next line
is appended to it with a space. Whitespace is a hidden terminal in Rank, so the
joined line is ordinary source.

```console
rank> A gets 5 plus
....>   6
    A = 5 + 6
11
```

**Blocks read on.** `test fun memo try if for` at the start of a statement,
`record` anywhere, and `array … shape …` without a `pad` open a block; `end`
closes one. The prompt names the innermost one.

**A blank line finishes everything open** — the folded line, then one `end` per
open block:

```console
rank> fun triple X
fun.>   return X * 3
fun.>
    fun triple X
      return X * 3
    end
<function triple>
```

**A quote and a bracket close themselves** at the end of a line, so each costs
only its opening keystroke. `A gets (1 plus 2` runs `A = (1 + 2)`.

**A wide line is wrapped into brackets.** A stored line over 50 characters is
broken to about 40, which is the target of principle 1:

```text
Revenue = (
  Price * Discount + Quantity * Extra
  + More
)
```

Rank continues an expression across lines only inside brackets, so the wrap adds
them and breaks only before the operators the multiline grammar allows — never
inside an application chain, a `sort by`, or a `not equal`. Brackets already
there are reused rather than doubled, and a line with nowhere to break, such as
a long chain of names, is left alone rather than mangled.

The wrap is then checked against the parser and dropped whole if the result does
not parse, so a rule that turns out to be wrong costs a wide line and never a
broken one.

**The REPL owns indentation.** Every line is indented two spaces per open block
as it is typed and again when it is stored. Typing leading spaces is never
necessary and never wrong.

**The comma and the colon are the `=` key.** They are replaced as they are
typed, so the line on screen is always the Rank that will run:

```console
rank> Total, 6
6
rank> Total *, 7
42
```

Inside `"text"` and after `rem` a comma stays a comma, which is where every one
of the corpus's commas and colons lives.

**The line is formatted while it is typed.** Every binary operator takes one
space on each side, doubled spaces collapse, and a line that begins with `end`,
`else`, `elif`, `catch` or `finally` steps back out to its block's level as the
word is completed — the indent disappears under the cursor rather than being
backspaced by hand. A `+` or `-` that no operand precedes is a sign and stays
attached to its number, `.` and brackets are left alone, and text and comments
are never touched. So `A,B+1` is stored, echoed and saved as `A = B + 1`, and
nothing has to be spaced by hand.

**Words stand in for symbols.** A word becomes its symbol only in operator
position, and never when the session already binds that name:

```text
gets  =      plus  +      minus  -      times  *
over  /      idiv  //     mod    %      power  **
every #
```

`gets` is the fallback for `=`; the comma key is usually the better one.

`times gets` becomes `*=`, and `and gets` becomes `and=`. Whatever was rewritten
is echoed as real Rank before it runs, so the symbol form is what gets learned.

**Tab completes** module names after `use`, otherwise session names, the names
of every module in use, keywords, the alias words, and the commands.

**The commands answer without leaving the prompt:** `help` for the input rules,
`forms` for how to type each construct, `ops [module]` for the names callable
now, `vars` for the names bound and their types, `save F` and `load F` for a
real `.ra` file, `alias on|off`, `exit`. Every line of output fits 40 columns.

**History persists** in `~/.rank_history`, because retyping on a phone is the
most expensive thing there is.

**Piped input follows the same rules**, except that a blank line is only a blank
line, so a whole program can be piped into the REPL.

## What this deliberately is not

None of this changes the language. The `=` keys, the spacing and the alias words
are input, not syntax: the screen shows the symbol form, `save` writes it, and a
`.ra` file on disk never contains `gets` or a bare `,`. A session that defines
its own `times` keeps it. What a reader sees is always `A = 3`.

## What is still awkward

- A statement with no operator to break at stays wide: an application chain has
  no place a line may end.
- `.` before a label, `"` to open text, and the digits have no cheaper form.
  `.` is usually on the letters layer and `"` on the first symbol layer, so
  neither costs what `=` did.
- Compound assignment reads oddly as `A times gets 2`; `A *, 2` does not.
- A text literal cannot span lines in the REPL, because an unclosed quote is
  closed at the end of the line. A file can still hold one; `load` it.
- A number typed with a decimal comma becomes an assignment: `1,5` is `1 = 5`.
  It was never valid Rank, but the error it gives is now a stranger one.
- A blank line inside a block is unavailable interactively, since that is the
  gesture that closes blocks.

## Open questions

- Should the alias words become real Rank? Probably not, now that the colon key
  reaches `=` directly: the words would cost nine reserved names and make the
  source read worse, which was the objection that produced the colon key.
- Should the `=` keys work in the HTML editor too, or does a custom keyboard row
  there make them unnecessary?
- Should the wrap ever break an application chain, which would need a
  continuation form the language does not have?
- Should `save` insert brackets so a folded statement survives as several narrow
  lines?
- Should the REPL keep a cell history that the editor can open, or is a `.ra`
  file the only durable form?
- Which of these rules belong in the HTML editor unchanged, and which only make
  sense at a prompt?

Related: [Console, editor and the analysis core](editor-plan.md),
[Lexical syntax](../language/lexical-syntax.md),
[Open questions](open-questions.md).
