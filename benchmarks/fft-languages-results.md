# FFT: Rank, JavaScript, Ruby and Python

Apple M5, FFT-4096, Rank commit b6bdadafdb408b1b8d033088112c6bc555e3318d.
Seven fresh processes per variant, rotating order across trials.
Each process warms for >=1.5 s, then runs three >=750 ms batches.
The table is the median of the per-process batch medians.
All execution is serial; no test/build workers were active at the start.

| Implementation | Median wall ms | Median process CPU ms | Worker range ms |
| --- | ---: | ---: | --- |
| rank | 0.8904 | 1.2901 | 0.5835-1.9449 |
| js | 0.1142 | 0.1474 | 0.0742-0.2154 |
| python | 5.5313 | 5.5307 | 3.6794-12.3008 |
| ruby | 6.0390 | 6.0374 | 4.2673-12.9486 |
| ruby-yjit | 2.4064 | 2.4063 | 1.6524-4.5790 |
| numpy-public | 0.1645 | 0.1645 | 0.1365-0.4190 |
| numpy-native | 0.0329 | 0.0329 | 0.0199-0.0648 |

The scalar Python and Ruby ports follow the same DIF algorithm as the
strong JS control, with in-place butterflies and a single output-gather
pass using reversed-index recurrence. Roots are freshly computed every
call. Rank runs the unchanged classic demo; its array-oriented index
construction is retained. This compares complete programs, not a single
identical machine-code kernel. Results are eager and checked against small
direct DFTs; Python/Ruby/NumPy additionally check the known complete spectrum
of the large sinusoidal input. Input creation and checking are untimed.

Versions: Node v24.15.0, Homebrew Ruby 4.0.6 (plain and explicitly enabled
YJIT), Homebrew CPython 3.14.7 (standard GIL build, no experimental JIT),
NumPy 2.5.4 in an isolated temporary venv. System Python 3.9 is not used.

numpy-public includes converting the same kind of input Python list into
an ndarray and converting the full complex output into two Python float
lists. numpy-native instead accepts a prebuilt ndarray and returns a fresh
complex ndarray; it is a separate API contract, not directly comparable to
Rank public array conversion. NumPy uses its library FFT, not the scalar
Python port. Its internal implementation/planning policy is unchanged.

The rank/python/ruby median wall ratios are:

- python: 6.21x Rank's time; median within-trial ratio 6.21x.
- ruby: 6.78x Rank's time; median within-trial ratio 8.20x.
- ruby-yjit: 2.70x Rank's time; median within-trial ratio 3.26x.

Absolute worker ranges are broad on this local machine. Treat these as
approximate measured ratios for this size and implementation, not general
language performance factors. No slow samples were discarded.

Raw evidence: [all trials](baselines/2026-11-01-fft-languages.json).
Build the intended Rank revision before repeating. The recorded run uses
Homebrew Ruby 4.0.6 and CPython 3.14.7; install NumPy 2.5.4 in a venv for
the Python controls. Interpreter paths are configurable; defaults use PATH.
For the original local environment:

```sh
uv venv --python /opt/homebrew/bin/python3 /tmp/rank-fft-python-env
uv pip install --python /tmp/rank-fft-python-env/bin/python numpy==2.5.4
node benchmarks/fft-languages.mjs \
  --python=/tmp/rank-fft-python-env/bin/python \
  --ruby=/opt/homebrew/opt/ruby/bin/ruby \
  --output=benchmarks/baselines/fft-languages-repeat.json
```

`--size` defaults to 4096 and accepts powers of two from 128; `--samples`
defaults to seven and requires at least three. Output is saved only with an
explicit `--output`, so a routine repeat does not overwrite recorded data.
The portable runner options were added after the recorded measurement;
the measured FFT implementations and timing contract are unchanged.
No compiler/runtime or demo source changes were made.
