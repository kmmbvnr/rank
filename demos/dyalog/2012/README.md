# Dyalog Programming Competition 2012

Rank solutions to the [2012 contest](https://www.dyalog.com/uploads/files/student_competition/2012_problems.pdf), added task by task.

- [Hold’em Up!](001_poker.ra): Problem 1 Tasks 1–5 (#206–210). `handValue` accepts five rank/suit pairs with optional spaces and mixed case, and returns an integer ordered by poker strength. Categories and all kickers are encoded in base 13; suits do not break ties, and aces may be low in a straight. `bestHand` selects the strongest five cards from five community and two hole cards, returning space-separated card text. It checks all 21 subsets and preserves input order when values tie, considering hole cards first. `showdown` returns a table in player order with `.hand`, `.rank`, and `.used` columns. Tied values receive the same dense rank. `nuts` exhaustively checks legal unseen hole pairs and returns the smallest required set of hole cards; `*` marks an immaterial suit. `odds` enumerates all legal board completions without simulation or rounding. The first probability is an all-player tie; other entries are player win probabilities, sharing partial-tie equity equally between the tied winners. This resolves the contest’s unspecified partial-tie case while keeping the sum at one. Import with `use "001_poker"` and run `rank test demos/dyalog/2012/001_poker_test.ra`.

- [When in Rome…](002_roman.ra): Problem 2 Tasks 1–3 (#211–213). `atoR` converts Arabic numbers to scalar Roman text cells, preserving array shape. It uses canonical subtractive forms, empty text for zero, `¯` for negatives, and unlimited leading `M`s. Non-integers round toward positive infinity at halfway values (`floor(x + 0.5)`). `rtoA` parses Roman text and text arrays with subtractive pairs and the leading `¯` sign, retaining array shape. Run `rank test demos/dyalog/2012/002_roman_test.ra`.

- [Digital Fun](003_digits.ra): Problem 3 (#214). `problem3` evaluates 100 expressions to return exactly 1 through 100. Each right-hand side contains `123456789` exactly once, in order, with only `+`, `-`, and `*` inserted. Expressions were selected by exhaustively searching all 65,536 ways to insert these operations or concatenate adjacent digits, retaining the shortest expression for each target. This is a minimum within that search space, not a global minimum over Rank syntax. Run `rank test demos/dyalog/2012/003_digits_test.ra`.

- [Nurikabe](004_nurikabe.ra): Problem 4 Tasks 1–2 (#215–216). `valid` returns integer 1 for a completed valid board and 0 otherwise. White cells are 0 or positive clues; sea cells are -1. Flood filling checks each island’s clue count and size and sea connectivity, and a separate check rejects all-sea 2 by 2 blocks. `nurikabe` solves a clue matrix by enumerating connected island placements and searching for compatible placements, pruning forced sea squares and disconnected sea. It preserves the clues and input, validates the result, and raises `.NoSolution` for impossible puzzles. Masks use arbitrary-width integers. Run `rank demos/dyalog/2012/004_nurikabe.ra` for the published 7 by 7 puzzle, or `rank test demos/dyalog/2012` for all examples and regression tests.

`roman` returns a derived function that decodes its operands, calls the supplied numeric function, and encodes its result. Rank uses a one-element tuple to pass a function as data, and a two-element tuple to supply two operands to the derived function:

```rank
use "002_roman"
use numbers
maximum = ((tuple max) roman)
(array "II" "IX" "IV") maximum
(tuple "III" "II") maximum
```

These produce `IX` and `III`. Addition, range, sum and reshape examples are in the tests, including user-defined numeric functions and shape-preserving Roman matrices.

Function names start with a lowercase letter in Rank, so the contest’s `HandValue` is named `handValue`. All four problems and their issue tasks now have demos.
