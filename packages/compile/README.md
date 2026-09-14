# @arrrank/compile

**LLM-aided Rust rewrite.** Compile a `.ra` file into a self-contained task for
a coding agent. The compiler runs locally without an LLM, API key or agent.
The receiving agent does not need prior knowledge of Rank.

The package prepares a task with source, parsed syntax, name/type/loop facts,
numeric rules and existing tests. Your agent writes the Rust; `rank-compile`
builds it and compares outputs with the Rank interpreter on your chosen inputs.
Initial validated coverage is Project Euler 1–10 in exact and checked-i64 modes.

## Use without a global install

Requires Node.js 22.12+. Rust/Cargo is needed to build and verify generated code.
The exporter and verifier do not require the Rank REPL or its native dependencies.

```sh
npx @arrrank/compile program.ra > program.rust.md
```

Give `program.rust.md` to your coding agent. The file explains the Rank syntax
and operations used in the initial supported examples, contains the program and
parsed structure, and specifies the standalone Rust project to create.

For checked machine integers:

```sh
npx @arrrank/compile program.ra --integers i64 > program.rust.md
```

For a prepared project with verification inputs:

```sh
npx @arrrank/compile prepare program.ra --out rust/program
```

Ask the agent to implement `rust/program/task.md`, then compare the generated
executable with Rank:

```sh
npx @arrrank/compile verify rust/program
```

`task program.ra` is an explicit alias for the default export command. Stdout
can be redirected to a file or piped to an agent that accepts input there.

Agent selection and login stay with your coding agent. This package does not
invoke Codex or Claude, choose a model, or charge an API account.

## Verification inputs

By default `prepare` creates one case with no command-line arguments. Supply
more cases to check other inputs. Existing `_test.ra` files are included as
generation context; the verifier does not automatically execute those tests.

```json
[
  {"name": "default input", "args": []},
  {"name": "small input", "args": ["--limit", "10"]},
  {"name": "invalid input", "args": ["--limit", "bad"], "error": true}
]
```

```sh
npx @arrrank/compile prepare program.ra --out rust/program --cases cases.json
```

The output directory must be new. After generation, `verify` builds the Cargo
project and compares stdout byte-for-byte. Error cases require both programs to
fail and retain any preceding stdout; diagnostic text need not be identical.
The report `verification.json` records each comparison and source/code hashes.
A failed comparison exits nonzero. Reference and generated processes each have
a 30-second timeout; use `verify DIR --timeout 60000` to change it.

## Integers

`exact` is the default and uses arbitrary-precision integers like Rank. Opt into
machine integers when their range is sufficient:

```sh
npx @arrrank/compile prepare program.ra --out rust/program-i64 --integers i64
```

The task requires checked i64 arithmetic and rejects out-of-range inputs.
For a deliberate numeric-domain difference, a case may use `"overflow": true`:
Rank must succeed and Rust must fail with an overflow/out-of-range diagnostic.
This expectation is only allowed in i64 mode. Never use it to hide a mismatch.
Floating-point substitution is not supported.

## Scope

Version 0.0.1 exports self-contained programs using core, numbers, sequences,
text, io and cli modules. It rejects source imports and unresolved names.
Only Euler 1–10 have been validated end-to-end; accepting a parsed program does
not prove that an agent can preserve every language feature. The syntax and
binding facts are not a lowered IR or a proof of loop purity. Unsupported effects
must be handled or reported by the agent. Finite tests do not establish universal
equivalence, and timings vary by program and integer policy.

See the [generated Euler projects and tasks](https://github.com/kmmbvnr/rank/tree/main/rust/euler)
and the [language wiki](https://github.com/kmmbvnr/rank/blob/main/docs/design/llm-rust-rewrite.md).
