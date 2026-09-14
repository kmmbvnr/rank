# Looking at a sequence without spending it

Implemented in the CLI. `SequenceReplay` in `packages/cli/src/sequence-replay.ts`
keeps yielded values and records the consuming source line and read position of
each generator. Stored native ordered sources such as `primes` and `fibonacci`
also keep a cursor and a history of positions by source line. The interpreter
exposes creation and assignment hooks; ordinary file execution does not install
them or allocate replay tapes.

## Looking and consuming

```rank
use sequences
use numbers
fun nums N
  yield N
  yield N + 1
end
G = 3 nums
G
A = G array
A sum
```

The assignment and `G` both show `3 4`. Neither spends the sequence. `G array`
delivers those values to the program and consumes it. Another `G array` below
that line still raises `.ConsumedSequence`. A new `G` shows only its unread tail:
after `G 0` it shows `4`, and after `G array` it is empty. `full` uses the same
current read position without consuming the remaining values.
As before, requesting an endless value in full does not terminate.

A preview of a sequence with unknown size takes at most ten items. It does not
scan for a count or pull an extra item just to discover whether there is more.
If the end was not reached, the note says `size unknown`. Finite sequences with
a known size retain the existing bounded scan for their two ends.
Automatic result previews use at most 40 text columns, reduced further when the
terminal has less space after the source gutter. A wider terminal does not expand
these previews; `full` still prints the complete value.

Looking executes the body only as far as needed. Those values remain buffered
for the first program consumer. Repeated looks use that buffer. Side effects
needed to produce the values happen when they are first requested, including
when that request comes from a preview.

## Stored native sources

In the REPL, assigning `primes`, `fibonacci`, or a reusable bounded view of
these sources creates a fresh stream. A plain alias shares the existing stream.
Ranges remain repeatable values. Merely inspecting any stream leaves its
position unchanged:

```rank
use sequences
G = primes
G until 100
G until 100 sum
G
```

The sum is `1060`; the final preview begins `101 103 107`. `until` peeks at
the first excluded value and leaves it buffered for the next consumer.
`G to 101 sum` would consume `101`, whereas `G until 101 sum` would return zero
and leave it in place. Bounds on a stored view can narrow its limit but cannot
widen it. Filtering a stream and then bounding it uses the same cursor.

`H = G` shares consumption. `H = primes` creates a separate stream beginning
with `2`. Native streams support successive partial consumers; asking again
after a finite stream is exhausted raises `.ConsumedSequence`. Native planner
shortcuts never bypass the cursor: indexing, filtering and reductions must
account for the values they read.

Each consuming line records the resulting cursor position. Rewinding a later
consumer restores the position left by the preceding consumer. Rewinding the
first consumer restores the stream's beginning. Cached output from a nested
generator also checks the source position it originally read; if another
consumer has since advanced that source, it reports `.ConsumedSequence` and
asks to return to the consuming line rather than moving the source backwards.

This is REPL behavior. Executing a Rank file normally retains repeatable native
sequences and the existing single-pass user-generator rules.

## Returning to a line

Returning to `A = G array` clears consumption recorded on that line and below.
The next execution reads the tape from its beginning before resuming the body.
Returning only to `A sum` keeps the consumption above it. For a multiline
statement, the consumption belongs to its first line; entering any line of the
statement resets it as a unit.

Two names for one generator share one tape and its consumption history. A filter
or map reads the underlying source tape. A generator that consumes another
records those reads with its yielded values: replaying cached output restores
the dependency's consumption and read position without executing either body again. Errors and
normal completion are recorded too.

Re-executing a generator creation makes a fresh generator and tape. It can
repeat effects when its new body runs. The hook also covers counted stdin
sequences and generator functions imported from another Rank file.

## Partial reads and resources

In the REPL, stopping a consumer early leaves the underlying generator
suspended. After a rewind, a consumer can ask for more values than the original
run requested. Buffered values come first, then the existing body continues.
This deliberately extends the lifetime of files held by the generator until
completion or session exit. Explicitly closing a file still closes it; replay
cannot reopen it or restore an external resource.

Session exit closes suspended iterators, runs their `finally` blocks, closes
interpreter resources, and releases the tapes. Outside the REPL, abandoning a
generator still closes it immediately and a second consumption still fails.

## Scope and cost

This is a convenience for editing the current session, not a program-state
snapshot. Variable assignments, mutations of yielded objects, and external
writes are not undone. Cached values are retained values, not deep copies.
Only values already produced can be replayed without executing more code.

Tapes grow with the values generated during the session and are retained until
exit. There is no implicit materialization of an entire generator and no cache
in ordinary file execution. User generators still permit one consumer per forward run. Stored native
streams can consume successive prefixes. Returning to a consuming statement
permits its reads again in either case.

The CLI tests cover previews, line boundaries, shared names, partial and endless
generators, filters, nested generators, errors, imported functions, stdin,
resource disposal, and the actual terminal's up-arrow replay.
