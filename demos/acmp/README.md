# ACMP exercises

Programming-contest exercises from [acmp.ru](https://acmp.ru/), selected from the elite difficulty brackets (Hardcore 87 + Golden 60) covering dynamic programming, graph theory, combinatorics, number theory and geometry.

Solutions are written in the direct procedural style of Project Euler 1–15, avoiding unnecessary top-level helper functions and prioritizing array-oriented vector operations (APL/J style) such as scans, masks, outer operations, and matrix transformations.

## Solved Tasks

| Task | Title | Topic | Array / Vector Technique |
| :--- | :--- | :--- | :--- |
| **0077** | [Нолики](0077_zeros.ra) | Combinatorics (63%) | Count binary zeros up to $N$ with broadcast `(Range binomial K) sum` |
| **0083** | [Симпатичные узоры](0083_pretty_patterns.ra) | Bitmask DP (66%) | Profile DP with bitwise ops (`band`, `bor`, `bxor`) & `Compat matpow (Cols - 1) sum` over a column-compatibility matrix |
| **0100** | [Счастливые билеты](0100_lucky_tickets.ra) | Combinatorics (68%) | Polynomial convolution via `DP scan + with 0 array` & vectorized index slicing `DP = C Hi - C Lo` |
| **0101** | [Магараджа](0101_maharaja.ra) | Backtracking / Bitmask (60%) | Non-attacking Maharajas (queen + knight) placement via row-by-row bitmask search |
| **0104** | [Шаблон](0104_pattern.ra) | 2D DP (65%) | Wildcard pattern matching with `*` and `?` over 2D state matrix |
| **0116** | [Фермер](0116_farmer.ra) | Geometry / Monotonic Stack (60%) | Maximal 1-rectangle via histogram heights `(Heights + 1) * Row` & monotonic stack |
| **0137** | [Существование пути](0137_path_existence.ra) | Graph Theory (65%) | Floyd-Warshall with negative cycles using vector outer additions `(Col Row outer +)` |
| **0139** | [Лабиринт знаний](0139_knowledge_maze.ra) | Graph Theory (63%) | Longest path from 1 to $N$ & positive cycle detection via vector reachability & Bellman-Ford |
| **0146** | [Длинный квадратный корень](0146_long_sqrt.ra) | Number Theory (67%) | Exact $\lfloor\sqrt{A}\rfloor$ for integers up to $10^{3000}$ via arbitrary-precision Newton-Raphson |
| **0158** | [Великий комбинатор](0158_combinator.ra) | Combinatorics (60%) | Stars-and-bars integer distribution via exact combinatorial `(N + K) binomial K` |
| **0176** | [Скобки](0176_brackets.ra) | Combinatorics / DP (69%) | Dyck path vector DP via shift-addition and boolean mask `(DP + Shifted) * Mask` |
| **0188** | [Перестановки с неподвижными точками](0188_derangements.ra) | Combinatorics (65%) | Subfactorial $!N$ derangements recurrence with arbitrary precision arithmetic |
| **0191** | [Гладкие числа](0191_smooth_numbers.ra) | Combinatorics (60%) | Vector `scan + with 0 array` & `(CumWays less RemN) count` ranking without nested loops |
| **0200** | [Марсианские факториалы](0200_martian_factorials.ra) | Number Theory (60%) | Trailing zeros of $N!$ in base $K$ via prime factorization `K factors array` and Legendre's formula |
| **0209** | [Точки в многоугольнике](0209_lattice_points.ra) | Geometry (64%) | Pick's Theorem using vector Shoelace formula `Xs * YsNext - XsNext * Ys` and `DX gcd DY sum` |
| **0212** | [Деревни](0212_villages.ra) | Tree DP (79%) | Rooted tree bottom-up DP with vectorized min-plus convolution `((DP U S1) + (DP V S2)) min` |
| **0219** | [Симпатичные таблицы](0219_cute_tables.ra) | Network Flow (75%) | Row/col sum validation via `sum axis` & bipartite max flow with Edmonds-Karp |
| **0223** | [Анаграммер](0223_anagrammer.ra) | Interval DP (75%) | Dyck path interval decomposition `sum (DP Len1 I1 J1 * DP Len2 I2 J2)` |
| **0230** | [Луч света в темном царстве](0230_ray_of_light.ra) | Simulation / Optics (63%) | Deterministic 4-ray optical tracing with specular corner reflections |
| **0232** | [Дремучий лес - 2](0232_dense_forest.ra) | Computational Geometry (77%) | Geometric duality & 1D shadow interval projection with vector `argsort` & prefix max scan |
| **0239** | [Узор](0239_pattern.ra) | Bitmask DP (80%) | Exact-cover bitmask DP with tile rotation generator & lowest-unset-bit transitions |
| **0240** | [Кубический отель](0240_cubic_hotel.ra) | 3D Geometry / Simulation (70%) | Reconstruct $N \times N \times N$ colored voxel cube from 6 orthogonal views via iterative ray carving |
| **0242** | [Раскраска плиток](0242_tile_coloring.ra) | Math / Modulo (62%) | Linear modular system solver for periodic grid coloring |
| **0243** | [Маскарад](0243_masquerade.ra) | Greedy / Math (60%) | Optimal discount package purchasing with boundary overbuy check |
| **0261** | [Лотерея](0261_lottery.ra) | Game Theory / Trees (62%) | Complete binary tree minimax evaluation for adversarial lottery bets |
| **0289** | [Делители](0289_divisors.ra) | Number Theory (75%) | Minimal integer with $D$ divisors via prime power search & branch-and-bound |
| **0304** | [Волейбол - 2](0304_volleyball_2.ra) | Simulation / Parsing (63%) | Match set score validation and tiebreaker rule verification |
| **0337** | [Лампочки](0337_lightbulbs.ra) | Number Theory / Inclusion-Exclusion (94%) | Parity LCM inclusion-exclusion term update with vector `lcm`, `argsort` & run-length merge |
| **0342** | [Вписанная окружность](0342_inscribed_circle.ra) | Computational Geometry (68%) | Convex polygon incircle via vector inward normals, $2 \times 2$ Cramer solve & `(Diffs less 0.0001) all` |
| **0396** | [Точки и отрезки](0396_points_and_segments.ra) | Data Structures / Scan (62%) | Segment point containment using tagged coordinate prefix scans `scan +` & scatter assignment |
| **0403** | [Обмен валюты](0403_currency_exchange.ra) | Digit DP (70%) | Count integers in $[A, B]$ with $\le 2$ copies of each digit via memoized digit DP |
| **0404** | [Игра в камешки](0404_stone_game.ra) | Game Theory (63%) | Square-root subtraction game up to $10^{12}$ via P-position sieve |
| **0405** | [Туристическое агентство](0405_travel_agency.ra) | Graph Theory (80%) | Count cut-vertex disconnected component pairs using vector DSU & `(Roots U outer equal integer) sum axis 0` |
| **0410** | [Цифровое колдовство](0410_digital_sorcery.ra) | BFS / Number Theory (75%) | Minimal number $K$ with $(N + K) \equiv 0 \pmod M$ and minimal digit sum via Dial's algorithm & BFS |
| **0414** | [Расследование](0414_investigation.ra) | Tree LCA (65%) | Lowest common ancestor in tree rooted at 1 with ancestor tagging |
| **0428** | [SMS](0428_sms.ra) | Dynamic Programming (74%) | Mobile keyboard SMS decoding via character-button matrix dot product & polynomial composition convolution |
| **0432** | [Грядки](0432_garden_beds.ra) | Graph / Connected Components (60%) | 4-connected grid components via vector neighbor masks and Disjoint Set Union (`new dsu`) |
| **0434** | [Стеклянный забор](0434_glass_fence.ra) | Computational Geometry (72%) | Orthogonal convex hull with minimal perimeter & area via `TopY scan max axis 0` & `BotY scan min axis 0` |
| **0435** | [Несчастливые номера](0435_unlucky_numbers.ra) | Combinatorics / DP (88%) | Count unpartitionable $N$-digit numbers via polynomial parity convolution & bitset subset sum |
| **0436** | [Счастливые цифры](0436_lucky_digits.ra) | Number Theory (60%) | Base $D$ maximizing trailing digits $K$ up to $N = 10^{11}$ via divisor analysis & base testing |
| **0441** | [Карточки - 2](0441_cards_2.ra) | Data Structures / Sorting (73%) | Minimal adjacent swaps via `A argsort`, vector scatter assignment `P OrderB = OrderA` & `((P P outer greater) and (Indices Indices outer less)) count` |
| **0455** | [Умножение дроби](0455_fraction_multiplication.ra) | Math / Strings (64%) | Periodic fraction multiplication by $N$ via BigInt arithmetic, period divisor reduction & cyclic shift |
| **0467** | [Закраска прямой - 2](0467_line_coloring_2.ra) | Sweep-line / Intervals (61%) | Longest white interval under parity flips via coordinate compression & prefix sum scan |
| **0468** | [Числовая последовательность - 2](0468_sequence_2.ra) | Combinatorics / Binary Search (62%) | Find $N$-th integer with exactly 3 set bits via combinatorial number system & binary search |
| **0479** | [Муравей и дерево](0479_ant_and_tree.ra) | Computational Geometry (63%) | Shortest path avoiding circular obstacle via vector dot products, projections & tangent arc angles |
| **0484** | [Трубопровод](0484_pipeline.ra) | Trees / Fibonacci Morphism (60%) | Find sequence of open valves in a 40-layer pipeline tree via iterative Fibonacci Lindenmayer morphism |
| **0510** | [Шоколадка](0510_chocolate_bar.ra) | Dynamic Programming (60%) | Domino tilings of $3 \times N$ rectangle via second-order linear recurrence $F_k = 4 F_{k-1} - F_{k-2}$ |
| **0523** | [Роман в томах](0523_book_volumes.ra) | Binary Search / Greedy (60%) | Optimal chapter partitioning into $K$ volumes via binary search on answer |
| **0538** | [Радио](0538_radio.ra) | Graph Theory / Binary Search (61%) | Maximize non-interfering transmitter radius via binary search and bipartite 2-coloring |
| **0563** | [Задача про XOR](0563_xor_problem.ra) | Bitwise / Combinatorics (69%) | All-pairs power-of-two difference XOR sum via vector residue partitioning, run-length compression & bit parity |
| **0566** | [Халява](0566_freebie.ra) | Math / Branch & Bound (61%) | Maximize t-shirts from 1, 2, 3-star caps via closed forms for $K \le 3$, and DAG stack search with upper bound pruning for $K \ge 4$ |
| **0572** | [Технология программирования](0572_programming_technology.ra) | Greedy / Sorting (60%) | Maximize persuaded friends via dual-group sorting: $b_i \ge 0$ by threshold $a_i$ ascending, $b_i < 0$ by potential $(a_i + b_i)$ descending |
| **0586** | [Законопроект](0586_bill.ra) | Game Theory (62%) | Sequential parliamentary voting simulation via backward induction & vectorized column comparison |
| **0588** | [Число](0588_self_describing_number.ra) | Number Theory / Construction (60%) | Autobiographical / self-describing numbers in base $b$ via closed-form digit construction `Digits (B - 5) = 1; Digits (B - 1) = B - 4` |
| **0614** | [Скобки - 3](0614_brackets_3.ra) | Dynamic Programming / Strings (61%) | Count distinct regular bracket subsequences via DFA state transitions on greedy next-occurrence jumps |
| **0615** | [Новый год](0615_new_year.ra) | Graph Theory / Matching (62%) | Minimum weight edge cover in bipartite graph via reduction to maximum savings matching and Hungarian/MCMF augmentation |
| **0624** | [Электронная почта](0624_email.ra) | Graph Theory (62%) | Distributed email log consistency check via chronological dependency DAG and `Graph cycle` |
| **0655** | [Кодирование данных](0655_data_encoding.ra) | Number Theory / Carry Math (60%) | Smallest positive integer $A$ whose product with $K$ is a cyclic shift of $A$ via periodic carry transitions |
| **0659** | [Перетягивание каната](0659_tug_of_war.ra) | Graph Theory / Min $K$-Cut (62%) | Bisection into teams of size $K$ and $N - K$ maximizing internal edges via Branch and Bound, vertex sorting `Order = (0 - Deg) argsort`, and vector future-cut pruning `FutureCut = ((To1 min To2) (Vtx till N)) sum` |
| **0714** | [Кольцевая автодорога](0714_circular_highway.ra) | Computational Geometry (65%) | Find count and minimum-radius circle equidistant to 4 points via vector circumcenter and perpendicular bisector intersection |
| **0734** | [Строковый компьютер](0734_string_computer.ra) | Combinatorics / Free Monoids (61%) | Maximum non-redundant set size and number of such sets over alphabet $K$ and max length $N$ via geometric series and parity analysis |
| **0749** | [Неправильный RSA](0749_incorrect_rsa.ra) | Number Theory / Combinatorics (64%) | Count non-trivial factorizations of $n = p^k \cdot q^k$ ($1 \le k \le 23$) via $O(1)$ relative tolerance float64 $k$-th power detection and precomputed 2D vector partitions of $(k, k)$ |
| **0974** | [Странный Ним](0974_strange_nim.ra) | Game Theory (65%) | 3-coin Welter's Game via Conway's Frieze rule in $O(1)$ without loops |
| **0978** | [Последовательность - 5](0978_sequence_5.ra) | Number Theory (79%) | Legendre's formula for maximal $k$ with $n^k \mid n!$ using `N factors unique` |
| **1000** | [Упаковка чисел](1000_number_packing.ra) | Bitwise / Encodings (65%) | Variable-length prefix-free integer encoding (1–9 bytes) into hex |
