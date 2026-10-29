# Rank to JavaScript for online judges

Status: idea, not started. Nothing here is implemented or decided beyond the
goal and the constraints.

## Goal

Submit Rank solutions to online judges that do not know Rank. Many accept
Node.js, so a compiler can turn a Rank program into one JavaScript file that a
judge runs unchanged.

Target judges, to be confirmed one by one:

- Codeforces
- AtCoder
- CSES
- Yandex contests
- [acmp.ru](https://acmp.ru/)

acmp.ru runs Node.js 19.0.0 (reported by the maintainer; its front page news
lists only C++, Python, PyPy and PascalABC.NET, so confirm the limits when
testing a first submission).

## What exists today

- The interpreter walks the AST. Hot regions are turned into JavaScript with
  `new Function` (`integer-loop-*`, `number-loop-runtime`,
  `scalar-function-kernel`, `generator-loop`, `block-compiler`,
  `tensor-cell-compiler`). Anything unsupported falls back to the interpreter.
- `@arrrank/compile` does not generate JavaScript. It prepares a task for a
  coding agent that writes Rust (see [LLM-aided Rust rewrite](llm-rust-rewrite.md)).
  It has no lowered IR.
- `demos/cses` and `demos/atcoder` hold contest programs.
  `npm run bench:judge` runs the judge-scale cases
  ([judge-scale checks](judge-scale-benchmarks.md)).

## Constraints from judges

- **One source file.** No `import`, no npm. Input through
  `fs.readFileSync(0)`, output through one `process.stdout.write`.
- **Source size limit.** Codeforces allows 64 KB. Other judges differ; record
  each limit here when confirmed. The interpreter (about 46,000 lines) cannot
  be shipped inside a submission, so bundling it is not an option.
- **Node version.** Judges run different, sometimes old, versions (acmp.ru:
  19.0.0). Emit ES2020 with BigInt and avoid newer APIs until each judge's
  version is known.
- **Time and memory limits.** Output has to be fast, not only correct.

## Consequences for the design

1. The compiler emits compact JavaScript plus a small runtime that contains only
   the operations the program uses (sort, heap, deque, Fenwick tree, DSU, ...).
   These need standalone JavaScript implementations, separate from the
   interpreter's.
2. No interpreter fallback. A construct the compiler cannot translate is a
   compile-time error naming the construct. It never produces code that
   behaves differently from Rank.
3. Integers are the main technical risk. Rank integers have arbitrary
   precision, and a product modulo 1e9+7 exceeds 2^53. The compiler needs range
   analysis: values proven to fit Int32 or a safe Number use the fast path;
   others use BigInt or a `mulmod` routine. Without it answers are wrong or
   slow.
4. A typed IR shared by all targets. Type and shape facts exist in
   [abstract-interpretation-shape-inference](abstract-interpretation-shape-inference.md)
   and the existing kernel planners and are the starting point.
5. Lazy plans (`X' = ...`) and copy-on-write values ([value semantics](value-semantics.md))
   must keep their meaning. On the judge subset most plans fuse into loops; the
   rest become closures or explicit copies. Otherwise the compiler rejects the
   program.

## Rough estimate

| Stage | Scope | Time |
| --- | --- | --- |
| Core | scalars, integers with range analysis, arrays, loops, functions, input and output, `sum`, `sort`, `min`, `max` | 2-4 weeks |
| `algo` structures | heap, queue, deque, set, counter, DSU, Fenwick, segment tree | 3-5 weeks |
| Long tail | graphs, wavelet, persistent segment, functional graph `upto` | one structure at a time, driven by a task |

These are guesses made before any design work.

## Acceptance

For every compiled program in `demos/cses` and `demos/atcoder`:

- output equals the interpreter's output on the same inputs;
- running time is inside the judge's limit at official constraints;
- file size is inside the target judge's limit.

The interpreter stays the reference, as in the Rust workflow. A differential
test runs both and compares.

## Open questions

- Which judges and Node versions are in scope, and their source size limits?
- What are acmp.ru's source size, time and memory limits?
- Output format: pretty source for reading, or minified to fit size limits?
- Where does the IR live, and does it replace the specialised kernel planners
  or sit beside them?
- Which integer policy applies when range analysis cannot decide: BigInt, a
  checked slow path or a compile error?
