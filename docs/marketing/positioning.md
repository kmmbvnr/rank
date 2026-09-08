# Positioning

Derived from the survey in [Landscape](landscape.md). This page is about how
Rank is described to other people; it does not constrain the language design.

## One-line positioning

> A readable array language — the power of APL's model with words instead of
> glyphs, small enough to write on a phone.

The three claims, in the order they should land:

1. **Readable array language.** The interesting part. Nobody owns this.
2. **One addressing model** for arrays, tables and tensors (principle 8) — the
   proof that "readable" did not cost expressive power.
3. **Fits a narrow screen.** The memorable detail and the origin story, not the
   headline.

## Why not lead with BASIC

The survey is unambiguous. "Another modern BASIC" caps out near 80 points on HN
and puts Rank in a category defined by retro compatibility and games — where the
comparison set is twinBASIC and QB64, and where data analysis and tensors read as
off-topic. "Better than a thing you already use" is what travels: PRQL cleared
400+ points three separate times with that framing.

BASIC stays in the story as *lineage and tone* — `rem`, capitalized variables,
no ceremony — and as the answer to "why is it approachable". It is not the
headline.

## Audiences, in priority order

| Audience | What they already feel | Rank's line |
|---|---|---|
| Array-curious programmers who bounced off APL/J/k | "The ideas are great, the notation is a wall." | Same model, spelled in words you can type and search. |
| Data people tired of SQL/pandas ceremony | PRQL's audience, exactly. | One addressing model for tables and arrays — no switching between two mental models. |
| Competitive programmers / puzzle solvers | Terse code is the point; typing is the tax. | 40-column solutions to Euler, LeetCode, TPC-H — already in `demos/`. |
| Phone, calculator and tiny-computer tinkerers | The niche with an open thread and no answer. | A language you can actually type with thumbs. |

## Proof assets we already own

`demos/` is the strongest marketing material in the repo, because it answers the
first question any skeptic asks — *show me real code*:

- `demos/euler/` and `demos/leetcode/` — algorithms, against a known baseline.
- `demos/tpch/` — the query story, i.e. the PRQL comparison.
- `demos/kaggle/` and `demos/coreml/` — tables and tensors in the same language.

A side-by-side of one TPC-H query in SQL, PRQL and Rank, and one LeetCode problem
in Python and Rank, would carry more weight than any prose on this page.

## Launch angles, ranked

1. **"A readable array language"** — the empty intersection, and the only claim
   nobody can answer with "that already exists".
2. **"One model for arrays, tables and tensors"** — technically the most
   interesting claim to the array crowd; Lil is the honest point of comparison.
3. **"Written for a 40-column screen"** — great hook, weak thesis alone. Pairs
   well with either of the above.
4. **"A modern BASIC"** — the framing to avoid as a headline.

## Honest comparisons to prepare for

Anyone who knows the field will raise these; having answers ready is cheaper than
being surprised by them.

- **"This is Lil."** Nearest neighbour. Answer must be concrete: tensors and the
  narrow-screen constraint, and where the two addressing models genuinely differ.
- **"Words are just verbose glyphs."** The BQN/Uiua counterargument. Answer with
  the `demos/` line counts, not with opinion.
- **"Why not PRQL for tables and NumPy for arrays?"** Answer: because that is two
  mental models, and Rank's principle 8 is the whole bet.
- **"Nobody programs on a phone."** True today, and the linked Ask HN thread says
  why: punctuation and keyboards. That is the argument, not a rebuttal to dodge.
