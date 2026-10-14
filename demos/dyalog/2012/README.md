# Dyalog Programming Competition 2012

Rank solutions to the [2012 contest](https://www.dyalog.com/uploads/files/student_competition/2012_problems.pdf), added task by task.

- [Hold’em Up!](001_poker.ra): Problem 1 Tasks 1–3 (#206–208). `handValue` accepts five rank/suit pairs with optional spaces and mixed case, and returns an integer ordered by poker strength. Categories and all kickers are encoded in base 13; suits do not break ties, and aces may be low in a straight. `bestHand` selects the strongest five cards from five community and two hole cards, returning space-separated card text. It checks all 21 subsets and preserves input order when values tie, considering hole cards first. `showdown` returns a table in player order with `.hand`, `.rank`, and `.used` columns. Tied values receive the same dense rank. Import with `use "001_poker"` and run `rank test demos/dyalog/2012/001_poker_test.ra`.

Function names start with a lowercase letter in Rank, so the contest’s `HandValue` is named `handValue`. The remaining contest tasks are not implemented here yet.
