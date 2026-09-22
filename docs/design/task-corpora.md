# Task corpora

Rank should be tested against real tasks, not designed from a list of imagined
features. Three corpora exercise different parts of the language.

## Numerical scripts

[MATLAB Cody](https://www.mathworks.com/matlabcentral/cody/problems.html)
provides compact array and numerical tasks. Use it to test shapes, axis and
rank behavior, linear algebra, statistics, random values, plotting and file
formats. Its terms and access rules must be checked before copying a task or a
test verbatim.

The existing numerical roadmap proposes a fixed set of 50 tasks. For every
task, record whether it is clear in current Rank, needs a library operation,
exposes a general language problem, or needs an environment feature. See
[Numerical scripting roadmap](numerical-scripting-roadmap.md).

### Engineering and real-data seed set

The following Cody-inspired tasks are a proposed numerical corpus. Rank owns
the programs, inputs and oracle tests; the linked task is a
source of the scenario rather than a test copied verbatim. Work through this
list one task at a time. A task earns a language addition only when the Rank
program or a measured workload makes the missing general capability clear.

| Task | Source | Primary contract | Status |
| --- | --- | --- | --- |
| Architecture interfaces | [Cody 61467](https://www.mathworks.com/matlabcentral/cody/problems/61467) | Count and inspect directed, weighted connectivity matrices. | Candidate |
| Missing weather readings | [Cody 71](https://www.mathworks.com/matlabcentral/cody/problems/71) | Parse a table, retain several missing runs and interpolate them. | Implemented: `demos/cody/00071_wx.ra` |
| Pairwise point distances | [Cody 43007](https://www.mathworks.com/matlabcentral/cody/problems/43007) | Produce an `N N` distance matrix from `N P` points without an accidental `N N P` allocation. | Implemented: `demos/cody/43007_pd.ra` |
| Hyperspectral unmixing | [Cody 843](https://www.mathworks.com/matlabcentral/cody/problems/843) | Fit material fractions from one spectrum and a library matrix. | Implemented: normal-equation baseline in `demos/cody/00843_um.ra`; constraints remain a gap |
| Local grid extrema | [Cody 54730](https://www.mathworks.com/matlabcentral/cody/problems/54730-local-extrema) | Preserve strict extrema against in-bounds eight-neighbors. | Implemented: `demos/cody/54730_lx.ra` |
| Sensor vignetting correction | [Cody 682](https://www.mathworks.com/matlabcentral/cody/problems/682) | Apply a per-column calibration vector to an image. | Candidate |
| Noisy-signal filtering | [Cody 220](https://www.mathworks.com/matlabcentral/cody/problems/220) | Recover a sampled signal with a stated quality oracle. | Candidate: assess DSP names and FFT/filtering |
| Tolerance flood fill | [Cody 46028](https://www.mathworks.com/matlabcentral/cody/problems/46028) | Traverse a four-neighbor numeric image region within a seed tolerance. | Implemented: `demos/cody/46028_ff.ra` |
| Emergency braking trajectory | [Cody 61189](https://www.mathworks.com/matlabcentral/cody/problems/61189) | Model a time series with variable deceleration, stopping event and distance. | Implemented: `demos/cody/61189_bt.ra` |

## R data analysis

[Exercism's R track](https://exercism.org/tracks/r) is a structured source of
small exercises covering R idioms. It is useful for vectors, missing values,
tables, grouping, strings, dates, functional operations and statistics.

[Codewars](https://www.codewars.com/) has R kata that can add shorter,
competition-style checks for those same areas. Select tasks manually and record
their source URL and license or reuse conditions.

Start with 20 to 30 Exercism exercises. A task is useful only when the Rank
solution makes the missing capability clear: a library operation, a table
semantic rule, or a language-model gap. Do not copy R's historical behavior
without deciding whether it fits Rank.

## Algorithms and contests

[CSES](https://cses.fi/problemset/) and the existing [Project Euler
examples](../examples/project-euler.md) test a different contract: algorithms,
memory use and execution time at judge-scale inputs. They are the evidence for
`use algo` structures such as Fenwick trees, segment trees, heaps and graph
operations.

A contest task can justify a new primitive only when ordinary Rank misses its
limits by measurement and the primitive keeps the solution readable. The full
admission rule is in the [competitive-programming library
roadmap](competitive-programming-library.md).

## Common record

Keep one entry for every adopted task with:

- source URL, license or reuse condition, and input/output oracle;
- the Rank program and its current status;
- the capability it tests;
- a regression test; and
- a benchmark when time or memory is part of the task.

The three corpora are complementary. Numerical tasks test array programming;
R tasks test data analysis; contest tasks test algorithms and performance.
