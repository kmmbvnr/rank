# LLM-aided Rust rewrite

“Rewrite it in Rust” gets a task file and a reference interpreter.

Write and explore an algorithm in compact Rank, then ask a coding agent to
produce a standalone Rust executable. Rank remains the executable reference:
the generated program is checked against it on the same inputs. This can reduce
startup and runtime overhead while keeping the original algorithm easy to read.
The name nods to [Bun's Rust rewrite](https://bun.sh/blog/bun-in-rust), where the
existing test suite helped check the port.

## The workflow

```sh
npx @arrrank/compile demos/euler/002_evenfib.ra > fibonacci.rust.md
```

The compiler itself runs without an LLM. Give the generated file to your coding
agent: it explains Rank and supplies the program, so prior language knowledge or
access to the Rank repository is not required for these supported examples.
The agent creates the Rust project.

For a project with verification inputs, prepare its directory first:

```sh
npx @arrrank/compile prepare demos/euler/002_evenfib.ra --out rust/fibonacci
```

Ask your coding agent to implement `rust/fibonacci/task.md`, then:

```sh
npx @arrrank/compile verify rust/fibonacci
```

`task.md` contains the Rank source, existing tests, parsed syntax, resolved
names/types, loop-carried bindings and a semantic contract. The generated Cargo
project starts with a compile-time placeholder; the agent supplies the Rust.
The package can also write just the task to stdout for an agent's stdin or a
chat attachment. It does not select a provider or run an agent automatically.

The agent may fuse pure sequences, masks, outer products and reductions into
loops. Named intermediates should not require temporary arrays. It must preserve
boundaries, evaluation order, integer semantics and observable effects. The
current exporter provides syntax and binding facts, not a lowered IR or a proof
that an arbitrary loop is safe to optimize.

## Exact or machine integers

The default `--integers exact` preserves arbitrary-precision integers using
`num-bigint`. Choose `--integers i64` for checked machine arithmetic when the
smaller numeric range is sufficient. Overflow becomes an explicit failure;
there is no silent wrapping or conversion to floating point.

That tradeoff can matter more than the target language alone. Benchmark the
actual program and distinguish compute time from startup. A Rust rewrite with
exact integers does not promise a speedup on every workload.

## Current coverage

The [first ten Project Euler programs](../../rust/euler/README.md) have saved tasks,
generated Rust, Cargo lockfiles and verification reports in both numeric modes.
All **237 checks** passed, including the original default/workspace examples,
additional boundaries, invalid inputs and explicit i64 overflow cases.

`verify` builds each project, runs Rank and Rust in separate processes, compares
stdout byte-for-byte and records failures as counterexamples. Custom verification
inputs are supplied with `prepare --cases cases.json`; the default is only one
no-argument case. Existing `_test.ra` files are generation context, not an
automatically translated test suite. Code and input hashes identify the checked
artifacts. CI repeats the Euler suite.

Version 0.0.1 is an agent-assisted rewrite workflow. Initial validated coverage
is Euler 1–10, not the whole language. Imports of other Rank files are rejected.
Other parsed programs need their own semantic review and tests. These fixtures
were authored by the current coding agent with repository access; a separate
blind agent run has not been performed. Finite checks do not prove equivalence.

See [compiler commands and case format](../../packages/compile/README.md).
