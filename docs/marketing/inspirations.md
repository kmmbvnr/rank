# Languages to learn from

A reading list for Rank's design, with the specific thing worth taking from each
one. Entries marked *(survey)* came out of the [Landscape](landscape.md) search;
the rest are prior art we should read regardless of what HN says about it.

Rank's principle 5 applies to this whole page: borrow general concepts, not
one-off primitives.

## Read first

### Lil — [beyondloom.com/decker/lil.html](https://beyondloom.com/decker/lil.html) *(survey)*
The nearest neighbour. A k-derived language with readable syntax where tables and
SQL-ish queries live in the same value model as lists.
**Take:** how one value model absorbs tables without a second sublanguage; where
their query clause stops being sugar and starts being semantics — the same
boundary Rank draws around `filter ... end` (principle 12).

### BQN — [mlochbaum.github.io/BQN](https://mlochbaum.github.io/BQN/) *(survey)*
APL rebuilt with modern hindsight, and unusually well documented about *why*.
**Take:** leading-axis theory, the array model (nested vs flat), and the
[commentary on what deserves to be a primitive](https://mlochbaum.github.io/BQN/commentary/primitive.html) —
directly applicable to Rank's principle 5 and to `docs/design/open-questions.md`.

### PRQL — [prql-lang.org](https://prql-lang.org/) *(survey)*
A pipelined, word-based replacement for SQL.
**Take:** naming. PRQL is the largest existing experiment in choosing English
words for relational operations, and the closest thing to a validated vocabulary
for `filter`, `select`, `group`, `sort`. Diverge deliberately, not accidentally.

### APL / Iverson — [Notation as a Tool of Thought](https://www.jsoftware.com/papers/tot.htm) *(survey)*
The founding argument that notation shapes thinking.
**Take:** the argument itself. Rank inverts the conclusion (words, not glyphs)
while keeping the premise, and should be able to say why in one paragraph.

## Array family, for semantics

### K / Klong — [t3x.org/klong](https://t3x.org/klong/) *(survey)*
**Take:** how few primitives a complete array language actually needs. Klong is
an explicit exercise in "simpler k" and is a good yardstick when the stdlib
starts growing.

### J
**Take:** rank (the concept) — how a verb's rank determines which cells it
applies to. Relevant to `docs/language/tensors.md`, and the language shares its
name with the idea for a reason.

### Julia — [docs.julialang.org](https://docs.julialang.org/en/v1/base/arrays/)
**Take:** a pragmatic split between iterating values, efficient indices and
slices along named dimensions. `eachindex` keeps storage traversal separate
from Cartesian coordinates, while `eachrow`, `eachcol` and `eachslice` make
axis-oriented traversal explicit. Rank should learn from this division when it
defines tensor `for`: ordinary iteration, cell-rank iteration and a chosen axis
are related operations, but they need not be one overloaded special case.

### Uiua — [uiua.org](https://www.uiua.org/) *(survey)*
**Take:** a live counterexample. Uiua rebuilt notation from scratch and chose
glyphs. Reading their rationale is the fastest way to find the weak points in
Rank's word-based bet.

### Ivy — [github.com/robpike/ivy](https://github.com/robpike/ivy) *(survey)*
**Take:** array language as a calculator — the REPL ergonomics of a tool you
reach for on a small device, and exact/big-number arithmetic by default.

### q / kdb+
**Take:** qSQL — keyword-based queries over columnar data in the same language as
the array primitives, with decades of production use behind the vocabulary.

## Query and dataframe vocabulary

### SQL
**Take:** the words everyone already knows. Deviating from `select`/`where`/
`group by` costs the reader something; charge that cost only where Rank's model
genuinely differs.

### dplyr (R) and Polars
**Take:** verb-per-operation pipelines, and — from Polars — expressions as
first-class values that are built up before being applied. Rank's masks are
first-class (principle 10); Polars is the reference for how far that idea goes.

### Ibex — [typed dataframe language](https://bobjansen.net/ibex-a-typed-dataframe-language-with-c-code-generation/) *(survey)*
**Take:** what typing a dataframe implies for column-name-driven syntax like
Rank's `.Age`.

## Readability and approachability

### BASIC (the lineage)
**Take:** the tone Rank inherits — `rem`, no ceremony, immediate feedback. Also
the warning: the category is now defined by retro compatibility, see
[Positioning](positioning.md).

### easylang — [easylang.online](https://easylang.online/ide/) *(survey)*
**Take:** the packaging, not the language. A browser IDE that runs the first
example within seconds of arrival is the single highest-leverage asset for a
language nobody has installed.

### Smalltalk
**Take:** keyword messages — how naming argument positions makes punctuation-free
call syntax readable rather than ambiguous. Relevant wherever a Rank word takes
more than one argument.

### Inform 7 / AppleScript
**Take:** a cautionary tale. English-like syntax fails when the surface no longer
predicts the semantics and the user has to guess the accepted phrasing. Rank's
defence is a small closed vocabulary (principle 4), and that defence should be
tested against these two.

### Forth — [forth-standard.org](https://forth-standard.org/)
**Take:** narrow source, a tiny core and the data-before-operation order, proven
under real hardware constraints. Rank should keep the readable left-to-right
flow without exposing stack manipulation as the main programming model.

### Factor — [docs.factorcode.org](https://docs.factorcode.org/content/article-cookbook-syntax.html)
**Take:** the closest syntactic relative for Rank's data-first calls. Factor's
`10 sq 5 -` demonstrates postfix evaluation, and its documented stack effects
show one way to make arity explicit. Rank takes the data-first order but prefers
named intermediate values over implicit stack chains; it keeps addressing and
shaped values instead of becoming a concatenative stack language.

## Tooling and delivery

### Decker (the host of Lil) *(survey)*
**Take:** shipping a language inside an environment people want to use anyway.
The language is not the product; the thing you make with it is.

### Editor support
Rank's principle 6 promises the editor helps with quotes and blocks while the
source stays plain text. The array world's soft-keyboard and glyph-input schemes
(BQN's and Uiua's editor stories) are the prior art for on-screen input — which
is the phone keyboard problem in a different costume.
