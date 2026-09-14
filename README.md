# Rank

[![CI](https://github.com/kmmbvnr/rank/actions/workflows/ci.yml/badge.svg)](https://github.com/kmmbvnr/rank/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@rank/cli)](https://www.npmjs.com/package/@rank/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)

Rank is a modern BASIC for small screens and big algorithms. This repository
contains its evolving grammar, interpreter, command-line REPL, language tests,
and design documents.

## Run

Requires Node.js 20.19 or newer, Python, and a C++20 build toolchain
(for the CLI SQLite cancellation addon).

```console
npm install
npm run build
npm run rank
```

In the interactive CLI, press Ctrl-C to cancel a running computation or SQLite
query and return to editing. SQLite aborts the active statement; interrupting a
write inside an explicit transaction rolls back that transaction. Previously
committed writes remain committed. Cancellation may wait for native I/O, a lock
wait, or an SQL function to return. File and pipe execution do not enable the
cancellation addon.

Example session:

```text
rank> 2 + 3 * 4
14
rank> Answer = 6 * 7
42
rank> Answer
42
rank> 1 to 5
1 2 3 4 5
rank> 1 to 5 sum
15
```

Run a file with `npm run rank -- program.ra`. Program inputs follow the file
name:

```console
npm run rank -- demos/euler/001_multiples.ra
npm run rank -- demos/euler/001_multiples.ra --limit 10
```

Run Rank test files directly or discover every `_test.ra` file below a
directory:

```console
npm run rank -- test demos/euler/001_multiples_test.ra
npm run rank -- test demos/euler
```

Run all grammar and interpreter tests with `npm test`.

## Architecture

- `packages/language` contains the static Langium grammar and generated AST.
- `packages/interpreter` resolves imported vocabulary and evaluates the AST.
- `packages/cli` provides file execution and the REPL.
- `docs` is the current language specification.
- `demos` contains target programs that guide future language coverage.

Parsing never depends on which modules were imported. Imports affect name
resolution and evaluation, so incomplete programs still have a stable syntax
tree and useful diagnostics.
