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
| **0105** | [Раскопки](0105_excavations.ra) | Recursion / Exhaustive Search (76%) | Martian left-to-right arithmetic equation solver via single-pass vectorized parallel stack evaluation over $3^{K-1}$ combinations with `choose` and loop-free scatter reconstruction |
| **0110** | [Красивые числа](0110_beautiful_numbers.ra) | Simple Math / Fractions (78%) | Minimal sum of $\{0, k\}$-digit periodic fractions via carry-free $n/k$ decimal period slicing and vectorized `choose` digit thresholding |
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
| **0402** | [Коттеджный поселок](0402_cottages.ra) | Computational Geometry (75%) | Linearly separable 2-colorings via canonical line classification and vectorized square roots |
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
| **0437** | [Тапкодер](0437_tapcoder.ra) | Mathematical Modeling / Trees (78%) | Compressed $K$-level single-elimination bracket tree ($K \le 60$) with vectorized `lowerindex` fixed-match filtering and top-down reachability propagation |
| **0441** | [Карточки - 2](0441_cards_2.ra) | Data Structures / Sorting (73%) | Minimal adjacent swaps via `A argsort`, vector scatter assignment `P OrderB = OrderA` & `((P P outer greater) and (Indices Indices outer less)) count` |
| **0451** | [Арифметическое выражение](0451_expression.ra) | Parsing / Recursion (71%) | Evaluate Delphi arithmetic expressions with `sin`/`cos`, scientific notation, and operator precedence |
| **0455** | [Умножение дроби](0455_fraction_multiplication.ra) | Math / Strings (64%) | Periodic fraction multiplication by $N$ via BigInt arithmetic, period divisor reduction & cyclic shift |
| **0467** | [Закраска прямой - 2](0467_line_coloring_2.ra) | Sweep-line / Intervals (61%) | Longest white interval under parity flips via coordinate compression & prefix sum scan |
| **0468** | [Числовая последовательность - 2](0468_sequence_2.ra) | Combinatorics / Binary Search (62%) | Find $N$-th integer with exactly 3 set bits via combinatorial number system & binary search |
| **0479** | [Муравей и дерево](0479_ant_and_tree.ra) | Computational Geometry (63%) | Shortest path avoiding circular obstacle via vector dot products, projections & tangent arc angles |
| **0484** | [Трубопровод](0484_pipeline.ra) | Trees / Fibonacci Morphism (60%) | Find sequence of open valves in a 40-layer pipeline tree via iterative Fibonacci Lindenmayer morphism |
| **0503** | [Бюро путешествий](0503_travel_agency.ra) | Dynamic Programming / Bitmask (80%) | Optimal interplanetary route minimizing transit tsak wears via $O(N \cdot 2^N)$ subset-only DP, `popcount` layer grouping, and vectorized `choose` updates |
| **0510** | [Шоколадка](0510_chocolate_bar.ra) | Dynamic Programming (60%) | Domino tilings of $3 \times N$ rectangle via second-order linear recurrence $F_k = 4 F_{k-1} - F_{k-2}$ |
| **0512** | [Выпускной](0512_graduation.ra) | Dynamic Programming / Bitmask (75%) | Count matchings of size $K$ in bipartite graph via subsets DP & vectorized popcount filter |
| **0523** | [Роман в томах](0523_book_volumes.ra) | Binary Search / Greedy (60%) | Optimal chapter partitioning into $K$ volumes via binary search on answer |
| **0532** | [Трамвай](0532_tram.ra) | Data Structures / Sweep-line (74%) | Maximum passenger satisfaction across $P$ stops with $M$ seats via coordinate-compressed sum segment trees and `firstatleast` |
| **0533** | [Треугольники - 3](0533_triangles_3.ra) | Computational Geometry (66%) | Count non-degenerate isosceles triangles among $N$ integer points via vector distance sorting, RLE grouping & canonical half-plane collinear cancellation |
| **0537** | [Перестановки - 3](0537_permutations_3.ra) | Dynamic Programming / Bitmask (74%) | $M$-th lexicographical $K$-permutation with adjacent $\gcd \ge K$ via Hamiltonian path bitmask DP in $O(2^N \cdot N^2)$ |
| **0538** | [Радио](0538_radio.ra) | Graph Theory / Binary Search (61%) | Maximize non-interfering transmitter radius via binary search and bipartite 2-coloring |
| **0555** | [Вычисление сложности программы](0555_complexity.ra) | Dynamic Programming (76%) | Count nested loop operations mod ^{32}$ via reverse topological tree DP and suffix sum vectorization in a single flat loop |
| **0558** | [Упаковка](0558_packing.ra) | Computational Geometry (65%) | Soddy gap count via Descartes circle theorem vectorized over $a$ for pairs $(b, c)$ |
| **0560** | [Остановки](0560_bus_stops.ra) | Dynamic Programming (64%) | Minimum platform construction cost with gap intervals $[r, R]$ via prefix sum costs & range minimum segment tree queries |
| **0563** | [Задача про XOR](0563_xor_problem.ra) | Bitwise / Combinatorics (69%) | All-pairs power-of-two difference XOR sum via vector residue partitioning, run-length compression & bit parity |
| **0566** | [Халява](0566_freebie.ra) | Math / Branch & Bound (61%) | Maximize t-shirts from 1, 2, 3-star caps via closed forms for $K \le 3$, and DAG stack search with upper bound pruning for $K \ge 4$ |
| **0572** | [Технология программирования](0572_programming_technology.ra) | Greedy / Sorting (60%) | Maximize persuaded friends via dual-group sorting: $b_i \ge 0$ by threshold $a_i$ ascending, $b_i < 0$ by potential $(a_i + b_i)$ descending |
| **0573** | [НЛО](0573_ufo.ra) | Graph Theory / Maxflow (77%) | Minimum UFO patrol fleet via minimum path cover in DAG, exact integer distance inequality $3600(\Delta X^2 + \Delta Y^2) \le V^2 \Delta t^2$ and zero-loop bulk `maxflow` |
| **0583** | [Рисование](0583_drawing.ra) | Computational Geometry (65%) | Orthogonally convex polygon test via turtle direction scan and perimeter equality to $2(\Delta X + \Delta Y)$ |
| **0585** | [Египетские знаки](0585_egyptian_signs.ra) | Simple Math / Diophantine (72%) | Minimal $K \ge 1$ such that $2^K$ begins with $N \le 10^7$ via Baby-Step Giant-Step range queries on sorted fractional parts of $K \log_{10}(2)$ |
| **0586** | [Законопроект](0586_bill.ra) | Game Theory (62%) | Sequential parliamentary voting simulation via backward induction & vectorized column comparison |
| **0587** | [Экспедиция на Морс](0587_expedition_to_mors.ra) | Two Pointers / Geometry (70%) | Maximize vector sum magnitude via angular sorting `argsort`, prefix vector sums, and single 1D loop two-pointer half-plane rotation |
| **0588** | [Число](0588_self_describing_number.ra) | Number Theory / Construction (60%) | Autobiographical / self-describing numbers in base $b$ via closed-form digit construction `Digits (B - 5) = 1; Digits (B - 1) = B - 4` |
| **0591** | [Транспортная реформа](0591_transport_reform.ra) | Graph Theory / Matroids (70%) | Spanning tree with an even number of repair edges via Kruskal on `new dsu`, red component analysis, and single blue edge parity forcing |
| **0592** | [Небоскреб](0592_skyscraper.ra) | Graph Theory / Shortest Paths (77%) | Rigid 2D segment gravity settlement via vectorized `upperindex` horizontal overlap graph `components` and gap-weighted `DAG dijkstra 0` |
| **0599** | [Телешоу](0599_tv_show.ra) | Dynamic Programming / Strings (66%) | Optimal circular sector selection maximizing alphabet distance sum via $O(26 N)$ prefix sum deltas & `scan +` |
| **0604** | [Кактусы](0604_cacti.ra) | Dynamic Programming / Trees (78%) | Tree cactusness (vertex-disjoint path covers of length $\ge 2$) via reverse BFS `B .order` and single-loop elementary symmetric polynomial tree DP |
| **0607** | [Домино в казино](0607_domino_casino.ra) | Graph Theory (72%) | Max-weight $K$-domino placement on $M \times N$ grid via successive shortest augmenting paths (SPFA) on bipartite residual network with vectorized queue seeding |
| **0608** | [Про любовь](0608_about_love.ra) | Computational Geometry (70%) | Visibility polygon intersection via vectorized ray-corner intersection `outer *`, corner-touch DSU, and Liang-Barsky obstacle clipping |
| **0609** | [Разбиения множества](0609_set_partitions.ra) | Combinatorics (69%) | Next canonical set partition in lexicographical order via prefix preservation, candidate generation, and vectorized singleton completions |
| **0612** | [Подстрока](0612_substring.ra) | Free Groups / Strings (68%) | Shortest word in free group equivalent to $X$ containing $Y$ via longest common subword of reduced forms, binary search & vectorized set window matching |
| **0613** | [Поле чудес - 2](0613_field_of_wonders.ra) | Dynamic Programming / Probability (76%) | Probability of friend winning in wheel-of-fortune game via 4-channel mixed-radix multiplicity DP and vectorized cyclic player transitions |
| **0614** | [Скобки - 3](0614_brackets_3.ra) | Dynamic Programming / Strings (61%) | Count distinct regular bracket subsequences via DFA state transitions on greedy next-occurrence jumps |
| **0615** | [Новый год](0615_new_year.ra) | Graph Theory / Matching (62%) | Minimum weight edge cover in bipartite graph via reduction to maximum savings matching and Hungarian/MCMF augmentation |
| **0617** | [Ладьи](0617_rooks.ra) | Combinatorics / DP (80%) | Non-attacking white/black rook placements via zero-loop 3D tensor inclusion-exclusion and `binomial` matrix contractions |
| **0618** | [Диаграммы Юнга](0618_young_diagrams.ra) | Dynamic Programming / Partitions (74%) | Max subdiagrams in Young diagram for $N \le 100$ via suffix sum DP with `scan +` and `reduce +` over precomputed optimal partitions |
| **0620** | [Бассейн реки](0620_river_basin.ra) | Computational Geometry (67%) | Max river basin area via tributary reachability, Andrew's monotone chain convex hull and vectorized Shoelace formula |
| **0622** | [Прямоугольное деление](0622_rectangular_division.ra) | Computational Geometry / Graph (66%) | Planar face count formed by $N \le 100$ rectangles via dual compressed grid and `new dsu` |
| **0624** | [Электронная почта](0624_email.ra) | Graph Theory (62%) | Distributed email log consistency check via chronological dependency DAG and `Graph cycle` |
| **0631** | [Отгадай число](0631_guess_number.ra) | Game Theory / Minimax (60%) | Asymmetric candy guessing game reduced to Fibonacci thresholding via vector comparison `(F less N) count` |
| **0632** | [Отрезки](0632_segments.ra) | Computational Geometry (68%) | Area of planar regions cut by $N \le 50$ segments via coordinate compression, boundary wall DSU, and outer area weighting |
| **0644** | [Машина времени - 2](0644_time_key_2.ra) | Math / Binary Lifting (60%) | Fast key simulation $N \leftarrow N + \text{popcount}(N)$ over $K \le 2 \times 10^9$ steps via bit-block binary lifting and precomputed power-of-two cross tables |
| **0646** | [Сладкие забавы](0646_sweet_treats.ra) | Combinatorics / Knapsack (60%) | Fair candy partitioning into $\ge K$ subsets via vectorized 0-1 knapsack DP `DP (V till K) = (DP (V till K)) + (DP (0 till (K - V)))` |
| **0647** | [Адаптивный поиск](0647_adaptive_search.ra) | Data Structures / BIT (65%) | Move-to-front table query sequence simulation via linear-built Fenwick tree prefix sums |
| **0650** | [Странная сеть](0650_strange_network.ra) | Graph Theory (65%) | Total intermediate node distance in degree-$\le 2$ graph via DSU and closed formulas for paths and cycles |
| **0652** | [Квантовый имитатор](0652_quantum_simulator.ra) | Data Structures / Intervals (70%) | Subarray reversal and range sum queries on $N \le 10^9$ via dynamic interval array splitting `scan + with 0 array` and vectorized range reduction |
| **0655** | [Кодирование данных](0655_data_encoding.ra) | Number Theory / Carry Math (60%) | Smallest positive integer $A$ whose product with $K$ is a cyclic shift of $A$ via periodic carry transitions |
| **0656** | [Дорожный аукцион](0656_road_auction.ra) | Graph Theory (75%) | Min-weight connected $K$-edge subgraph via caterpillar/cycle spine linearization and vectorized knapsack DP |
| **0657** | [Привет, космос!](0657_hello_space.ra) | Integer Arithmetic / Decoding (60%) | Alien Manchester signal decoding from noisy pulse durations with $\le 10\%$ relative error via vectorized pulse classification and bounds intersection |
| **0658** | [Фермерское счастье](0658_farmer_happiness.ra) | Computational Geometry (65%) | Count empty triangles among $N$ points via angular sweep around bottom pivot and cross-product wedge testing |
| **0659** | [Перетягивание каната](0659_tug_of_war.ra) | Graph Theory / Min $K$-Cut (62%) | Bisection into teams of size $K$ and $N - K$ maximizing internal edges via Branch and Bound, vertex sorting `Order = (0 - Deg) argsort`, and vector future-cut pruning `FutureCut = ((To1 min To2) (Vtx till N)) sum` |
| **0660** | [Проверочная работа](0660_test_work.ra) | Data Structures / Monotonic Stack (60%) | Count empty subrectangles in $N \times M$ grid with $K$ painted cells via 2D sweep-line, coordinate sorting, vector height updates & monotonic stack |
| **0662** | [Green Darts](0662_green_darts.ra) | Math / Real Roots (75%) | Distinct ranking outcomes via pairwise quadratic root sweep and 2D vectorized rank evaluations |
| **0663** | [Предприимчивый Петя](0663_enterprising_petya.ra) | Graph Theory (72%) | Max-weight bipartite matching of corrupted submission masks to participant-problem pairs via successive shortest path (SPFA) on dual alternating queues |
| **0690** | [Конная прогулка](0690_knights_tour.ra) | Graph Theory (71%) | Warnsdorff's knight tour with squared corner-distance tie-break in zero inner loops via vectorized neighbor degree evaluation |
| **0705** | [Оценка](0705_evaluation.ra) | Integer Arithmetic / Matrix Exponentiation (65%) | Martian population growth $\sum_{k=0}^{N-1} k^2 2^k \pmod M$ via $4 \times 4$ modular matrix exponentiation |
| **0707** | [Зума](0707_zuma.ra) | Graph Theory / BFS (60%) | Zuma ball elimination with exact multi-level chain reactions via BFS and contiguous color block insertions |
| **0714** | [Кольцевая автодорога](0714_circular_highway.ra) | Computational Geometry (65%) | Find count and minimum-radius circle equidistant to 4 points via vector circumcenter and perpendicular bisector intersection |
| **0718** | [Новое слово в рекламе](0718_new_ad_word.ra) | String Parsing / Search (71%) | Minimal stacked advertising blocks containing target $S$ via column-major indexing, 2D character submatrix equality & vectorized row matching with `choose` |
| **0721** | [Стрелки - 2](0721_arrows_2.ra) | Graph Theory (68%) | Extrema of directed cycles on board: min via component BFS trees and 2-cycle seeds, max via bipartite matching `maxflow` |
| **0722** | [Шоколадки](0722_chocolates.ra) | Combinatorics / BigInt (60%) | 2-colored grids without size-3 monochromatic components via closed-form Fibonacci $2 F_{N+1} + 2 F_{M+1} - 2$ in 208-digit native BigInt arithmetic |
| **0723** | [Доставка грибов](0723_mushroom_delivery.ra) | Graph Theory (70%) | Max delivery time without target revisiting via forward/backward vector BFS reachability, in-degree subgraph cycle detection & tropical DAG DP |
| **0725** | [Громоотвод](0725_lightning_rod.ra) | Computational Geometry / Optimization (72%) | Min lightning rod height to cover $N \le 10$ 3D buildings via 2D nested ternary search on building roofs with zero-loop vectorized corner distance evaluation |
| **0727** | [Распределение участков](0727_plot_distribution.ra) | Game Theory / Greedy (62%) | Pure Nash equilibrium via greedy matching over all pairs sorted by `(0 - Key) argsort` |
| **0734** | [Строковый компьютер](0734_string_computer.ra) | Combinatorics / Free Monoids (61%) | Maximum non-redundant set size and number of such sets over alphabet $K$ and max length $N$ via geometric series and parity analysis |
| **0738** | [Слова - 2](0738_words_2.ra) | Combinatorics / Graph Theory (74%) | Maximum independent set of 5-letter transposition-confusion graph via frequency classification and canonical template substitution |
| **0740** | [Ключи](0740_keys.ra) | Data Structures / Sweep-line (61%) | Max overlapping holes under translation: pairwise open rectangles via `outer -`, Y compression with `lowerindex`, range-add segment tree |
| **0741** | [Замечательные дороги](0741_wonderful_roads.ra) | Graph Theory (62%) | Colors = largest biconnected block; iterative Tarjan with edge stack over CSR from `argsort` + `lowerindex` |
| **0746** | [Гонки](0746_races.ra) | Graph Theory (64%) | 4-cycles via `(Adj matpow 2)` common neighbors and `sum` |
| **0747** | [Декомпозиция строки](0747_string_decomposition.ra) | Dynamic Programming / Strings (65%) | Min-weight string decomposition $S_1^{d_1} \dots S_k^{d_k}$ via DP with LCP period expansion |
| **0749** | [Неправильный RSA](0749_incorrect_rsa.ra) | Number Theory / Combinatorics (64%) | Count non-trivial factorizations of $n = p^k \cdot q^k$ ($1 \le k \le 23$) via $O(1)$ relative tolerance float64 $k$-th power detection and precomputed 2D vector partitions of $(k, k)$ |
| **0750** | [Игра на графе](0750_graph_game.ra) | Graph Theory / Matching Game (81%) | Bipartite vertex-deletion game (Gallai-Edmonds essential matching vertices) in zero loops via Dinic `maxflow` residual `.cut` and `choose` |
| **0752** | [2-3 Дерево](0752_two_three_tree.ra) | Combinatorics (61%) | Level-by-level counting `C(M, N - 2M)` with a rolling Pascal row and slice updates mod $R$ |
| **0761** | [Ковбои](0761_cowboys.ra) | Graph Theory (65%) | Minimum edge-disjoint path cover / Eulerian trail decomposition via DSU and odd-degree vertex counting |
| **0767** | [Дороги - 3](0767_roads_3.ra) | Graph Theory (67%) | Max one-way roads via Robbins' theorem: total edges minus bridges found with Tarjan's DFS and `choose` |
| **0771** | [Экзамен](0771_exam.ra) | Data Structures / Trees (74%) | First Child - Next Sibling (FC-NS) binary tree representation and compact non-overlapping pseudographic layout via difference constraint relaxation |
| **0772** | [Конверт](0772_envelope.ra) | Simulation / Modeling (75%) | Flat paper folding simulation tracking interval layers, stack boundaries and outward face orientations |
| **0776** | [Юпитер](0776_jupiter.ra) | Graph Theory / BFS (62%) | BFS over (flights used, cell); each flight is one slice with `scan max` for the climb cost |
| **0801** | [Дом у дороги](0801_house_by_road.ra) | Computational Geometry / LP (78%) | Minimax distance to $N$ lines via vectorized 4-sign Cramer active-set basis exchange and Carathéodory normal convex hull tests |
| **0802** | [Магический квадрат](0802_magic_square.ra) | 2D Arrays / Combinatorics (70%) | $N \times N$ normal magic square construction with zero loops: closed-form Siamese for odd, inversion mask for $4k$, and vectorized Strachey quadrant `concat` for $4k+2$ |
| **0808** | [Про любовь ...](0808_about_love_2.ra) | Computational Geometry (70%) | Earliest contact time between moving stick segments via Minkowski difference parallelogram ray-casting & 4-edge Cramer intersection with zero loops |
| **0809** | [Спички детям не игрушка!](0809_matches.ra) | Computational Geometry (65%) | Min match moves under translation via canonicalized segment delta matching with `outer equal` & run-length translation voting |
| **0812** | [Сжатие последовательности](0812_sequence_compression.ra) | Dynamic Programming (69%) | Compositions of $N$ into parts $\le A$ via arbitrary-precision DP $DP[i] = 2 DP[i-1] - DP[i-1-A]$ with safe bounded index `choose` |
| **0813** | [Игра в 24](0813_game_24.ra) | Brute Force / Subset DP (62%) | Reachable values per card subset via `outer +`, `outer -`, `outer *` and `sort unique` |
| **0815** | [Обходчик лабиринтов](0815_maze_walker.ra) | Graph Theory / Automata (65%) | NFA step simulation over colored directed edges via `reduce` with vectorized boolean masking and index assignment |
| **0825** | [Китайская игра «Цзяньшидзы»](0825_jianshidzy.ra) | Combinatorics / Game Theory (69%) | $k$-th losing position in Wythoff's game via vectorized exact integer Beatty sequence $(k + \lfloor\sqrt{5 k^2}\rfloor) // 2$ with `isqrt` |
| **0827** | [Фруктовый сок](0827_fruit_juice.ra) | Graph Theory / Flow (66%) | Min DAG path cover via Dinic `maxflow` on subset inclusion bipartite split graph, length-pruned with `choose` |
| **0829** | [Строки - 3](0829_strings_3.ra) | Strings / Rolling Hash (60%) | Count substrings of $A$ that are cyclic shifts of $B$ in $O(|A| + |B|)$ using double polynomial rolling hash ($10^9+7$ and $10^9+9$) with `use algo` set |
| **0830** | [Странная таблица](0830_strange_table.ra) | BigInt / Bitwise Game Theory (81%) | Sum of $(N+1) \times (M+1)$ mex-table $A_{i,j} = i \oplus j$ ($N, M \le 10^9$) in zero loops via vectorized 31-bit period counting and `choose` |
| **0853** | [Игра с числами](0853_number_game.ra) | Dynamic Programming / Game Theory (77%) | Congruence class GCD parity game DP over canonical $(G, A_i \bmod G)$ states with vectorized `gcd` frontier closure and `lowerindex` |
| **0860** | [Паркет](0860_parquet.ra) | Dynamic Programming (68%) | Tiling with squares of any size via broken profile DP over column heights, grid transposition, and matrix subregion slicing |
| **0864** | [Шары и коробки - 2](0864_balls_and_boxes_2.ra) | Greedy / Dynamic Programming (68%) | Min moves to distribute $\le N$ balls in circular boxes: $O(N)$ median for $S=N$, candidate cut prefix DP for $S < N$ |
| **0866** | [Берляндия в опасности](0866_berland_in_danger.ra) | Graph Theory / Bipolar $st$-Numbering (82%) | Dual fault-tolerant biconnected graph traversal plans via single-loop Tarjan-Even $st$-numbering DFS and linked list insertion |
| **0879** | [Графы](0879_graphs.ra) | Graph Theory (70%) | Strong connectivity augmentation on hieroglyph transition digraph via Tarjan's SCC and source/sink condensation counting with `choose` |
| **0880** | [Покрытие](0880_covering.ra) | Dynamic Programming / Set Cover (74%) | Min fixed 6-cell planks to cover  	imes H$ floor via dominating mask reduction, conflict graph independent set lower bound, and IDA* search |
| **0885** | [Звезды за кормой](0885_stars.ra) | Search / BFS (65%) | Deterministic naval combat simulation: broadside cannons, enemy movement and debris creation via BFS |
| **0891** | [Кубик Рубика](0891_rubiks_cube.ra) | Graph Theory / Bidirectional BFS (67%) | Optimal 2x2x2 3-color Rubik's cube solver (God's algorithm) via meet-in-the-middle bidirectional BFS over vectorized permutations |
| **0898** | [Ленточка](0898_ribbon.ra) | Mathematical Modeling / Divide & Conquer (60%) | Determine fold crease orientations ('K' or 'O') on a folded paper ribbon ($N \le 60$) in $O(K \cdot N)$ via iterative binary reflection |
| **0901** | [Бессмыслица](0901_nonsense.ra) | Dynamic Programming / Number Theory (67%) | Landau's function $g(N)$ (max permutation order in $S_N$) via prime-power knapsack DP using `N primesieve` and `choose` |
| **0902** | [Ленточка - 2](0902_ribbon_2.ra) | Mathematical Modeling / Divide & Conquer (65%) | Invert folded ribbon crease pattern via binary reflection and `choose` in $O(2^N)$ |
| **0914** | [Пересечение](0914_intersection.ra) | Computational Geometry / 3D SAT (79%) | 3D oriented bounding box (OBB) intersection via zero-loop 15-axis Separating Axis Theorem and $15 \times 8 \times 3$ tensor projections |
| **0917** | [Забор - 3](0917_fence_3.ra) | Computational Geometry (72%) | Max polygon area from given side lengths via cyclic polygon circumradius binary search and zero-loop vectorized Heron chord triangles |
| **0919** | [Отель](0919_hotel.ra) | Math / Diophantine (65%) | Rectangle brick tiling test via Klarner's theorem and Frobenius Diophantine representation using `choose` |
| **0920** | [Игуана](0920_iguana.ra) | Bitmask / Inclusion-Exclusion (62%) | Chromatic number $N \le 18$: independent sets by doubling, zeta transform, $\sum (-1)^{N-|S|} I(S)^k$ over vectors |
| **0921** | [Турнир - 2](0921_tournament_2.ra) | Math / Vector Arithmetic (60%) | Optimal chess match count minimizing expected score differences via vectorized vector arithmetic `C = 1 till K`, `Diffs = ((C * (A - B)) + (K * B)) abs`, `MinDiff = Diffs min` |
| **0928** | [Березовая аллея](0928_birch_alley.ra) | Computational Geometry / Binary Search (70%) | Max enclosed trees under ribbon length $L$ via 2D tensor difference matrix of decoupled top/bottom perimeter boundaries and binary search |
| **0931** | [Две окружности - 2](0931_two_circles_2.ra) | Computational Geometry (72%) | Partition $N \le 2000$ points onto two circles via Pigeonhole 5-point triple candidate search and zero-loop vectorized distance classification |
| **0937** | [Макрос](0937_macro.ra) | String Parsing / Interpreters (72%) | Lexical macro expansion with block-scoped closures and cyclic `#rep` generation via 1D array environments and vectorized macro lookup |
| **0958** | [Осмотр королевства](0958_kings_tour.ra) | Graph Theory (62%) | Tournament Hamiltonian path merging $K$ chain routes |
| **0959** | [Защита деревьев](0959_tree_protection.ra) | Computational Geometry (70%) | Max trees enclosed by rigid triangle of sides $a, b, c$ via 1D line projection intervals and 2D matrix overlap reduction in a single loop |
| **0962** | [Развлечение с квадратиками](0962_squares.ra) | Computational Geometry (75%) | Count 4-tuples of squares with equal difference figures under translation via canonical signature grouping and (M)$ inclusion-exclusion |
| **0963** | [Морфизм](0963_morphism.ra) | Dynamic Programming (63%) | Binary lifting over 20-character substitution prefix table |
| **0972** | [Задачка по геометрии](0972_geometry.ra) | Computational Geometry (66%) | Circle intersecting two segments once via 4-pair vectorized endpoint midpoint margin optimization |
| **0974** | [Странный Ним](0974_strange_nim.ra) | Game Theory (65%) | 3-coin Welter's Game via Conway's Frieze rule in $O(1)$ without loops |
| **0975** | [Числа - 4](0975_numbers_4.ra) | Integer Arithmetic (71%) | Lexicographically minimal multiple of $K \le N \le 10^{18}$ via greedy digit search and zero-loop vectorized prefix interval checks across all powers of 10 |
| **0976** | [Сумма или произведение](0976_sum_or_product.ra) | Combinatorics / Number Theory (74%) | Count multisets where product equals sum via =2$ divisor factorization and flat 1D BFS state queue for  \ge 3$ |
| **0977** | [Поезда](0977_trains.ra) | Combinatorics (70%) | Graphs without isolated vertices via inclusion-exclusion $\sum (-1)^k \binom{N}{k} 2^{\binom{N-k}{2}}$ in zero loops |
| **0978** | [Последовательность - 5](0978_sequence_5.ra) | Number Theory (79%) | Legendre's formula for maximal $k$ with $n^k \mid n!$ using `N factors unique` |
| **0980** | [Отрезание ушей](0980_ear_cutting.ra) | Graph Theory / Ear Decomposition (80%) | 2-edge-connected ear removal decomposition via single-loop DFS back-edge coverage, `argsort` by ancestor preorder, and bottom-up tree path tracing |
| **0989** | [Окопы](0989_trenches.ra) | Geometry / SAT (64%) | Strict separating line via Separating Axis Theorem (SAT) over difference vectors |
| **0990** | [Пирожные](0990_cakes.ra) | Dynamic Programming / Partition (76%) | Minimum dissatisfaction cake distribution via flat topological event DP, vectorized column knapsack `scan min axis 0` and backwards reconstruction |
| **0993** | [Симпатичные последовательности](0993_pretty_sequences.ra) | Data Structures / Segment Tree (61%) | Maximal $k$-pretty prefix via point increment updates and range prefix minimum segment tree queries `Tree 0 (V - 1) query` |
| **0998** | [Велосипедные дорожки](0998_bike_paths.ra) | Computational Geometry / Snell's Law (72%) | Min travel time across two circular tracks via Snell's law dual virtual concentric circle common tangents and zero-loop analytical arc evaluation |
| **0999** | [Диверсия](0999_sabotage.ra) | Graph Theory (70%) | Count 2-edge (stone, dirt) cuts via spanning tree BFS, back-edge difference accumulation, and reverse topological sum |
| **1000** | [Упаковка чисел](1000_number_packing.ra) | Bitwise / Encodings (65%) | Variable-length prefix-free integer encoding (1–9 bytes) into hex |
