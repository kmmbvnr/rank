# Landscape

**Survey date — 2026-09-08.** Method: Hacker News (Algolia full-text search over
stories) queried along each of Rank's design axes separately — array languages,
word-based query syntax, modern BASIC, and programming on phones. Point counts
are HN scores at survey time and are used here only as a rough signal of how
much an angle resonates with a technical audience.

## Why this page exists

Rank sits at an intersection: a word-based, punctuation-light language with one
addressing model for arrays, tables and tensors, sized for a narrow screen. Each
of those axes is occupied on its own. The intersection is not. This page records
who the neighbours are so positioning is argued from evidence rather than
memory.

## Neighbours: array languages fighting for readability

| Project | Relation to Rank | HN |
|---|---|---|
| [Lil](https://beyondloom.com/decker/lil.html) (in Decker) | **Closest in spirit.** A k-family scripting language with a human-readable syntax and, crucially, tables plus SQL-like queries over the same value model — Rank's principle 8. | [104](https://news.ycombinator.com/item?id=33393283) |
| [Uiua](https://www.uiua.org/) | Array language with a deliberately rebuilt notation. Went the opposite way from Rank: toward glyphs, not words. | [334](https://news.ycombinator.com/item?id=37673127) |
| [BQN](https://mlochbaum.github.io/BQN/) | APL redesigned with modern hindsight. Useful as a catalogue of already-solved array semantics questions. | [88](https://news.ycombinator.com/item?id=33180842) |
| [Klong](https://t3x.org/klong/) / [KlongPy](https://github.com/briangu/klongpy) | Small array language whose stated goal is a simpler, more readable k. | [130](https://news.ycombinator.com/item?id=44327173) / [93](https://news.ycombinator.com/item?id=35400742) |
| [Ivy](https://github.com/robpike/ivy) | An array language shipped as a *calculator* — the same "small device, computation at hand" niche Rank targets. | [47](https://news.ycombinator.com/item?id=8736303) |
| [Zoo of array languages](https://ktye.github.io/) | Ready-made survey of the whole family; the cheapest way to check for prior art. | [178](https://news.ycombinator.com/item?id=45578540) |

Background reading this audience returns to repeatedly, and which argues Rank's
principles 3-5 better than we could:

- [Notation as a Tool of Thought](https://www.jsoftware.com/papers/tot.htm) — Iverson, 1979. Posted many times; [322](https://news.ycombinator.com/item?id=43789593), [203](https://news.ycombinator.com/item?id=25249563), [188](https://news.ycombinator.com/item?id=32178291).
- [Array languages vs. the curse of the spreadsheet](https://blog.dhsdevelopments.com/array-languages-vs) — [138](https://news.ycombinator.com/item?id=39608822).
- [Thinking in an array language](https://github.com/razetime/ngn-k-tutorial/blob/main/c-thinking-in-k.md) — [300](https://news.ycombinator.com/item?id=38981639), [141](https://news.ycombinator.com/item?id=31377262).

## Neighbours: words instead of punctuation, for data

- **[PRQL](https://prql-lang.org/)** — the strongest signal in the whole survey.
  A pipelined, word-based replacement for SQL that landed on HN's front page
  repeatedly: [650](https://news.ycombinator.com/item?id=30060784),
  [519](https://news.ycombinator.com/item?id=36866861),
  [430](https://news.ycombinator.com/item?id=34181319),
  [378](https://news.ycombinator.com/item?id=31897430), plus ecosystem posts
  ([PRQL in PostgreSQL, 267](https://news.ycombinator.com/item?id=39428609),
  [DuckDB extension, 105](https://news.ycombinator.com/item?id=39130736)).
  Rank's `filter ... end` and `Data .Age greater 18` are the same move, applied
  beyond tables.
- [Ibex](https://bobjansen.net/ibex-a-typed-dataframe-language-with-c-code-generation/) —
  a typed dataframe language; small ([5](https://news.ycombinator.com/item?id=47110873)) but the niche overlaps.

## Neighbours: modern BASIC

| Project | Note | HN |
|---|---|---|
| [easylang](https://easylang.online/ide/) | BASIC-like teaching language with a browser IDE. | [76](https://news.ycombinator.com/item?id=22841336) |
| [MoonBASIC](https://github.com/CharmingBlaze/moonbasic) | Modern BASIC aimed at 2D/3D games. | [76](https://news.ycombinator.com/item?id=48910579) |
| [twinBASIC](https://twinbasic.com/) | Modern BASIC chasing VB6/VBA compatibility. | [78](https://news.ycombinator.com/item?id=31976614) |
| [Ask HN: opinions on modern BASIC dialects](https://news.ycombinator.com/item?id=28535810) | Comments are a useful cross-section of the audience. | 29 |

The pattern is clear: "another BASIC" tops out around 80 points. Retro
compatibility and games dominate the category; algorithms and data do not appear
in it at all.

## The gap: programming on a phone

Nothing in the survey is a language designed for a narrow screen. The only
substantive thread is
[Ask HN: Why don't people program on their phone?](https://news.ycombinator.com/item?id=18363180)
(23), where the discussion converges on the keyboard and on punctuation — that
is, exactly the problem Rank's principles 1-3 attack. Adjacent but not
competing: [Vibe coding a static site on a $25 phone](https://news.ycombinator.com/item?id=46480677) (76).

## Conclusion

No direct competitor exists. Every axis of Rank is occupied separately — arrays
(Uiua, BQN, Klong), tables plus words (PRQL), tables plus arrays (Lil), retro
BASIC (easylang) — but the intersection, a word-based array-and-table language
sized for a small screen, is empty.

For positioning consequences, see [Positioning](positioning.md). For what to
borrow from each of these, see [Languages to learn from](inspirations.md).
