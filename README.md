# Rank

[![CI](https://github.com/kmmbvnr/rank/actions/workflows/ci.yml/badge.svg)](https://github.com/kmmbvnr/rank/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@rank/cli)](https://www.npmjs.com/package/@rank/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)

Rank is a modern BASIC for small screens and big algorithms.

- Data-first pipelines: values flow through functions from left to right.
- Multidimensional arrays, broadcasting, and operations by rank or axis.
- Lazy sequences, ranges, and generators.
- Functions, closures, and memoization.
- A notebook-style CLI: edit cells, rerun code, and see results alongside it.

```text
rank> Cube = (1 to 27) (array 3 3 3) reshape
rank> Cube transpose (array 2 1 0) diag rank 2 diag sum
42
```

## Run

Requires Node.js 20.19 or newer, Python, and a C++20 build toolchain.

```console
npm install
npm run build
npm run rank
```

```text
rank> use numbers
rank> 2 + 3 * 4
14
rank> 1 to 5 sum
15
```

Run a file, optionally passing inputs:

```console
npm run rank -- demos/euler/001_multiples.ra --limit 10
```

## Tests

```console
npm test
npm run rank -- test demos/euler
```

## Documentation

- [Language specification](docs/CURRENT_SPEC.md) and [standard library](docs/stdlib/reference.md)
- [CLI and editor](packages/cli/README.md)
- [Example programs](demos)
