# Compiler catalogue refactor: verification

Measured on 2026-10-03 for #103. Baseline: `c2be797f`. Candidate:
`a5f4eee5`, containing all staged catalogue migrations and rejection diagnostics,
including the additional scalar-expression consumer. The candidate
also includes the concurrent terminal value-viewer changes from main; the CLI
measurements therefore cover the combined checkout. No new compiler operation
or argument domain is enabled by this refactor.

## Behavior and compilation coverage

The audit compared the pre-refactor build, the candidate with compilation
active, and the candidate with compilation disabled. It compared results per
file, including test output and formatted errors. All comparisons passed.

| Group | Coverage | Baseline compiledLoops | Candidate compiledLoops | Baseline compiledTensors | Candidate compiledTensors |
| --- | --- | ---: | ---: | ---: | ---: |
| Demo test files | 392 files, 1,356 passing tests | 4,240,684 | 4,240,684 | 405,171 | 405,171 |
| Programs without matching test files | 74 programs, 54 CSV exports, 9 database updates | 1 | 1 | 0 | 0 |
| AoC 2016 chess-password program | Unchanged source with a deterministic host digest fixture | 2 | 2 | 0 | 0 |

These counters count executions of compiled regions. Equality was checked per
file, not just for the totals. The reference audit generated no kernels and
executed no compiled loops or tensors. CSV file hashes and each updated database
hash matched across the three modes. Every update exercise used a fresh database
copy; the source database was preserved.

Module-load tracking plus the standalone runs accounted for all 858 `.ra` files.
The chess-password test file only tests hash facts, so a separate fixture ran the
actual program. Its pure host digest exercises rejected prefixes, duplicate
positions and termination, producing `80071625` and `89abcdef`. This does not
validate a full real-MD5 password search. Existing tests retain their real MD5
checks, including the official first matching hash.

Hashes from the available loop, tensor, scalar-expression, block and function-body
compiler hooks matched after normalizing only diagnostic guard returns
(`return decline(...)` to `return undefined`). Raw hashes differed in 18 demo
test files because of those tensor diagnostic returns. Successful operations and
guard conditions were unchanged. Scalar-function kernels also have per-overload
execution tests, including negative floor division and remainder.

A separate comparison parsed all 858 sources and checked the original and new
scalar proof on 618 function declarations. Both accepted 6 functions in simple
mode and 14 in block mode, with identical result types and locals. No files
failed to parse.

## Timing

Node v24.15.0, Apple M5. Each sample starts a new CLI process and runs the unchanged
demo source. The harness checks output against an independent expected result,
warms both checkouts, and alternates their order. Diagnostics are disabled for
timing; their additional counters have their own overhead. Other local test and
audit jobs had finished before measurement.

| Program | Samples per checkout | Baseline median | Candidate median | Candidate / baseline |
| --- | ---: | ---: | ---: | ---: |
| Euler 004 | 5 | 4,678 ms | 4,714 ms | 1.008 |
| Euler 014 | 5 | 12,828 ms | 12,853 ms | 1.002 |
| AtCoder Frog 2 | 5 | 479 ms | 483 ms | 1.009 |
| CSES Coin Combinations I | 5 | 564 ms | 566 ms | 1.004 |
| CSES Dice Combinations | 5 | 437 ms | 440 ms | 1.008 |

Final medians were within 1% of the baseline in these cases. This batch does not
show a material slowdown or a speed improvement; it is not a guarantee for
unmeasured workloads. The earlier staged measurements and a palindrome repeat
are retained alongside the final samples in
[compiler-catalogue-results.json](compiler-catalogue-results.json).

The final demo audit was repeated after the scalar-expression migration and all
diagnostic changes. The subsequent rebase onto the web-viewer change on main
(`badd7dd4`) changed no interpreter, language or CLI source. The raw report
includes their Git tree hashes so this equivalence can be checked after rebasing.
The integrated tree
still receives its own full local test and CI gates.

## Reproduction

Use disposable checkouts. Build each with `npm ci` and `npm run build`.
Restore the ignored demo fixtures as described by their demo READMEs. The files
used here had these SHA-256 hashes:

| Fixture | SHA-256 |
| --- | --- |
| `demos/tidytuesday/data/africa.csv` | `3ab24d9b2ac2cd3fe5eaab18ea0976ab8e536f51223acac0bf393a25cbe9c56b` |
| `demos/pgexercises/data/club.sqlite3` | `61eb48de06275e6b591d754066fe2f831c32f9afc4ba0e21f8fb29d6120b61b6` |
| `demos/tpch/data/tpch.sqlite3` | `7d89e1bb1e6b8077ec01109b69d0137698d0e9a62b6d1166da1b269adf2002e0` |

The first baseline run lacked `africa.csv`, so three data-dependent tests failed.
After copying the same fixture into both checkouts, rerunning that test file
passed all six tests; its result replaced the missing-fixture result in the audit.

```sh
node benchmarks/compiler-catalogue-audit.mjs /tmp/baseline compiled /tmp/before.json
node benchmarks/compiler-catalogue-audit.mjs /tmp/candidate compiled /tmp/after.json
node benchmarks/compiler-catalogue-audit.mjs /tmp/candidate reference /tmp/reference.json
node benchmarks/compiler-catalogue-audit.mjs compare /tmp/before.json /tmp/after.json
node benchmarks/compiler-catalogue-audit.mjs compare /tmp/after.json /tmp/reference.json --behavior-only
```

Repeat those commands with `'' unpaired` and `'' chess` appended to each audit
command, using separate output JSON paths. The standalone SQL programs write CSV
exports in their checkout. Update exercises receive a fresh copy of the database.

Once other local test jobs finish, measure timings:

```sh
node benchmarks/compiler-catalogue-bench.mjs /tmp/baseline /tmp/candidate 5
node benchmarks/compiler-catalogue-bench.mjs /tmp/baseline /tmp/candidate 7 'Euler 004' candidate
```

Full local suites and Node 22/24 CI are separate delivery gates for each migration
PR. This report records the cross-stage behavior and performance audit; it does
not replace those gates.
