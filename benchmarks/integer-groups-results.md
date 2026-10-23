# Bounded integer groups: issue #383

Measured on 2026-10-23, Apple M5, Node v24.15.0. Baseline: `114eaf44`.
All figures below are medians of three sequential fresh-process samples.
Each worker has a 60-second deadline and a 2 GiB V8 heap limit. No tests or
builds ran alongside these final samples.

## General storage

The native storage benchmark inserts two million integers into one million
two-value groups, under 10,000,001 possible keys. The baseline uses Rank's
existing tuple-keyed index and counter; the candidate uses integer groups.
It then visits every inserted value and checks its position and exact value.

| Measurement | Index + counter | Integer groups |
| --- | ---: | ---: |
| Insert | 3138 ms | 185 ms |
| Read and validate | 1773 ms | 1888 ms |
| Retained JS heap after insertion | 386.45 MiB | 20.73 MiB |
| Retained typed buffers after insertion | 0.03 MiB | 99.57 MiB |

The process starts with about 20.5 MiB of JS heap. These memory columns include
that baseline and are measured after forced GC, outside the timed regions.
The groups buffers themselves occupy 104,379,400 bytes (99.54 MiB).
Empty keys have only numeric head/tail slots; there are no per-key containers.
Values and links grow in chunks of 65,536 entries.

Insertion is 16.9 times faster. Reading this synthetic workload is 6.5% slower;
the change does not establish a general iteration speedup. Read-phase peak RSS
varied from 506 to 683 MiB for groups and 665 to 666 MiB for the baseline.

## Euler 373 storage adaptation

Only the grouping representation and its accesses change. Primitive triangle
generation, SPF construction, divisor enumeration and triangle scanning keep
their algorithms. This benchmark stops immediately before SPF construction.
Timings include parsing/preparation but exclude Node startup and validation.

| Measurement, limit 10,000,000 | Baseline | Candidate |
| --- | ---: | ---: |
| Group preparation | 15.958 s | 7.828 s |
| Peak RSS during preparation | 863.70 MiB | 280.25 MiB |
| Retained JS heap | 528.36 MiB | 30.91 MiB |
| Retained typed buffers | 0.03 MiB | 113.07 MiB |

Preparation is 2.04 times faster. Every run produces 3,183,158 values in
814,182 populated groups. Validation visits all possible keys and computes
the same checksum, weighted by key and insertion position:
`222950758134209711526`. Validation follows the recorded memory sample, so its
allocations are excluded from the preparation RSS figure.

## Correctness and build

- 117 targeted interpreter tests and 146 targeted language tests pass. They
  cover groups, chunk boundaries, arbitrary-size integers, snapshots, shared
  references, capture protection, interruption, materialization and application
  forms. Both compilation settings are exercised.
- Euler 373 returns `4950` at limit 100 and `1653605` at limit 1200. Candidate
  and baseline agree; limit 1200 was also checked with compilation disabled.
  The CLI invocation of `373_circles_test.ra` exits successfully.
- `npm run build` passes, including web/mobile builds and Capacitor sync.
  The first attempt lacked the worktree's link to the already installed mobile
  Android dependency; the repeated complete build passes after connecting it.
- The full triangle scan at limit 10,000,000 and the full `npm test` suite were
  not run.

## Reproduce

Build this checkout and a separate checkout of `114eaf44` before comparing.
Set the baseline path to that checkout's compiled interpreter entrypoint:

```sh
npm run build
GROUPS_BASELINE=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/integer-groups.mjs --phase=storage --baseline="$GROUPS_BASELINE"
node benchmarks/integer-groups.mjs --phase=euler --baseline="$GROUPS_BASELINE"
node benchmarks/integer-groups.mjs --phase=checkpoint --limit=100 --trials=1 --baseline="$GROUPS_BASELINE"
node benchmarks/integer-groups.mjs --phase=checkpoint --limit=1200 --trials=1 --baseline="$GROUPS_BASELINE"
node benchmarks/integer-groups.mjs --phase=checkpoint --limit=1200 --compiled=false --trials=1 --baseline="$GROUPS_BASELINE"
```

Raw samples: `benchmarks/baselines/2026-10-23-integer-groups.jsonl`.
