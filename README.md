# Rank

Rank is a modern BASIC for small screens and big algorithms. This repository
contains its evolving grammar, interpreter, command-line REPL, language tests,
and design documents.

## Run

Requires Node.js 20 or newer.

```console
npm install
npm run build
npm run rank
```

Example session:

```text
rank> 2 + 3 * 4
14
rank> Answer = 6 * 7
42
rank> Answer
42
rank> use ranges
rank> 1 to 5
1 2 3 4 5
rank> use numbers
rank> (1 to 5) sum
15
```

Run a file with `npm run rank -- program.ra`. Run all grammar and interpreter
tests with `npm test`.

## Architecture

- `packages/language` contains the static Langium grammar and generated AST.
- `packages/interpreter` resolves imported vocabulary and evaluates the AST.
- `packages/cli` provides file execution and the REPL.
- `docs` is the current language specification.
- `demos` contains target programs that guide future language coverage.

Parsing never depends on which modules were imported. Imports affect name
resolution and evaluation, so incomplete programs still have a stable syntax
tree and useful diagnostics.
