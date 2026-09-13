# Looking at a sequence without spending it

Design, not implemented. The prompt shows every result, the editor re-runs lines
that have already run, and a user generator is single-pass: those three rules
collide, and this page is how they should be made to fit. The rules they come
from are in [REPL input](repl-input.md) and
[Generator functions](../language/control-functions.md#generator-functions).

## The collision

A result at the prompt is shown as one line, which means the REPL iterates the
value it has just computed. A plan does not mind — `1 to 100 multiple by 3` is a
description, and `iterate()` starts it again from nothing. A generator function's
sequence does mind: it carries a running body, it may have read a port or a file
to get this far, and so the language says a second consumption raises
`.ConsumedSequence` and the way to have it twice is to call the function again.

Today the prompt spends one just by showing it:

```console
use numbers
fun weird N
  yield N
  for N not equal 1
    if N even
      N //= 2
    else
      N = 3 * N + 1
    end
    yield N
  end
end
G = 6 weird
G
6 3 10 5 16 8 4 2 1
error: RankError [ConsumedSequence]: generator sequence weird has already been consumed
G array
error: RankError [ConsumedSequence]: generator sequence weird has already been consumed
```

Three separate faults in one transcript. The look ran the body to its end rather
than as far as it prints, because a generator's extent is `unknown` and the
preview scans an unknown extent for a count. The look spent the value, so the
next line cannot have it. And one statement managed to consume it twice, so the
look itself reported the error it caused.

## A peek is not a consumption

**What a preview takes, it keeps.** Anything pulled out of a generator to be
shown is held on the sequence and handed to the first real consumer before the
body is resumed. The generator then yields to the program exactly what it would
have yielded had nobody looked: the buffer holds what has been produced and not
yet delivered, and `.ConsumedSequence` counts deliveries, not looks.

**A preview stops where the line stops.** A value whose extent is `unknown` is
previewed the way an `infinite` one already is: take the head it prints and
nothing more, and say in the note that there is more rather than how much. The
count is what forces the walk to the end, and a count is not worth running a body
for — on an endless generator it never comes back at all, and on a long one it
turns looking at a value into the most expensive thing the prompt does.

That much is worth doing on its own, with no editor involved: it is what makes
`primes`, `stdin .lines` and a generator safe to name at a prompt.

## Editing mode asks for more

Stepping back re-runs from the edited line forward, and a line below may consume
a sequence a line above produced. The sequence is still the value it was, but a
generator has no way back to where it started: its body has moved on, and the
port it read is not going to say the same thing twice.

So the editor keeps a tape: for every generator sequence, the values it has
yielded, in order. A re-run reads the tape before resuming the body. It is the
peek buffer with a longer memory — the buffer keeps what nobody has taken yet,
the tape keeps what someone already took — and it is what makes the walk forward
mean the same thing the file means.

The tape belongs to the editor and not to the language:

- it is installed where the sequence value is created, once, so an ordinary run
  decides nothing per item and carries no tape and no branch in `iterate()`;
- it lives as long as the session's file does, and is dropped with it;
- nothing about the language's rules changes: a program that raises
  `.ConsumedSequence` as a file still raises it at the prompt. The tape answers
  a **replay** — the same statement running again after a step back — and never
  a second consumption inside one run. That needs the run to be marked, so the
  tape can tell the two apart.

## What it costs

Memory, in the editor only, bounded by what the session's generators have
yielded. That is the same trade the screen already makes: every row printed is
kept so the prompt can walk back up to it. A generator that yields a million
values is a million values held, which is the editor's price for being able to
step back into the line that made it.

Nothing in an ordinary run may change, in memory or in speed. The check belongs
at sequence creation, not inside the iteration, and the fusion and judge-scale
benchmarks are where that has to be shown rather than assumed.

## Pitfalls

- **Effects are not replayable.** A peek runs the body as far as it needs, so
  whatever that part of the body did is already done: a `print` inside a
  generator appears when you look at the value, not when the program consumes
  it, and bytes read from a port at peek time are gone from the port. The values
  can be kept; the effects cannot. A preview is invisible in what the program
  *sees*, never in what the world has done.
- **A tape that runs out.** An edit above can make the line below ask for more
  than the tape holds. Then the body resumes, which works only while it is
  suspended — a generator that finished, raised, or had its resources closed
  cannot be resumed, and the replay must say so plainly rather than quietly
  producing a different sequence.
- **Resources outlive their scope.** A suspended generator owns its open files;
  the spec closes them when its consumer abandons it. A tape that holds the
  generator alive for a replay must not hold the files open with it, and
  `dispose` must still close everything.
- **Wrappers.** A mask or a map over a generator wraps the source plan. The tape
  belongs to the generator itself: one at each wrapper records the same values
  twice, and a wrapper that pulls from the source directly walks past it.
- **Two names, one generator.** The tape is the generator's, not the name's, so
  two names for the same sequence share it. Re-running the line that *creates*
  the generator makes a new one, and the old tape goes with the old value —
  along with any chance of the effects being the same.
- **The modes must not diverge.** If the editor can run a program the file
  cannot, the prompt stops being worth anything: a session that works on screen
  and fails as a `.ra` file is the one outcome the whole design is against. When
  a replay cannot be honest, it has to fail.
- **`memo` and `yield` stay apart.** A memoized function must not contain
  `yield`, and a tape is not a reason to relax that: memoizing a single-pass
  body would hand the same values to callers whose effects differ.

## Open questions

- Should a peek buffer be part of the language, so any host shows a generator
  the same way, or the REPL's own private arrangement?
- Should the editor record the whole tape eagerly, or only for generators a
  later line actually consumed, which is not known until it does?
- Is there a cheap way to tell a replay from a second consumption other than
  numbering the runs?
- Should `list` mark the lines whose values can no longer be replayed, so what
  the screen says is the file stays true?
