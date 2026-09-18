# Turning solution drafts into Rank programs

Draft solutions for AoC, Project Euler, LeetCode, CSES, Kaggle and TPC-H are
language-design probes. A draft records an algorithm and possible notation; it
is not automatically valid Rank and is not a promise that every sketched word
belongs in the language.

The goal of reviewing a draft is twofold:

1. produce a runnable, tested solution;
2. discover general language features that make programs clearer and easier to
   enter on a phone or small physical keyboard.

## Review one task at a time

For each task:

1. Read the problem, draft and known example results.
2. Check every construct against the current wiki and interpreter.
3. Mark draft notation as current, obsolete, erroneous or a candidate feature.
4. Sketch the clearest solution possible with the current language.
5. When a general new feature could materially improve the result, compare the
   current and proposed forms before implementing it.
6. Ask the language owner to decide every new feature or contradiction.
7. After that decision, update the language and convert the task.
8. Add focused tests, run the full regression suite and commit the completed
   unit of work.

Do not silently preserve obsolete draft syntax. Do not hide a useful language
gap merely because a longer workaround exists. Conversely, do not add a
primitive solely because one puzzle can use it.

## When to propose a language feature

A candidate is worth discussing when it satisfies several of these tests:

- it applies beyond one puzzle or data set;
- it removes repeated indexing, temporary variables, nesting or bookkeeping;
- its source remains readable at roughly 40 columns;
- it is convenient on an Android letter or calculator keyboard;
- it composes with Rank's data-first calls, rank, axis, masks, lazy values and
  fixed inferred types;
- it has one predictable meaning rather than relying on a special puzzle case;
- its errors and edge cases can be specified and tested precisely.

A working workaround is not by itself a reason to reject a feature. Compare
the complete programs. A feature that saves one update line but requires a
long initialization ceremony may not yet improve the task.

## What to present for a decision

Before changing the language, show:

- the concrete pressure found in the draft;
- the current Rank spelling;
- the proposed spelling;
- the full semantic rule, including types, rank, laziness, mutation and error
  behavior where relevant;
- plausible alternatives and the ambiguity or cost of each;
- a recommendation based on readability and mobile input.

The language owner makes the final decision. Work that depends on the proposed
feature waits for that decision, while unrelated verified work may continue.

## Implement an accepted feature completely

An accepted feature is one change across the whole language:

1. grammar or ordinary module vocabulary;
2. interpreter behavior;
3. parser and runtime tests;
4. the relevant modular wiki pages;
5. `CURRENT_SPEC.md` when observable language behavior changed;
6. the example that motivated it.

Current behavior belongs in the specification. Unsettled designs and postponed
extensions belong in `open-questions.md`, not in `CURRENT_SPEC.md`. Code, tests
and specification must describe the same language before committing.

Prefer one commit for a language feature and a separate commit for the finished
task when that division makes review clearer.

## Preferred Rank solution style

Keep lines near 40 columns. Reduce parentheses by naming intermediate values
with short names that describe their contents or role. For example:

```rank
Range = 1 until 1000
States = Range next scan with Start
```

Keep parentheses when they are needed for grouping. See the
[intermediate-variable style rule](product-decisions.md#2-intentional-intermediate-variables-over-vertical-pipelines).

Start with the data transformation. Use array and sequence operations for work
that applies to a whole collection:

1. Build or bound the source values.
2. Derive a boolean mask with a comparison or predicate.
3. Apply the mask to select values, or use `indices` when the positions are the
   data needed by the next operation.
4. Use a reduction or another standard operation to produce the result.

Keep a `for` loop around this dataflow when the algorithm searches candidates,
needs early return, or carries state. Put a repeated transformation or test in
a small named function. Apply mathematical constraints before enumeration when
they remove whole classes of candidates.

Project Euler 51 follows this shape:

```rank
Places = 0 until Last

for Digit in 0 to 2
  Mask = Digits Places equal Digit
  Same = Mask indices

  for Pick in Same 3 combinations
    Family = Prime Pick replacement_family
    if (Family in primes) count at least 8
      return true
    end
  end
end
```

The comparisons, mask conversion, combinations, batch membership test and
count operate on collections. The loops express the search order and allow an
early return. The restrictions on digits, positions and combination size come
from the divisibility argument, so the program does not inspect candidates it
can rule out in advance.

Do not add a puzzle-specific primitive for this style. If a missing operation
would also clarify unrelated programs, define its general semantics and test it
as a language feature first. Use a direct scalar loop when a vector form adds
temporary structures or hides changing state.

## Shape of a runnable example

A program normally has this order:

1. problem comment and source link;
2. `use` declarations;
3. input declarations and top-level execution;
4. output;
5. documented functions at the end.

Use two spaces for every block. Put a short `rem` description before a function
when its purpose or algorithm is not obvious. Expose a `solve` function when a
test should provide prepared in-memory data without invoking file I/O.

Use tensor and sequence idioms when they make the algorithm shorter and clearer.
Keep direct BASIC-style loops when a vectorized form introduces more ceremony
or hides important state.

## Tests for examples

Place tests in a neighboring `_test.ra` file. Every test independently imports
the program under test so defaults and implicit structures start fresh:

```rank
use testing

test "official example"
  use "019_medicine"
  Data solve equal Expected
end
```

Tests should normally include:

- the official small example when one exists;
- one boundary or semantic case that could expose an interpreter mistake;
- both puzzle parts when the task has two parts.

Keep manageable text, JSON and tabular samples as literals inside the test.
Use fixture files only when file behavior itself is under test or the input is
too large to remain readable. Avoid repeating equivalent command-line and
direct-function tests unless they validate different language behavior.

## Verification and commits

Run the narrow example test first. When it passes, run the complete language and
interpreter tests. Use a broader example-directory run when its cost is
reasonable or when shared behavior changed. Check whitespace and the intended
diff before committing.

Classify failures before fixing them:

- invalid or obsolete draft notation;
- an interpreter defect;
- a specification contradiction;
- a useful missing language feature;
- an incorrect algorithm or expected result.

The language owner resolves specification contradictions and feature choices.
Commit only files belonging to the reviewed feature or task; leave later draft
solutions untouched. Push only when explicitly requested.
