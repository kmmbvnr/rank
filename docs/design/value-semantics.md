# Value semantics for arrays

Rank arrays used to be shared storage. `B = A` gave two names one array, passing
an array to a function let the function change its caller's data, and a
generator that reused one buffer handed the same storage to every consumer.
That last case broke an invariant rather than merely surprising a reader: three
distinct positions added to a `set` became three equal elements, and the set
could no longer match any of them by its stored key.

Arrays are now values. A name holds its own value; a write through one name is
never visible through another. The rule and its exceptions are specified in
[values and sharing](../language/values-addressing.md#values-and-sharing).

## Why not the alternatives

**Keep sharing and warn.** Detecting that a function writes its argument and
marking it in the editor leaves the defect in the program. It also needs an
interprocedural, conservative analysis, and a conservative marker that fires
often stops being read — the fate of Julia's `!` convention.

**Snapshot only where values are retained.** Copying at `yield` and at
collection inserts fixes the reported symptom cheaply, but it is a patch, not a
rule: nothing explains why `B = A` shares while `S add A` copies.

**Ownership and moves.** Unique ownership without lifetime annotations is a real
design — Hylo's mutable value semantics, Mojo's default. It turns `yield Pos`
and `S add P` into moves, and the source name becomes unusable afterwards. For a
language aimed at people writing BASIC-level code, "that name is gone now" is a
worse error than a copy they never see.

Value semantics with copy-on-write is what the array languages settled on: APL
and its descendants, R, MATLAB, and Swift for its arrays and structs. NumPy is
the exception, and its aliasing is a well-known source of quiet bugs.

## Mechanism

Copying is the rule, not the work. Tracking every reference would need real
counting, so a binding records only the two states a write has to tell apart:

- a fresh expression result is unbound and is written in place;
- storing it in a binding — a name, parameter, record field, container slot —
  marks it *bound*, and a second binding marks it *shared*;
- a write to a shared array takes a private copy first, and the copy starts
  unbound, so a name pays for sharing once rather than on every write.

This is the classic `NAMED` scheme rather than a reference count, so it is
conservative: an array that became shared and is no longer stays flagged until
its next write. That costs at most one extra copy per name.

Naming a lazy result binds its sources, transitively through a chain of
readers. That is what makes a named derived array a snapshot: the write to its
source goes to new storage and the reader keeps the storage it was given.

Writes made from TypeScript through `createArraySnapshot` storage are outside
this rule and stay live, which is what the embedding escape hatch is for. The
revision and cache-invalidation machinery therefore still has work to do: host
writes, and writes to an array observed only by unnamed readers inside the same
expression.

`packages/interpreter/test/value-semantics.test.ts` is the executable
specification. `demos/structures/sharing.ra` is the same set of probes as a
program whose output a rewrite must reproduce.

## Known costs

**Repeated mutate-and-return.** `A = A step`, where `step` writes its parameter
and returns it, copies once per call because binding the parameter marks the
array shared and the frame teardown does not release it. Rank's idiomatic forms
— a pipeline over a result, or an in-place loop writing one name — do not pay
this. Releasing a binding when a call frame is discarded, or proving that a
function only reads its parameter, would remove it; see
[static effect analysis](open-questions.md#static-effect-analysis), whose value
changes from safety to optimization under this design.

**A conservative shared flag.** See above: one extra copy per name after a
sharing event that has since ended.

**What it measures.** Against the same checkout without the rule, the runtime,
array and dense-write benchmarks are unchanged, and `k-means` at 2048 points —
the demo that binds a row and two intermediates on every inner pass — runs
about three percent slower. That residue is the lookup a binding makes, not
copying: the same run copies one array. Ownership therefore rides on the record
storage and readers already carry, and a reader keeps its own sources, because
a table keyed on every array made a bound inner loop a fifth slower.

## Effect on the Rust rewrite

Value semantics is what makes a port to safe Rust straightforward: an array is
owned storage, moved or borrowed, and the borrow checker proves the copies that
can be elided. Under sharing, a faithful port needed `Rc<RefCell<Vec<_>>>`
everywhere, and a generator that reused a buffer was a lending iterator, which
is not in `std`. The semantic contract in `packages/compile/SEMANTICS.md` now
states the guarantee instead of asking the agent to preserve an aliasing graph
it cannot see.
