# Looking at a sequence without spending it

Implemented in the shared REPL runtime. `SequenceReplay` in
`packages/common/src/sequence-replay.ts` keeps yielded values and records the
consuming source line and read position of single-pass generators. The
interpreter exposes a resource creation hook; ordinary file execution does not
install it or allocate replay tapes. Repeatable native sources keep no tape.

## Looking and consuming

```rank
use sequences
use numbers
fun N nums
  yield N
  yield N + 1
end
G' = 3 nums
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
If the end was not reached, the note says `size unknown`, unless the work limit
stopped the read. Finite sequences with a known size use a bounded scan for their
two ends. If that scan reaches its work limit, it keeps the computed head and
shows `preview demand budget exhausted`.
Automatic result previews use at most 40 text columns, reduced further when the
terminal has less space after the source gutter. A wider terminal does not expand
these previews; `full` still prints the complete value.

Looking executes the body only as far as needed. Those values remain buffered
for the first program consumer. Repeated looks use that buffer. Side effects
needed to produce the values happen when they are first requested, including
when that request comes from a preview.

## Repeatable native sources

Native sources such as `primes` and `fibonacci` remain repeatable in both the
REPL and file execution. A deferred binding saves the expression:

```rank
use sequences
G' = primes
G till 100 sum
G till 100 sum
G
```

Both sums are `1060`; the final preview begins `2 3 5 7`. `H' = G` also
starts each demand from the beginning. No cursor or computed results are
retained. Bounds compose by intersection, so bounding an already bounded
source cannot widen it. Filters and nested readers preserve independent reads.

An ordinary binding completes its result. `A = G till 100` stores the finite
values, while `A = primes` rejects a known infinite result. An apostrophe on a
generator binding preserves its single-pass resource; it does not restart the
body. Preview and inspection demand deferred expressions within a work budget.
`full` demands the expression without the preview limit.

The work budget covers cooperative computation, including loops that produce
values and loops still computing the next value. Nested previews and inspection
cells share the enclosing allowance. Raw lazy arrays, sequence scans and
first-cell type labels use the same protection as expression plans. Inspection
stops a costly window with `Inspection work limit reached`; ordinary cell errors
remain visible as cell errors. Another request starts a fresh observation.
Ordinary execution and `full` do not install this preview allowance.

Read-ahead that reaches its limit between values leaves the resource suspended.
A limit raised while computing the next value closes that iterator. Its tape
keeps the yielded prefix; trying to consume beyond it asks the user to rerun the
producing cell. A host limit is never replayed as a new cancellation or a new
budget exhaustion.

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
in ordinary file execution. User generators still permit one consumer per forward
run. Returning to a consuming statement permits its reads again. Repeatable
expressions compute again on each demand, including any effects they perform.

The CLI tests cover previews, line boundaries, shared names, partial and endless
generators, filters, nested generators, errors, imported functions, stdin,
resource disposal, and the actual terminal's up-arrow replay.
