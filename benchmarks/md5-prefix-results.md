# MD5 prefix search

Measured locally on 2026-09-22 with Node v24.15.0. Reproduce after building:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/md5-prefix.mjs --full
```

Each short case runs in a fresh process, with 10,000 warm-up iterations and
three measured samples of 100,000 candidates. The input is `abc` followed by
an index from 3,200,000 through 3,299,999. All cases find the same single match;
an independent `node:crypto.createHash` loop checks the count. Cases run
serially, with no test suite running alongside them.

| MD5 backend | Prefix/control flow | Samples (ms) | Median (ms) |
| --- | --- | --- | --- |
| Portable | Hex text, early `continue` | 701.82, 670.68, 652.58 | 670.68 |
| Portable | Bytes, early `continue` | 668.04, 583.81, 709.74 | 668.04 |
| Portable | Indexed bytes, early `continue` | 633.35, 588.13, 585.61 | 588.13 |
| Portable | Bytes, positive `if` | 285.93, 278.86, 278.75 | 278.86 |
| Node | Hex text, early `continue` | 592.87, 569.89, 550.48 | 569.89 |
| Node | Bytes, early `continue` | 574.09, 483.09, 610.66 | 574.09 |
| Node | Indexed bytes, early `continue` | 540.50, 495.12, 493.40 | 495.12 |
| Node | Bytes, positive `if` | 191.85, 181.15, 181.82 | 181.82 |

The last case is about 3.69 times faster than the first on this workload.
Byte comparison alone does not explain that gain. In the interpreter's
fallback loop path, `continue` throws an internal control-flow signal. A
positive `if` avoids throwing on almost every rejected hash. Native Node MD5
also avoids the portable hash implementation and a separate UTF-8 input buffer.

The demo checks completion only when it adds a password character, and gets
the needed hex digits from individual bytes. It never formats a full digest.
The two parts remain independent functions, so their searches start separately.

The `--full` run calls the actual imported demo functions with the native
backend and checks both official example passwords:

| Part | Password | MD5 calls | Time (s) |
| --- | --- | --- | --- |
| 1 | `18f47a30` | 8,605,829 | 15.12 |
| 2 | `05ace8e3` | 13,753,422 | 26.18 |

Full-solve times are single runs, not medians. The short-loop ratio is not a
claim about every input or the complete original solution. The search still
needs millions of hashes; further large gains would require reducing Rank
dispatch overhead, sharing the search between parts, or processing ordered
candidate blocks in parallel.
