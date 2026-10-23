# Stored integer min, max and choose (#417)

Measured on 2026-10-23: Apple M5, Node v24.15.0, macOS Low Power Mode on.
Final baseline and candidate checkouts were pinned to `2a272ecb`; the candidate
included this patch. The patch was subsequently rebased onto `79873b3f`, which
changes diagnostics for real array indices. No demo algorithm was changed.

## Final comparison

Three fresh compiled CLI processes per case and version; baseline/candidate
order and case order alternate. Each process runs 20 passes over 1,600,000
integer cells. The mask is prebuilt with `(X equal Z) copy`.

Per-pass time is `(median(total) - median(setup-only)) / 20`, including `copy`
and `sum`. Setup-only constructs the same three inputs and adds zero in the
20-iteration loop. Every completed process checks the exact output checksum.

| Expression | Before, ms/pass | After, ms/pass | Speedup |
|---|---:|---:|---:|
| `X + Z` | 18.7 | 18.7 | 1.00x |
| `X min Z` | 372.5 | 38.1 | 9.78x |
| `X max Z` | 376.8 | 38.0 | 9.90x |
| `M choose X Z` | 477.4 | 28.4 | 16.79x |

`min` and `max` take about 2.03x and
2.03x the time of addition; `choose` takes
1.52x.

The historical array implementation of Euler 414, `--first 300 --last 300`,
takes **9.463 s → 4.496 s**
(2.10x). All six processes return
`334961735971658529`. The current scalar/memoised Euler 414 demo is unchanged.

## Individual mechanisms

The initial stages were measured at `c7f9c86d`, before the concurrent #410
syntax change. They use the same array sizes, passes, mask and checksums:

| Stage | min, ms/pass | max, ms/pass |
|---|---:|---:|
| Original runtime | 372.1 | 371.0 |
| Stored-integer extrema only | 226.0 | 338.8 |
| Plus direct numeric-buffer copy | 37.9 | 37.7 |

The extrema-only stage still boxes and validates every result again in
`copy`; its raw samples are noisy. The numeric-buffer copy removes that
remaining intermediate array. Correctness tests for extrema and copying were
run before enabling the integer `choose` dispatch.

At `2a272ecb`, disabling only the `chooseStoredIntegers` dispatch in
`chooseDenseArrays` while retaining typed copy gives **311.6 ms/pass** over
three samples. Restoring that dispatch gives **28.4 ms/pass**
in the final comparison. The control temporarily bypassed the dispatch in the
compiled wrapper and restored the exact original bytes in `finally`; all
control checksums passed.

The final runtime writes extrema/selection results directly into `IntegerCells`
and reads stored masks through `BooleanCells`, keeping general fallback paths
for mixed types, unread values and non-boolean conditions. Numeric `copy`
clones completed typed buffers while preserving shape and declarations.

## Validation

- `npm run build`: passed, including web/mobile asset builds and Capacitor sync.
- Focused interpreter run: **288 passed, 4 failed** across 292 tests. The four
  failures were reproduced separately on the unmodified baseline: three stack
  overflows in `extreme-direct.test.ts` (effectful operands and the two deep
  recursive custom extrema calls), and the shared-parameter assertion in
  `array-storage.test.ts`. They were not changed by this patch.
- All **17 new tests passed**, covering compilation on/off, broadcasting,
  exact wide integers, mixed types, non-boolean masks, bitmap tails, lazy host
  reads, replaced native implementations and independent numeric copies.
- After rebasing onto `79873b3f`, all **75 integration tests passed** in
  `stored-integer-selection.test.ts`, `choose.test.ts` and
  `mask-selection.test.ts`.
- Euler 401–450: **49/50 test files completed successfully**, with **128 test
  cases passed** in total, including two cases from Euler 437. Its third case,
  primes below one million, exceeded the 30-second per-file limit; a longer
  isolated retry was stopped without completing. The baseline also exceeded
  the 30-second limit. This case is **not recorded as passed**.
- No full `npm test`, full default Euler run or full-corpus audit was run.

## Reproduction

Build a baseline checkout at `2a272ecb` separately, then build the candidate.
Recreate the fixed historical array workload (only `max` syntax is adapted
for #410):

```sh
git show '877bea80^:demos/euler/414_kaprekar.ra' |
  sed -E 's/(X[0-4]) (X[0-4]) max/\1 max \2/g' > /tmp/euler414-array.ra
node benchmarks/stored-integer-selection.mjs \
  --baseline=/path/to/baseline/packages/cli/bin/cli.js \
  --euler-source=/tmp/euler414-array.ra
```

Workload SHA-256: `5281b3286060cf4c2dc2eb216244c369ca149e46d9c751c265f96c8fda06505d`.
The benchmark rejects unexpected checksums and checkout revision changes.
Raw stage samples and the completed pinned comparison are in
[`baselines/2026-10-23-stored-integer-selection.jsonl`](baselines/2026-10-23-stored-integer-selection.jsonl).
The exploratory comparisons interrupted by concurrent main updates are excluded.
