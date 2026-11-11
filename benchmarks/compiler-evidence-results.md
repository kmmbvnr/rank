# Compiler evidence: independent correctness, coverage and performance

Issue #565, workstream 12. See `compiler-progress.md` for metric definitions.

## rank-step12-mac

Revision `b2192600e4c34bc8a7a254b0e20e0a609c710f06`; {'platform': 'darwin', 'arch': 'arm64', 'cpu': 'Apple M5', 'node': 'v24.15.0'}.

Independent mode/case/pair processes, reversed order each pair. Seven samples, discard first two. Timing excludes parsing, construction, disposal and source hooks. Fresh execution includes lazy preparation. RSS includes warmups for this mode. Preparation self time excludes nested observed preparation; it is not all compiler/V8 cost. Entries are overlapping backend calls, never coverage percentages.

All 48 case/process-pair correctness and admission checks passed.

Ratios compare each mode to uninstrumented compiled execution. Below 1 means less time.
Intervals bootstrap process pairs (10,000 draws, seed 565); system load is uncontrolled.
Reference/plain compares interpretation to compilation. Other ratios measure instrumentation overhead.

### fresh

| Case | Mode | ms | Ratio to plain [95%] | Peak RSS KiB |
| --- | --- | ---: | --- | ---: |
| euler001 | reference | 1.590 | 0.988 [0.908, 1.082] | 182,440 |
| euler001 | plain | 1.533 | 1.000 [1.000, 1.000] | 180,808 |
| euler001 | counters | 1.553 | 0.993 [0.934, 1.068] | 181,368 |
| euler001 | profile | 1.612 | 1.040 [0.940, 1.179] | 180,680 |
| euler001 | trace | 4.912 | 3.033 [2.731, 3.231] | 183,136 |
| scalar | reference | 0.928 | 1.422 [1.370, 1.475] | 179,640 |
| scalar | plain | 0.657 | 1.000 [1.000, 1.000] | 177,896 |
| scalar | counters | 0.676 | 1.025 [1.003, 1.050] | 177,152 |
| scalar | profile | 0.714 | 1.084 [1.039, 1.129] | 177,744 |
| scalar | trace | 0.748 | 1.167 [1.121, 1.224] | 178,768 |
| ownership | reference | 2.538 | 1.385 [1.339, 1.430] | 183,744 |
| ownership | plain | 1.884 | 1.000 [1.000, 1.000] | 182,688 |
| ownership | counters | 2.083 | 1.090 [1.022, 1.151] | 182,512 |
| ownership | profile | 1.914 | 1.097 [1.025, 1.202] | 181,992 |
| ownership | trace | 3.948 | 2.359 [2.158, 2.587] | 183,944 |
| deferred | reference | 1.963 | 0.785 [0.711, 0.868] | 184,000 |
| deferred | plain | 2.496 | 1.000 [1.000, 1.000] | 185,680 |
| deferred | counters | 2.633 | 1.012 [0.954, 1.055] | 185,888 |
| deferred | profile | 2.609 | 0.993 [0.943, 1.044] | 186,376 |
| deferred | trace | 7.079 | 2.728 [2.595, 2.868] | 192,104 |
| effects | reference | 2.380 | 0.801 [0.780, 0.820] | 182,104 |
| effects | plain | 2.919 | 1.000 [1.000, 1.000] | 184,512 |
| effects | counters | 3.471 | 1.178 [1.078, 1.279] | 185,600 |
| effects | profile | 3.519 | 1.167 [1.004, 1.297] | 185,056 |
| effects | trace | 16.290 | 5.444 [4.683, 6.125] | 191,520 |
| generator | reference | 0.726 | 0.704 [0.654, 0.747] | 178,904 |
| generator | plain | 0.975 | 1.000 [1.000, 1.000] | 179,816 |
| generator | counters | 1.460 | 1.454 [1.353, 1.513] | 180,360 |
| generator | profile | 1.546 | 1.497 [1.417, 1.581] | 180,432 |
| generator | trace | 5.633 | 5.474 [5.089, 5.831] | 182,040 |
| large | reference | 3.685 | 0.313 [0.303, 0.324] | 186,328 |
| large | plain | 11.733 | 1.000 [1.000, 1.000] | 273,800 |
| large | counters | 12.051 | 1.028 [0.990, 1.061] | 273,072 |
| large | profile | 12.469 | 1.063 [1.022, 1.104] | 273,680 |
| large | trace | 82.811 | 7.509 [6.995, 8.468] | 277,864 |
| error | reference | 0.173 | 0.792 [0.757, 0.831] | 169,904 |
| error | plain | 0.215 | 1.000 [1.000, 1.000] | 170,536 |
| error | counters | 0.238 | 1.087 [1.051, 1.114] | 171,288 |
| error | profile | 0.243 | 1.111 [1.076, 1.146] | 170,744 |
| error | trace | 0.334 | 1.504 [1.372, 1.602] | 172,080 |

### prepared

| Case | Mode | ms | Ratio to plain [95%] | Peak RSS KiB |
| --- | --- | ---: | --- | ---: |
| euler001 | reference | 0.859 | 1.144 [1.124, 1.168] | 182,440 |
| euler001 | plain | 0.750 | 1.000 [1.000, 1.000] | 180,808 |
| euler001 | counters | 0.764 | 1.014 [1.004, 1.024] | 181,368 |
| euler001 | profile | 0.767 | 1.028 [1.009, 1.062] | 180,680 |
| euler001 | trace | 4.089 | 5.303 [5.030, 5.613] | 183,136 |
| scalar | reference | 0.587 | 10.650 [9.524, 11.784] | 179,640 |
| scalar | plain | 0.060 | 1.000 [1.000, 1.000] | 177,896 |
| scalar | counters | 0.055 | 0.990 [0.868, 1.107] | 177,152 |
| scalar | profile | 0.055 | 0.979 [0.877, 1.082] | 177,744 |
| scalar | trace | 0.097 | 1.692 [1.524, 1.881] | 178,768 |
| ownership | reference | 1.608 | 2.367 [2.222, 2.480] | 183,744 |
| ownership | plain | 0.678 | 1.000 [1.000, 1.000] | 182,688 |
| ownership | counters | 0.716 | 1.023 [0.993, 1.056] | 182,512 |
| ownership | profile | 0.675 | 1.062 [0.960, 1.176] | 181,992 |
| ownership | trace | 2.491 | 3.814 [3.434, 4.098] | 183,944 |
| deferred | reference | 1.318 | 0.969 [0.903, 1.030] | 184,000 |
| deferred | plain | 1.277 | 1.000 [1.000, 1.000] | 185,680 |
| deferred | counters | 1.306 | 0.982 [0.911, 1.032] | 185,888 |
| deferred | profile | 1.340 | 0.981 [0.910, 1.045] | 186,376 |
| deferred | trace | 4.924 | 3.775 [3.542, 3.922] | 192,104 |
| effects | reference | 1.214 | 0.920 [0.882, 0.956] | 182,104 |
| effects | plain | 1.290 | 1.000 [1.000, 1.000] | 184,512 |
| effects | counters | 1.612 | 1.238 [1.132, 1.344] | 185,600 |
| effects | profile | 1.663 | 1.273 [1.129, 1.390] | 185,056 |
| effects | trace | 13.413 | 10.208 [8.841, 11.377] | 191,520 |
| generator | reference | 0.376 | 1.107 [1.058, 1.162] | 178,904 |
| generator | plain | 0.335 | 1.000 [1.000, 1.000] | 179,816 |
| generator | counters | 0.609 | 1.834 [1.701, 1.982] | 180,360 |
| generator | profile | 0.616 | 1.803 [1.726, 1.866] | 180,432 |
| generator | trace | 4.366 | 12.960 [12.324, 13.432] | 182,040 |
| large | reference | 3.295 | 0.482 [0.442, 0.517] | 186,328 |
| large | plain | 6.499 | 1.000 [1.000, 1.000] | 273,800 |
| large | counters | 7.523 | 1.120 [1.047, 1.175] | 273,072 |
| large | profile | 7.631 | 1.171 [1.131, 1.219] | 273,680 |
| large | trace | 70.218 | 11.017 [10.513, 11.778] | 277,864 |
| error | reference | 0.062 | 0.968 [0.892, 1.050] | 169,904 |
| error | plain | 0.059 | 1.000 [1.000, 1.000] | 170,536 |
| error | counters | 0.066 | 1.128 [1.063, 1.202] | 171,288 |
| error | profile | 0.068 | 1.158 [1.108, 1.206] | 170,744 |
| error | trace | 0.125 | 2.112 [1.920, 2.267] | 172,080 |

### Preparation and executed entries

Preparation uses an additional fresh process and first execution; entries use the first trace pair.
Entry counts overlap through nested calls and are not percentages or cell counts.

| Case | Observed preparation self ms | Compiled entries | Native entries | Interpreted entries | Omitted detail occurrences |
| --- | ---: | ---: | ---: | ---: | ---: |
| euler001 | 3.328 | 3 | 2003 | 5 | 0 |
| scalar | 13.740 | 1 | 0 | 2 | 0 |
| ownership | 22.815 | 202 | 101 | 2 | 0 |
| deferred | 19.234 | 100 | 101 | 204 | 0 |
| effects | 16.961 | 200 | 301 | 105 | 0 |
| generator | 10.004 | 1 | 2 | 202 | 0 |
| large | 24.821 | 210 | 9061 | 35 | 26367 |
| error | 1.239 | 0 | 1 | 2 | 0 |

### Known work and fallback reasons

Counters keep their original units and may describe overlapping operations.
Fallbacks are candidate/guard events; another compiled or native path can succeed.

| Case | COW copied cells | Typed unpacked cells | Computed cells | Most frequent fallback counters |
| --- | ---: | ---: | ---: | --- |
| euler001 | 0 | 0 | 1998 | `scalar-expression:operator-guard:equal` × 1; `scalar-expression:operator-guard:mod` × 1; `scalar-expression:unsupported-op:till` × 1 |
| scalar | 0 | 0 | 0 | none observed |
| ownership | 300 | 0 | 0 | `tensor:unsupported-type:array` × 1 |
| deferred | 0 | 0 | 0 | `loop:deferred-region-effects:ForStatement` × 1; `scalar-expression:too-small` × 1; `scalar-expression:unsupported-op:to` × 1 |
| effects | 0 | 0 | 0 | `scalar-function:unsupported-node:TryStatement` × 3; `scalar-expression:too-small` × 2; `loop:unsupported-node:AssignmentStatement` × 1 |
| generator | 0 | 200 | 0 | `loop:unsupported-node:TryStatement` × 1; `scalar-expression:too-small` × 1; `scalar-expression:unsupported-op:to` × 1 |
| large | 0 | 0 | 0 | `tensor:output-shape` × 9000; `scalar-function:budget:AssignmentStatement` × 3; `loop:unsupported-node:AssignmentStatement` × 1 |
| error | 0 | 0 | 0 | none observed |

Raw JSON retains backend timing, fallbacks/categories, known allocation/copy/cell work,
all samples and the explicit language-error/effect outcomes. It does not assert that
a completed backend entry performed every operation itself. Detailed tracing is
intentionally bounded; aggregate execution counts remain complete for observed backends.

## rank-step12-intel

Revision `b2192600e4c34bc8a7a254b0e20e0a609c710f06`; {'platform': 'linux', 'arch': 'x64', 'cpu': 'Intel(R) Core(TM) i7-10750H CPU @ 2.60GHz', 'node': 'v24.15.0'}.

Independent mode/case/pair processes, reversed order each pair. Seven samples, discard first two. Timing excludes parsing, construction, disposal and source hooks. Fresh execution includes lazy preparation. RSS includes warmups for this mode. Preparation self time excludes nested observed preparation; it is not all compiler/V8 cost. Entries are overlapping backend calls, never coverage percentages.

All 48 case/process-pair correctness and admission checks passed.

Ratios compare each mode to uninstrumented compiled execution. Below 1 means less time.
Intervals bootstrap process pairs (10,000 draws, seed 565); system load is uncontrolled.
Reference/plain compares interpretation to compilation. Other ratios measure instrumentation overhead.

### fresh

| Case | Mode | ms | Ratio to plain [95%] | Peak RSS KiB |
| --- | --- | ---: | --- | ---: |
| euler001 | reference | 3.104 | 0.861 [0.779, 0.970] | 166,410 |
| euler001 | plain | 3.750 | 1.000 [1.000, 1.000] | 167,604 |
| euler001 | counters | 3.853 | 1.100 [0.984, 1.263] | 168,208 |
| euler001 | profile | 3.918 | 1.040 [0.934, 1.137] | 167,396 |
| euler001 | trace | 8.582 | 2.416 [2.221, 2.623] | 168,870 |
| scalar | reference | 2.058 | 1.466 [1.326, 1.628] | 168,626 |
| scalar | plain | 1.344 | 1.000 [1.000, 1.000] | 159,352 |
| scalar | counters | 1.492 | 1.082 [1.014, 1.181] | 160,774 |
| scalar | profile | 1.447 | 1.068 [1.024, 1.118] | 160,124 |
| scalar | trace | 1.693 | 1.228 [1.101, 1.356] | 161,072 |
| ownership | reference | 7.269 | 1.725 [1.625, 1.873] | 172,726 |
| ownership | plain | 4.410 | 1.000 [1.000, 1.000] | 168,474 |
| ownership | counters | 4.827 | 1.099 [1.047, 1.159] | 168,250 |
| ownership | profile | 4.882 | 1.101 [1.086, 1.116] | 168,480 |
| ownership | trace | 8.887 | 2.055 [1.986, 2.157] | 168,978 |
| deferred | reference | 5.521 | 0.861 [0.796, 0.921] | 170,200 |
| deferred | plain | 6.264 | 1.000 [1.000, 1.000] | 172,206 |
| deferred | counters | 6.609 | 1.085 [0.983, 1.197] | 171,798 |
| deferred | profile | 6.757 | 1.120 [1.014, 1.237] | 172,876 |
| deferred | trace | 16.771 | 2.649 [2.410, 2.894] | 178,742 |
| effects | reference | 6.320 | 0.840 [0.826, 0.855] | 168,490 |
| effects | plain | 7.512 | 1.000 [1.000, 1.000] | 169,432 |
| effects | counters | 8.885 | 1.203 [1.141, 1.269] | 168,758 |
| effects | profile | 9.325 | 1.267 [1.209, 1.335] | 162,286 |
| effects | trace | 34.662 | 4.670 [4.561, 4.765] | 177,518 |
| generator | reference | 1.762 | 0.757 [0.720, 0.789] | 164,836 |
| generator | plain | 2.309 | 1.000 [1.000, 1.000] | 166,240 |
| generator | counters | 3.530 | 1.515 [1.333, 1.661] | 166,326 |
| generator | profile | 3.550 | 1.525 [1.417, 1.606] | 166,224 |
| generator | trace | 11.642 | 5.207 [4.867, 5.572] | 170,244 |
| large | reference | 7.215 | 0.334 [0.316, 0.356] | 172,960 |
| large | plain | 21.668 | 1.000 [1.000, 1.000] | 258,124 |
| large | counters | 23.955 | 1.107 [1.069, 1.143] | 258,334 |
| large | profile | 24.217 | 1.131 [1.098, 1.183] | 257,672 |
| large | trace | 154.853 | 7.187 [7.116, 7.264] | 263,060 |
| error | reference | 0.349 | 0.851 [0.807, 0.892] | 152,434 |
| error | plain | 0.422 | 1.000 [1.000, 1.000] | 152,006 |
| error | counters | 0.486 | 1.167 [1.098, 1.247] | 151,946 |
| error | profile | 0.524 | 1.294 [1.231, 1.354] | 152,742 |
| error | trace | 0.728 | 1.760 [1.635, 1.911] | 146,384 |

### prepared

| Case | Mode | ms | Ratio to plain [95%] | Peak RSS KiB |
| --- | --- | ---: | --- | ---: |
| euler001 | reference | 1.856 | 1.258 [1.079, 1.510] | 166,410 |
| euler001 | plain | 1.556 | 1.000 [1.000, 1.000] | 167,604 |
| euler001 | counters | 1.550 | 1.061 [0.997, 1.148] | 168,208 |
| euler001 | profile | 1.542 | 1.040 [0.931, 1.174] | 167,396 |
| euler001 | trace | 6.317 | 4.145 [3.845, 4.416] | 168,870 |
| scalar | reference | 1.215 | 12.245 [11.009, 13.725] | 168,626 |
| scalar | plain | 0.096 | 1.000 [1.000, 1.000] | 159,352 |
| scalar | counters | 0.104 | 1.037 [0.920, 1.182] | 160,774 |
| scalar | profile | 0.108 | 1.100 [0.917, 1.280] | 160,124 |
| scalar | trace | 0.187 | 1.857 [1.693, 2.044] | 161,072 |
| ownership | reference | 4.301 | 2.745 [2.657, 2.818] | 172,726 |
| ownership | plain | 1.587 | 1.000 [1.000, 1.000] | 168,474 |
| ownership | counters | 1.730 | 1.117 [0.998, 1.278] | 168,250 |
| ownership | profile | 1.645 | 1.091 [1.015, 1.209] | 168,480 |
| ownership | trace | 5.043 | 3.203 [3.112, 3.274] | 168,978 |
| deferred | reference | 3.532 | 1.052 [0.927, 1.212] | 170,200 |
| deferred | plain | 3.639 | 1.000 [1.000, 1.000] | 172,206 |
| deferred | counters | 3.590 | 0.995 [0.957, 1.040] | 171,798 |
| deferred | profile | 3.790 | 1.056 [0.997, 1.125] | 172,876 |
| deferred | trace | 10.992 | 3.020 [2.954, 3.094] | 178,742 |
| effects | reference | 3.258 | 0.918 [0.853, 0.972] | 168,490 |
| effects | plain | 3.501 | 1.000 [1.000, 1.000] | 169,432 |
| effects | counters | 4.150 | 1.164 [1.069, 1.236] | 168,758 |
| effects | profile | 4.371 | 1.222 [1.131, 1.278] | 162,286 |
| effects | trace | 26.702 | 7.476 [7.029, 7.862] | 177,518 |
| generator | reference | 0.819 | 1.074 [0.987, 1.169] | 164,836 |
| generator | plain | 0.762 | 1.000 [1.000, 1.000] | 166,240 |
| generator | counters | 1.280 | 1.738 [1.563, 2.008] | 166,326 |
| generator | profile | 1.375 | 1.799 [1.747, 1.852] | 166,224 |
| generator | trace | 8.382 | 11.069 [10.476, 11.634] | 170,244 |
| large | reference | 6.116 | 0.497 [0.475, 0.519] | 172,960 |
| large | plain | 12.308 | 1.000 [1.000, 1.000] | 258,124 |
| large | counters | 13.632 | 1.128 [1.095, 1.169] | 258,334 |
| large | profile | 13.761 | 1.135 [1.101, 1.175] | 257,672 |
| large | trace | 132.057 | 10.786 [10.647, 10.927] | 263,060 |
| error | reference | 0.126 | 1.070 [0.956, 1.198] | 152,434 |
| error | plain | 0.118 | 1.000 [1.000, 1.000] | 152,006 |
| error | counters | 0.137 | 1.182 [1.101, 1.289] | 151,946 |
| error | profile | 0.152 | 1.294 [1.194, 1.401] | 152,742 |
| error | trace | 0.270 | 2.278 [2.036, 2.539] | 146,384 |

### Preparation and executed entries

Preparation uses an additional fresh process and first execution; entries use the first trace pair.
Entry counts overlap through nested calls and are not percentages or cell counts.

| Case | Observed preparation self ms | Compiled entries | Native entries | Interpreted entries | Omitted detail occurrences |
| --- | ---: | ---: | ---: | ---: | ---: |
| euler001 | 3.462 | 3 | 2003 | 5 | 0 |
| scalar | 13.071 | 1 | 0 | 2 | 0 |
| ownership | 23.028 | 202 | 101 | 2 | 0 |
| deferred | 18.423 | 100 | 101 | 204 | 0 |
| effects | 16.467 | 200 | 301 | 105 | 0 |
| generator | 9.948 | 1 | 2 | 202 | 0 |
| large | 29.012 | 210 | 9061 | 35 | 26367 |
| error | 1.108 | 0 | 1 | 2 | 0 |

### Known work and fallback reasons

Counters keep their original units and may describe overlapping operations.
Fallbacks are candidate/guard events; another compiled or native path can succeed.

| Case | COW copied cells | Typed unpacked cells | Computed cells | Most frequent fallback counters |
| --- | ---: | ---: | ---: | --- |
| euler001 | 0 | 0 | 1998 | `scalar-expression:operator-guard:equal` × 1; `scalar-expression:operator-guard:mod` × 1; `scalar-expression:unsupported-op:till` × 1 |
| scalar | 0 | 0 | 0 | none observed |
| ownership | 300 | 0 | 0 | `tensor:unsupported-type:array` × 1 |
| deferred | 0 | 0 | 0 | `loop:deferred-region-effects:ForStatement` × 1; `scalar-expression:too-small` × 1; `scalar-expression:unsupported-op:to` × 1 |
| effects | 0 | 0 | 0 | `scalar-function:unsupported-node:TryStatement` × 3; `scalar-expression:too-small` × 2; `loop:unsupported-node:AssignmentStatement` × 1 |
| generator | 0 | 200 | 0 | `loop:unsupported-node:TryStatement` × 1; `scalar-expression:too-small` × 1; `scalar-expression:unsupported-op:to` × 1 |
| large | 0 | 0 | 0 | `tensor:output-shape` × 9000; `scalar-function:budget:AssignmentStatement` × 3; `loop:unsupported-node:AssignmentStatement` × 1 |
| error | 0 | 0 | 0 | none observed |

Raw JSON retains backend timing, fallbacks/categories, known allocation/copy/cell work,
all samples and the explicit language-error/effect outcomes. It does not assert that
a completed backend entry performed every operation itself. Detailed tracing is
intentionally bounded; aggregate execution counts remain complete for observed backends.

## Findings and validation

The compiled/reference comparison exposes costs that a before/after compiler
comparison can miss. Prepared scalar execution is about 10.7× faster than
interpretation on Mac and 12.2× on Intel; the ownership case is about 2.4×/2.7×
faster. Euler 001 has a smaller benefit (about 1.14×/1.26×). These are workload
measurements, not a promise about arbitrary Rank programs.

The large generated-control example is roughly twice as slow as interpretation
on both hosts. Protected effectful calls also show no performance benefit here.
Those are actionable optimization targets, not coverage successes that should
be represented as speedups. This workstream measures them; it does not claim to
have fixed them. Tracing overhead is substantial and must remain outside ordinary
execution timing. RSS comparisons are process peaks, not retained compiler heap.

Initial preparation is measured separately in a fresh process, before any program
warmup. It must not be subtracted from the warm sample median: they describe
different cache states and different processes. The initial probe is a single
observation per case and host, not a statistical estimate of compiler latency.
All its source hashes and observable outcomes match the saved reference runs.

Validation: TypeScript build passed; 509 tests passed across six focused
interpreter files, including 417 capability cases and four new evidence tests.
Thirteen CLI diagnostics tests passed. Both hosts passed all 48 case/process-pair
checks (480 timed worker processes overall). Tests did not run concurrently with
benchmarks on the same host. Full suites and exhaustive audits were not run.

Runtime measurements use `b2192600`. Subsequent harness-only changes add the
fresh preparation probe, workload error-status validation and report definitions;
they do not change interpreter execution or the recorded timing samples.
