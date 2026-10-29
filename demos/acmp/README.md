# ACMP exercises

Programming-contest exercises from [acmp.ru](https://acmp.ru/), selected from the elite difficulty brackets (Hardcore 87 + Golden 60) covering dynamic programming, graph theory, combinatorics, number theory and geometry.

Solutions are written in the direct procedural style of Project Euler 1–15, avoiding unnecessary top-level helper functions and prioritizing array-oriented vector operations (APL/J style) such as scans, masks, outer operations, and matrix transformations.

## Solved Tasks

| Task | Title | Topic | Array / Vector Technique |
| :--- | :--- | :--- | :--- |
| **0083** | [Симпатичные узоры](0083_pretty_patterns.ra) | Bitmask DP (66%) | Profile DP with bitwise ops (`band`, `bor`, `bxor`) & matrix dot product `(Compat * DP) sum axis -1` |
| **0100** | [Счастливые билеты](0100_lucky_tickets.ra) | Combinatorics (68%) | Polynomial convolution via `DP scan + with 0 array` & vectorized index slicing `DP = C Hi - C Lo` |
| **0104** | [Шаблон](0104_pattern.ra) | 2D DP (65%) | Wildcard pattern matching with `*` and `?` over 2D state matrix |
| **0116** | [Фермер](0116_farmer.ra) | Geometry / Monotonic Stack (60%) | Maximal 1-rectangle via histogram heights `(Heights + 1) * Row` & monotonic stack |
| **0137** | [Существование пути](0137_path_existence.ra) | Graph Theory (65%) | Floyd-Warshall with negative cycles using vector outer additions `(Col Row outer +)` |
| **0146** | [Длинный квадратный корень](0146_long_sqrt.ra) | Number Theory (67%) | Exact $\lfloor\sqrt{A}\rfloor$ for integers up to $10^{3000}$ via arbitrary-precision Newton-Raphson |
| **0158** | [Великий комбинатор](0158_combinator.ra) | Combinatorics (60%) | Stars-and-bars integer distribution via exact combinatorial `(N + K) binomial K` |
| **0176** | [Скобки](0176_brackets.ra) | Combinatorics / DP (69%) | Dyck path vector DP via shift-addition and boolean mask `(DP + Shifted) * Mask` |
| **0188_** | [Перестановки с неподвижными точками](0188_derangements.ra) | Combinatorics (65%) | Subfactorial $!N$ derangements recurrence with arbitrary precision arithmetic |
| **0191** | [Гладкие числа](0191_smooth_numbers.ra) | Combinatorics (60%) | Vector `scan + with 0 array` & `(CumWays less RemN) count` ranking without nested loops |
| **0209** | [Точки в многоугольнике](0209_lattice_points.ra) | Geometry (64%) | Pick's Theorem using vector Shoelace formula `Xs * YsNext - XsNext * Ys` and `DX gcd DY sum` |
| **0212** | [Деревни](0212_villages.ra) | Tree DP (79%) | Rooted tree bottom-up DP with vectorized min-plus convolution `((DP U S1) + (DP V S2)) min` |
| **0219** | [Симпатичные таблицы](0219_cute_tables.ra) | Network Flow (75%) | Row/col sum validation via `sum axis` & bipartite max flow with Edmonds-Karp |
| **0223** | [Анаграммер](0223_anagrammer.ra) | Interval DP (75%) | Dyck path interval decomposition `sum (DP Len1 I1 J1 * DP Len2 I2 J2)` |
| **0230** | [Луч света в темном царстве](0230_ray_of_light.ra) | Simulation / Optics (63%) | Deterministic 4-ray optical tracing with specular corner reflections |
| **0232** | [Дремучий лес - 2](0232_dense_forest.ra) | Computational Geometry (77%) | Geometric duality & 1D shadow interval projection with vector `argsort` & prefix max scan |
| **0239** | [Узор](0239_pattern.ra) | Bitmask DP (80%) | Exact-cover bitmask DP with tile rotation generator & lowest-unset-bit transitions |
| **0974** | [Странный Ним](0974_strange_nim.ra) | Game Theory (65%) | 3-coin Welter's Game via Conway's Frieze rule in $O(1)$ without loops |
| **0978** | [Последовательность - 5](0978_sequence_5.ra) | Number Theory (79%) | Legendre's formula for maximal $k$ with $n^k \mid n!$ using `N factors unique` |
| **1000** | [Упаковка чисел](1000_number_packing.ra) | Bitwise / Encodings (65%) | Variable-length prefix-free integer encoding (1–9 bytes) into hex |
