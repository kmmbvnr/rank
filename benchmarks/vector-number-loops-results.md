# Stored-vector traversal and typed loads (#316)

Measured on Apple M5, Node v24.15.0, 2026-10-19. Three fresh processes per timed
case, serially, without concurrent tests/builds/profilers. Execution includes
parsing and preparation; cold time also includes imports, validation and disposal.
Diagnostic executions are separate from timed samples.

Baseline: main `c7f09b6f`. Candidate runtime: `43839112`. Both execute the same
Euler 154 source; the default demo has not been rewritten. The small case changes
only N to 5000 and Power to 3.

| Case | Baseline execution, s | Candidate execution, s | Baseline cold, s | Candidate cold, s |
| --- | ---: | ---: | ---: | ---: |
| N=5000, Power=3 | 0.757 | 0.282 | 1.030 | 0.548 |
| Default N=200000, Power=12 | Not measured | 18.084 | Not measured | 18.360 |

Default execution samples: 18.084252, 18.063785, 18.089964 s. All return
**479742450**, all meet the <30 s target. Small-case samples return 12497574.
The issue's historical 6.5-minute default timing was not remeasured, so no
fresh before/after default speedup ratio is claimed. A diagnostic traversal-only
intermediate returned the correct default answer in 21.772 s; that is a single
sample, not a controlled comparison with the final three-sample series.

Default diagnostics show one Number region, one compiled region and zero
overflows. The baseline small case shows zero Number regions and one compiled
region. Ordinary scalar writers and opaque iterator-based array access no longer
sit inside this demo's generated Number region. Indexed loads still check bounds;
there is no unchecked-load or Int32 assumption.

The existing safe-Number backend owns the numeric storage for one invocation.
For this default, Is has 64973 cells and F2/F5 have 200001 cells each: **3,719,800
bytes** of extra Float64 payload (about 3.55 MiB), in addition to the ordinary
Rank arrays. This excludes JS object overhead and does not measure peak RSS or
claim lower memory consumption. Buffers are prepared once for the whole nested
region, not once per outer element, and are not retained across invocations.

Reproduce after building:

```sh
node benchmarks/vector-number-loops.mjs --baseline=/absolute/path/to/old/out/index.js
```

The driver defaults to three trials, checks each answer, and requires every
candidate default execution sample to finish below 30 s. Optional `--cases=small`
and `--trials=1` provide a short check. The expensive baseline default is opt-in
with `--baseline-default`. Each diagnostic candidate must actually enter exactly
one Number region without overflow.

[Raw samples](baselines/2026-10-19-vector-number-loops.jsonl) record source hashes,
commit provenance, payload cell counts and execution/cold timings. Existing
smaller Euler 154 tests cover 2121, 6216 and 6762. The default is restored to the
name-facts and type corpus audits. Its full differential comparison remains
excluded: a fresh isolated `compilation: false` default process was terminated
at the 60 s budget without an answer (ETIMEDOUT/SIGTERM). This is a bounded audit,
not a completed runtime measurement. The small test
file already participates in differential coverage. The test and checker retain
the same default-only exclusion.
