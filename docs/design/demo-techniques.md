# Demo techniques

A meta-analysis of the demos: one section per technique, listing which demos
and documentation pages use it. Add a section when a second demo needs the
same idea, and link the demos from it.

## Transfer-matrix method

**Idea.** Find a compact description of the past (a state) from which the
construction can continue. After `t` steps keep a vector: `v[t][j]` is the
number of ways to be in state `j`. One step is a matrix: `T[i][j]` is the
number of ways to go from `i` to `j`. Then `v[t+1] = v[t] T`, and when the
rule is the same at every step, `v[n] = v[0] T^n`.

**Two skills.** Modeling is choosing the states and building `T`; it is most of
the work. Speed-up is computing `T^n` by repeated squaring: about `log2 n`
matrix products instead of `n` steps. `matpow` does this exactly; a modular
form is tracked in
[#503](https://github.com/kmmbvnr/rank/issues/503).

**Fits** when there are few states, many steps and a local rule. It does not
fit N queens: the state (columns and diagonals) is exponential in `n` and there
are only `n` steps.

| Demo | State | Notes |
| --- | --- | --- |
| [ACMP 0083 Pretty Patterns](../../demos/acmp/0083_pretty_patterns.ra) | colors of one column | `Compat matpow (Cols - 1) sum` |
| [CSES 1096 Throwing Dice](../../demos/cses/math/022_throwingdice.ra) | last 6 sums | linear recurrence, modular |
| [CSES 1723 Graph Paths I](../../demos/cses/math/023_graphpaths1.ra) | vertex | walks of exact length, modular |
| [CSES 1724 Graph Paths II](../../demos/cses/math/024_graphpaths2.ra) | vertex | min-plus instead of plus-times |
| [CSES 1726 Moving Robots](../../demos/cses/math/029_movingrobots.ra) | board cell | Markov chain, real matrix |
| [Euler 435](../../demos/euler/435_polynomialsfib.ra) | `a(k)`, `a(k-1)`, `F(k)` | 3 x 3, huge `N`, modular |
| [Euler 584](../../demos/euler/584_birthdayrevisited.ra) | counts of the last `D` days | trace of the `N`-th power |

Pages: [matrix powers in the spec](../CURRENT_SPEC.md#matrix-powers),
[the same section in tensors](../language/tensors.md#matrix-powers) and the
`matpow` entry of the [linalg manual](../manual/linalg.md#matpow).

Demos with a hand-written modular power (`022`, `023`, `435`) are candidates
for the fused `matpow ... mod` form once #503 is done.
