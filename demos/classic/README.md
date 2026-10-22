# Classic problems

Standalone Rank solutions to classic algorithmic problems.

- [N-Queens](queens.ra) — find all non-attacking placements on a square board and print them with `Q` and dots. `Size` defaults to 8.
- [Eight Queens by Permutations](queens_permutations.ra) — filter all permutations of columns 0 through 7 and print the 92 boards.

The Queens examples retain their solutions and defer the board mask and text
with apostrophe bindings. Printing consumes the rendered boards without storing
the whole text tensor. Search state and the writable availability mask remain
ordinary bindings.

The [fold example](fold.ra) accepts a deferred input and visits it once, updating
an ordinary accumulator after each item.
