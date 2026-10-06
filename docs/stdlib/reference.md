# Standard library reference

Core vocabulary and standard modules, including constructs without a
function name. Rank is data-first, so an operation
follows the data it reads: `Values sum`, `Text Separator split`.

This page is generated from `packages/language/src/operations.ts` by
`rank ops --markdown`, and `npm test` fails when the two disagree. Edit the
catalogue, not this file. For what each module means and how its operations
behave at the edges, read [the standard library](modules.md).

## Default cells

Every operation and supported arity below records its declared cell ranks.
A numeric rank selects trailing axes; leading axes form a broadcast frame.
Inputs with fewer axes are passed whole and validated by the operation.
Cell rank does not guess whether a matrix represents a batch of vectors.
Explicit `rank` overrides these defaults; `axis` selects frame axes.

Unary global reductions (`sum`, `min`, `max`, boolean reductions and
statistics) take whole values. Structural operations, text/document parsers,
tables, graphs and effectful operations retain their collection or object
semantics. `reverse` reverses the leading axis; `len` measures it. `window`
uses its requested window dimensions and axes. `matmul` contracts the last
left axis with the first right axis; `solve` accepts a whole matrix and a
vector or matrix right side. Batched solve requires `rank 2 1` or `rank 2 2`.

`sort`, `argsort`, `unique`, `integer` and `real` use rank 1. Sort direction
labels configure that unary operation rather than adding a data operand.
Numeric conversion overloads retain their existing element mapping; text
parses as a whole string, with explicit rank 0 for individual digits.
`det`, `inverse`, `diag` and `eigh` use rank 2. Configured diagonal modes
and offsets keep that rank. Internally mapped scalar math is marked
separately from declared ranks; this audit preserves its existing behavior.
`even`, `odd`, `isnan` and date conversions also retain their internal
collection mapping and query overloads despite declaring whole-value ranks.

Special forms (constructors, indexing, `reduce`, `scan`, `outer`, `take`,
`drop`, and other syntax below) keep their own application rules. Calls
with three or more operands receive whole values; generalized intrinsic
lifting for those arities is outside the unary/binary rank dispatcher.
Sources are evaluated once per call. Implicit lifting introduces no extra
I/O, mutation or random draws. User functions take whole operands unless
they declare ranks; bound pipelines preserve their constituent defaults.

Ranked array results contribute trailing axes. Tuples remain single array
elements, for builtins and user functions alike: batched `eigh` returns
an array of tuples. Empty frames retain known result-cell axes and check
declared cell-shape constraints without evaluating nonexistent cells.

## Shape contracts

The catalogue stores structured cell signatures in `Operation.shape`, with
one entry per described operand count. Runtime empty-frame handling and
static analysis use the same signature instantiator.

| Notation in the catalogue | Meaning |
| --- | --- |
| `[]` | Scalar shape. |
| `['d']` | One axis whose length is named `d`. Repeated names must agree. |
| `['n', 'n']` | Square matrix cell. |
| `[{ spread: 's' }]` | A whole shape, possibly empty. Fixed axes may surround it. |
| `[{ add: ['m', 'n'] }]` | One axis of length `m + n`. |
| `[null]` in a result | A shape-determined axis whose length is not expressed by the contract. |
| `[{ exists: 'k' }]` | An axis whose length depends on values and may differ between cells (Σ). |
| `null` argument pattern | Any input shape. |
| `null` result pattern | The result rank also needs value information. |

`sort` declares `{ args: [['d']], result: ['d'] }`; `unique` declares
`{ args: [['d']], result: [{ exists: 'k' }] }`. `sum` takes the whole input and
declares `{ args: [null], result: [] }`. These are metadata literals,
not Rank source syntax.

`diag` uses the shared `diagonalResultShape` transfer for vector/matrix
overloads and configured offsets; its declarative result is left unknown.
`matmul` also shares a shape transfer for its default tensor contraction.
Binary array-result calls retain their known cell axes under empty frames.

Explicit cell ranks still control lifting. The analyzer splits off frames,
instantiates the cell signature, and combines the result with those frames.
Element types, collection kinds and callback-safety proofs remain separate.
Known target values still determine the shape of `reshape`.

Each pattern supports one shape spread. Dimension expressions support
natural-number literals, variables and addition. Instantiation resolves
direct bindings and sums with one unknown variable; it does not solve
general systems of equations. Catalogue tests check the signatures against
the explicit ranks. Legacy shape flags have been removed; native cell ranks
are read from the catalogue rather than repeated in runtime modules.

A declared builtin contract avoids evaluating a zero-filled prototype for
an empty frame. Unknown result dimensions become zero at runtime and remain
unknown in analysis. If the result rank is unknown, no cell axes are added.
Only pure builtins without a contract use a bounded prototype call. Text and
sequence results retain their existing boxed-cell behavior under lifting.

See the [migration audit](../design/builtin-shape-contracts.md) for coverage,
accepted differences from the original proposal and remaining work.

## algo

Algorithmic collections, range structures and combinatorial generators.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Seen add Value` | collection, mutates | binary all / all | Adds a value to a set, counter or multiset. |
| `Bag ceiling Limit` | element | binary all / 0 | Smallest stored value at least the limit. |
| `Values Count combinations` | sequence, lazy | binary all / all | Lazy sequence of the combinations of that size, in input order. |
| `Heap Priority Value enqueue` | collection, mutates | 3 operands: whole | Inserts a payload into a heap under a separate priority. |
| `Size fenwick` | fenwick | unary all | Fixed-size integer Fenwick tree with inclusive prefix sums. |
| `Tree Target firstatleast` | integer | binary all / 0 | First position whose monotone prefix aggregate reaches the target. |
| `Bag floor Limit` | element | binary all / 0 | Largest stored value at most the limit. |
| `Bag lowerbound Value` | element | binary all / 0 | Smallest stored value at least the query, an alias for ceiling. |
| `Values segment maxsum` | record | special form | Prefix and subarray sum profile: query returns sum, prefix, suffix and best. |
| `Data Bounds missing` | integer | binary all / 1 | Smallest subset sum a wavelet position range cannot make. |
| `Values Count multicomb` | sequence, lazy | binary all / all | Lazy sequence of the combinations of that size with repetition. |
| `Values multiset` | collection | unary all | Ordered multiset holding every value, duplicates kept. |
| `Q peek` | element | unary all | Next value of a queue, stack, deque or heap, left in place. |
| `Ends peekback` | element | unary all | Last value of a deque, left in place. |
| `Ends peekfront` | element | unary all | First value of a deque, left in place. |
| `Values permutations` | sequence, lazy | unary 1 | Lazy sequence of every ordering of the values. |
| `Q pop` | element, mutates | unary all | Removes and returns the next value of a queue, stack, deque or heap. |
| `Ends popback` | element, mutates | unary all | Removes and returns the last value of a deque. |
| `Ends popfront` | element, mutates | unary all | Removes and returns the first value of a deque. |
| `Q push Value` | collection, mutates | binary all / all | Appends a value to a queue, stack, deque or heap, which orders it by priority. |
| `Ends Value pushback` | collection, mutates | binary all / all | Appends a value to the back of a deque. |
| `Ends Value pushfront` | collection, mutates | binary all / all | Adds a value to the front of a deque. |
| `Tree Left Right query` | element | 3 operands: whole | Reduces an inclusive segment-tree range in left-to-right order. |
| `Bag remove Value` | collection, mutates | binary all / all | Removes one occurrence from a set, counter or multiset. |
| `Values segment Operation` | segment | special form | Segment tree over one associative binary operation. |
| `Data Left Right Low High sumwithin` | number | 5 operands: whole | Sums wavelet values inside inclusive position and value ranges. |
| `Bag upperbound Value` | element | binary all / 0 | Smallest stored value greater than the query. |
| `Values wavelet` | structure | unary all | Immutable wavelet matrix for range counts and sums. |
| `Data Left Right Low High within` | integer | 5 operands: whole | Counts wavelet values inside inclusive position and value ranges. |

These need `use algo` but have no name to look up.

| Form | Summary |
| --- | --- |
| `new queue` | Empty container: queue, stack, deque, heap, set, counter, multiset or index. |
| `new heap Priorities Values .descending` | Builds a heap from parallel priority and value arrays; descending pops the largest priority first. |
| `Q push Value` | Receiver-first mutation on a container. |
| `Seen add Value` | Adds a value to a set, counter or multiset. |

## bits

Bitwise operations over arbitrary-precision integers.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `A B band` | integer | binary 0 / 0 | Bitwise and. |
| `Value binary` | text | unary 0; binary all / all | Formats a nonnegative integer as binary text, a width padding with zeroes. |
| `Value Position bit` | boolean | binary 0 / 0 | Tests a zero-based bit position. |
| `Value bnot` | integer | unary 0 | Bitwise not in infinite two-complement form, so the result is -Value - 1. |
| `A B bor` | integer | binary 0 / 0 | Bitwise or. |
| `A B bxor` | integer | binary 0 / 0 | Bitwise exclusive or. |
| `Value popcount` | integer | unary 0 | Number of set bits in a nonnegative integer. |
| `Value Count shl` | integer | binary 0 / 0 | Shifts left by a nonnegative bit count. |
| `Value Count shr` | integer | binary 0 / 0 | Arithmetic shift right by a nonnegative bit count. |

## cli

Command-line arguments, flags and options.

These need `use cli` but have no name to look up.

| Form | Summary |
| --- | --- |
| `option Name Type = Default` | Declares a named command-line input. |
| `argument Name Type` | Declares a positional command-line input. |
| `flag Name` | Declares a boolean command-line flag. |
| `args Values` | Sets arguments for the next run. |

## core

Always available: conversions, ranges, length, sums and extrema. No use required.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Left Right max` | number | unary all; binary 0 / 0 | Larger of two numbers, or the largest of one collection. |
| `Left Right min` | number | unary all; binary 0 / 0 | Smaller of two numbers, or the smallest of one collection. |
| `Values sum` | number | unary all | Adds every numeric cell of an array, collection or finite sequence. |
| `Mask choose TrueValues FalseValues` | value, lazy | binary all / all; 3 operands: whole | Selects each cell by a boolean mask; SQLite expressions become CASE. |
| `Value len` | integer | unary all | Code points of text, leading axis of an array, or size of a collection. |
| `Values present` | boolean | unary all | Mask of the cells that have a value: false for `.NA` and for cells that read as `.Missing`. |
| `Value bytes` | bytes | unary all | Converts UTF-8 text or a rank-1 array of integers in 0..255 to compact bytes. |
| `Value integer` | integer | unary 1 | Truncates a finite real toward zero, preserves an integer, or parses signed decimal integer text. |
| `Value real` | real | unary 1 | Converts an integer or decimal text to a real, or preserves a real. |
| `Value text` | text | unary all | Formats one scalar as text; a .Nf literal after it selects fixed decimals. |

These constructs are always available.

| Form | Summary |
| --- | --- |
| `Values mod N` | Floored remainder; with equal 0 it tests divisibility, elementwise on arrays. Written mod= to update in place. |
| `Left Right max` | The larger of two numbers; min gives the smaller. |
| `Low to High` | Counting range with an inclusive upper bound; after values, keeps those at most High. |
| `Low till High` | Counting range with an exclusive upper bound; after values, keeps those below High. |
| `Index choose Choices` | Selects each cell from the choice its integer index names; choices are leading cells. |
| `Values max .index` | Position of the first largest value; min .index gives the smallest, .indexed a value and position pair. |

## crypto

Hashes and related byte operations.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Value md5` | bytes | unary all | MD5 digest of bytes or UTF-8 text, as 16 bytes. |

## dates

Calendar dates and local date-times.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Text date` | date | unary all | Parses YYYY-MM-DD or truncates a datetime to its calendar day. |
| `Db Start End calendar` | table, lazy | binary all / all; 3 operands: whole | Inclusive daily table; optional database keeps it as a SQLite view. |
| `Value datetime` | datetime | unary all | Parses a local timestamp or casts a date to midnight. |
| `Seconds duration` | duration, lazy | unary all | Creates an exact duration from integer seconds. |
| `Value day` | integer | unary 0 | Day of the month of a date or datetime. |
| `Moment hour` | integer | unary 0 | Hour of a datetime. |
| `Moment minute` | integer | unary 0 | Minute of a datetime. |
| `Value month` | integer | unary 0 | Month of a date or datetime. |
| `Value monthstart` | datetime, lazy | unary all | Midnight on the first day of the current month. |
| `Value nextmonth` | datetime, lazy | unary all | Midnight on the first day of the following month. |
| `Moment second` | integer | unary 0 | Second of a datetime. |
| `Duration seconds` | integer | unary 0 | Exact signed number of seconds in a duration. |
| `Value weekday` | integer | unary 0 | Day of the week, Monday zero through Sunday six. |
| `Value year` | integer | unary 0 | Year of a date or datetime. |

## graph

Graphs, disjoint sets, rooted trees and their algorithms.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Rooted Vertex K ancestor` | element | 3 operands: whole | Vertex K parent edges above another in a rooted tree. |
| `Graph Start bellmanford` | record | binary all / all | Shortest distances allowing negative weights, plus reachable negative cycles. |
| `Graph Start bfs` | record | binary all / all | Breadth-first search returning distance, parent and discovery order. |
| `Graph bipartite` | record | unary all | Two-colouring of an undirected graph, or possible false for an odd cycle. |
| `Graph components` | record | unary all | Connected components: their count, a per-vertex index and the roots. |
| `Dsu A B connected` | boolean | 3 operands: whole | True when two values share a disjoint-set representative. |
| `Graph cycle` | array | unary all | One cycle with its first vertex repeated at the end, or an empty array. |
| `Graph Start dfs` | record | binary all / all | Depth-first search returning distance, parent and discovery order. |
| `Graph Start dijkstra` | record | binary all / all | Shortest distances for nonnegative numeric weights. |
| `Rooted A B distance` | integer | 3 operands: whole | Edges between two vertices of a rooted tree or functional graph. |
| `Graph Start euler` | array | binary all / all | Euler trail using every edge once, or an empty array when none exists. |
| `Dsu Value findroot` | element | binary all / 0 | Representative of the disjoint-set component holding a value. |
| `Graph floyd` | record | unary all | All-pairs shortest distances addressed Distance From To. |
| `Next functional` | functional | unary all | Successor structure prepared for jump, distance and path queries. |
| `F Start Steps jump` | integer | 3 operands: whole | Vertex reached after exactly that many successor steps. |
| `Rooted A B lca` | element | 3 operands: whole | Lowest common ancestor of two vertices. |
| `F lengths` | array | unary all | Path length from every vertex of a functional graph. |
| `Graph Source Sink maxflow` | record | 3 operands: whole | Maximum flow value, the per-edge flow and the minimum cut. |
| `Graph mst` | record | unary all | Minimum spanning forest: connectivity, component count, weight and edges. |
| `Tree pathlengths` | sequence, lazy | unary all | Lazy sequence of every unordered pair distance in a tree. |
| `Tree Root root` | record | binary all / all | Immutable rooted view of a connected undirected tree. |
| `Graph scc` | record | unary all | Strongly connected components of a directed graph. |
| `Graph topological` | record | unary all | Topological order of a directed graph, or possible false. |
| `F Start Limit upto` | value | 3 operands: whole | Counts path vertices through a limit; weighted paths return count, sum and last. |
| `Next Cost weighted` | functional | binary all / all | Functional graph carrying numeric edge costs along its paths. |

These need `use graph` but have no name to look up.

| Form | Summary |
| --- | --- |
| `new graph Nodes .undirected` | Closed graph over a finite vertex domain; direction is always explicit. |
| `new graph .directed` | Open graph that registers endpoints as edges arrive. |
| `new dsu` | Disjoint-set structure, open when no collection is given. |
| `Dsu merge A B` | Unions two disjoint-set components and returns whether they differed; Dsu A B merge also works. |
| `Graph add From To` | Adds an edge, a weighted edge, or a bulk M by 2 or M by 3 array. |
| `Graph edges Vertex` | Lazy outgoing entries of a vertex as array Next Cost pairs. |

## grids

Neighbors and straight segments of dense rank-2 arrays.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Grid Row Column .eight neighbors` | array | 3 operands: whole; 4 operands: whole | In-bounds row and column pairs around one grid cell; four neighbors by default. |
| `Grid Width segments` | array | binary all / all | All in-bounds horizontal, vertical and diagonal segments of a fixed width. |

## images

Image directories decoded into tensors.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Directory images` | table, io | unary all | Table of the JPEG and PNG files in a directory, with name and path. |
| `Images Height Width resize` | array, lazy, io | 3 operands: whole | Decodes every image and stretches it into a lazy RGB tensor. |

## io

Standard input, whole-file text and stateful file handles.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Text Path append` | text, io | binary all / all | Appends UTF-8 text to a file, creating it when missing. |
| `File close` | file, io | unary all | Closes a file early; closing an already closed file does nothing. |
| `File eof` | boolean, io | unary all | True when the position is at or past the end of the file. |
| `File flush` | file, io | unary all | Asks the host to write buffered output to the file system. |
| `Path open` | file, io | unary all; binary all / all | Opens a file, read-only unless a mode label selects write, update or append. |
| `File position` | integer, io | unary all | Current byte offset of an open file. |
| `Value print` | same, io | unary all | Writes one line and returns the value, so a pipeline continues. |
| `Path read` | text, io | unary all | Complete decoded UTF-8 text of a file, final line ending included. |
| `Path Offset Count readbytes` | bytes, io | binary all / all; 3 operands: whole | Reads a block of bytes by offset, or the next Count bytes of an open file. |
| `Path readlines` | array, io | unary all | Lines of a file with their separators removed. |
| `File Offset seek` | file, io | binary all / all | Sets an absolute byte offset from the beginning. |
| `File size` | integer, io | unary all | Length of an open file in bytes. |
| `Text Path write` | text, io | binary all / all | Creates or replaces a file with UTF-8 text. |
| `File Bytes writebytes` | file, io | binary all / all | Writes a bytes value to an open file. |

These need `use io` but have no name to look up.

| Form | Summary |
| --- | --- |
| `stdin .integer` | Reads one token of standard input; a count makes it a lazy sequence. |

## json

JSON decoding into values or a flat table of nodes.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Text json` | value | unary all; binary all / all | Decodes a complete JSON document into Rank values. |

These need `use json` but have no name to look up.

| Form | Summary |
| --- | --- |
| `Text json .flat` | Rank-1 table of nodes in document order: .depth .parent .kind .name .value. |

## linalg

Matrix products, solvers and decompositions.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Matrix det` | number | unary 2 | Determinant of a square numeric matrix, exact for integers. |
| `Values diag [.anti] [Offset]` | array | unary 2 | Construct or extract a diagonal, with optional .anti mode and integer offset. |
| `Matrix eigh` | tuple | unary 2 | Ascending eigenvalues and their eigenvector columns of a symmetric matrix. |
| `Matrix inverse` | array, lazy | unary 2 | Inverse of a square matrix, one trailing cell at a time. |
| `A B matmul` | array, lazy | binary all / all | Contracts the last axis of the left array with the first axis of the right. |
| `A B solve` | array | binary all / all | Solves A * X = B for a square coefficient matrix. |

## numbers

Arithmetic, roots, logarithms, trigonometry and number theory.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Value abs` | number | unary 0 | Absolute value, keeping the integer or real type. |
| `Value acos` | real | unary all (scalar map) | Inverse cosine in radians, for values from -1 through 1. |
| `Value acosh` | real | unary all (scalar map) | Inverse hyperbolic cosine, for values at least 1. |
| `Value asin` | real | unary all (scalar map) | Inverse sine in radians, for values from -1 through 1. |
| `Value asinh` | real | unary all (scalar map) | Inverse hyperbolic sine. |
| `Value atan` | real | unary all (scalar map) | Inverse tangent in radians. |
| `Y X atan2` | real | binary 0 / 0 | Angle in radians from the coordinates, keeping the quadrant. |
| `Value atanh` | real | unary all (scalar map) | Inverse hyperbolic tangent, for values strictly between -1 and 1. |
| `N K binomial` | integer | binary 0 / 0 | Exact binomial coefficient. |
| `N K Modulus binomialmod` | integer | 3 operands: whole | Binomial coefficient calculated directly modulo a prime. |
| `Angle cos` | real | unary all (scalar map) | Cosine of an angle in radians. |
| `Value cosh` | real | unary all (scalar map) | Hyperbolic cosine. |
| `N divisors` | sequence, lazy | unary all | Lazy ascending sequence of the positive divisors. |
| `Value even` | boolean | unary all | True for an even integer. |
| `Value exp` | real | unary all (scalar map) | Natural exponential. |
| `N factors` | sequence, lazy | unary all | Lazy ascending sequence of the prime factors, repeated factors included. |
| `A B gcd` | integer | binary 0 / 0 | Greatest common divisor, always nonnegative. |
| `infinity` | real | source/value | The positive infinite real value. |
| `Value isnan` | boolean | unary all | True for the real value nan; it does not equal itself. |
| `Value isqrt` | integer | unary 0 | Exact integer floor of the square root, calculated without reals. |
| `A B lcm` | integer | unary all; binary 0 / 0 | Least common multiple, also a reduction over one finite collection. |
| `Value log` | real | unary all (scalar map) | Natural logarithm of a positive finite number. |
| `nan` | real | source/value | The real not-a-number value, for a result or cell with no numeric value. |
| `Value odd` | boolean | unary all | True for an odd integer. |
| `Base Exponent Modulus powmod` | integer | 3 operands: whole | Modular exponentiation by repeated squaring, never building the full power. |
| `Value Places round` | number | binary 0 / 0 | Rounds to a signed number of decimal places, halfway values to even. |
| `Angle sin` | real | unary all (scalar map) | Sine of an angle in radians. |
| `Value sinh` | real | unary all (scalar map) | Hyperbolic sine. |
| `Value sqrt` | real | unary 0 | Real square root of a nonnegative number. |
| `Angle tan` | real | unary all (scalar map) | Tangent of an angle in radians. |
| `Value tanh` | real | unary all (scalar map) | Hyperbolic tangent. |

## random

Seeded pseudorandom sampling.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Values Count choices` | array, random | binary all / all | Draws Count values with replacement, complete cells for a tensor. |
| `Seed seed` | integer, random | unary all | Restarts the pseudorandom stream of the session and returns the seed. |
| `Values shuffle` | array, random | unary all; binary all / all | New array in random order; a seed makes the order repeatable. |
| `Shape Low High uniform` | array, random | 3 operands: whole | Real tensor drawn from the half-open interval between the bounds. |

## sequences

Shapes, orderings, windows and lazy sources.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Mask all` | boolean | unary all | True when every boolean cell is true; empty collections are true. |
| `Mask any` | boolean | unary all | True when one boolean cell is true; empty collections are false. |
| `Values argsort .descending` | array | unary 1; binary all / all | Stable zero-based positions that put the values in order. |
| `Values copy` | array | unary all | Independent dense copy of an array or finite sequence; equally shaped array or sequence items stack. |
| `Mask count` | integer | unary all | Number of true cells, or of source items a lazy mask selects. |
| `Values Target find` | integer | binary all / 0 | First zero-based position equal to Target in a vector or text; an array of targets finds each. |
| `Values Target findall` | array | binary all / 0 | Every zero-based position equal to Target in a vector or text; an array of targets needs equal counts. |
| `Values flat` | array | unary all; binary all / all | Copies records into fixed-width storage; Count State flat initializes a compact array. |
| `fibonacci` | sequence, lazy | source/value | Unbounded lazy Fibonacci numbers; bound with to, till, from or after. |
| `Mask indices` | array | unary all | Zero-based positions of the true values in a boolean vector. |
| `Values reverse` | value | unary all | Reverses text by code point, an array along its leading axis, or a queue or finite sequence into an array. |
| `Values first` | element | unary all | First item of text, an array, a queue or a sequence; missing when empty. |
| `Values last` | element | unary all | Last item of text, an array, a queue or a finite sequence; missing when empty. |
| `primes` | sequence, lazy | source/value | Unbounded ascending primes, with planned membership and positional seeking. |
| `Values reshape Dims... | Values reshape unpack Shape` | array | special form | Dense array in row-major order; unpack a shape vector or matrix of shape rows when needed. |
| `Value shape` | array | unary all | Axis lengths as a rank-1 array. |
| `Streams merge .descending` | sequence, lazy | unary all; binary all / all | Lazily merges sorted streams or matrix rows, ascending by default. |
| `Values sort .descending` | array | unary 1; binary all / all | Stable sort into a new rank-1 array, ascending by default. |
| `Matrix transpose` | array | unary all | Reverses the axes of an array. |
| `Values unique` | array | unary 1 | Distinct values in first-appearance order. |
| `Values window Width` | array, lazy | binary all / all | Overlapping complete cells of that size, with optional stride, padding and padding value. |
| `Values Count shift` | array, lazy | binary all / all | Moves items along an axis, keeping the shape; vacated positions read zero or a with value. |

These need `use sequences` but have no name to look up.

| Form | Summary |
| --- | --- |
| `stack A B ... axis N` | Lazily inserts an axis (default 0) between equally shaped arrays or exact-size sequences. |
| `concat A B ... axis N` | Lazily joins arrays along an existing axis (default 0); rank-one sequences remain sequences. |
| `Values sort by .field` | Stable sort by record fields or by one key function. |
| `Values argsort by .field` | Source positions of that same order. |
| `Values sort .descending` | Sorts in descending order; argsort and per-key sort directions preserve ties. |
| `Streams merge by .field` | Merges sorted records lazily by one field or unary key function; A B merge by Key also works. |
| `Values sort .indexes` | Positions that order the values, as argsort does; .indexed gives the sorted values and positions as a pair. |

## stats

Averages, spread, error metrics and covariance.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Features correlation` | array, lazy | unary all | Pearson correlation matrix over feature and observation axes. |
| `Features corr` | array, lazy | unary all | Alias for correlation. |
| `Features covariance` | array, lazy | unary all | Sample covariance matrix over feature and observation axes. |
| `Pred Target mae` | real | binary all / all | Mean absolute error between two broadcast numeric values. |
| `Values mean` | real | unary all | Arithmetic mean, missing table cells skipped. |
| `Values median` | real | unary all | Middle value of a sorted copy, averaging the two middle values when even. |
| `Values mode` | value | unary all | Most frequent value in a collection or array. |
| `Pred Target mse` | real | binary all / all | Mean squared error between two broadcast numeric values. |
| `Values P percentile` | value | unary all; binary 1 / 0 | Percentile P in 0..100. |
| `Values Q quantile` | value | unary all; binary 1 / 0 | Linear interpolation quantile Q in 0..1. |
| `Values skew` | real | unary all | Alias for skewness. |
| `Values skewness` | real | unary all | Sample skewness of numeric values. |
| `Values std` | real | unary all | Population standard deviation, dividing by N. |
| `Values var` | real | unary all | Alias for variance. |
| `Values variance` | real | unary all | Population variance of numeric values. |

## tables

CSV, SQLite, grouping and joins.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Path csv` | table, io | unary all; binary all / all | Reads a CSV file into a rank-1 table, or writes a table to a path. |
| `Query explain` | table, io | unary all | SQLite query plan rows for a prepared query view. |
| `Table labels` | array | unary all | Ordered column labels of a rank-1 table. |
| `Rows table` | table | unary all | Builds a column table from a rank-1 array of objects. |
| `Ids Keys Values lookup` | value, lazy | 3 operands: whole | First keyed match; SQLite expressions become a correlated subquery. |
| `Query sql` | record | unary all | Statement text and bound parameters of a query view. |
| `Path sqlite` | database, io | unary all | Opens an existing SQLite database; reads are lazy, writes explicit. |
| `Db Text Parameters sqlquery` | table, io | 3 operands: whole | Read-only SELECT view with bound positional parameters. |

These need `use tables` but have no name to look up.

| Form | Summary |
| --- | --- |
| `Rows group by .field` | Grouped view summarized by a named select block. |
| `Rows rollup by .first .second` | Grouped view with detail rows, prefix subtotals and a grand total. |
| `Rows Width rolling by .date` | One trailing row window per ordered row, summarized by select. |
| `Edges Starts reach by .source .target` | Reachable endpoint pairs from one or more starts; SQLite stays lazy. |
| `Rows filter .field greater Limit` | Filters a table with implicit input columns; condition lines in a block use AND. |
| `Rows select .first .second` | Selects named columns into a rank-1 table, including a single column. |
| `Rows select ... end` | Computes named columns with block-local calculations and an implicit input table. |
| `Rows select Cols` | Selects columns from an ordered record of expressions. |
| `Left Right leftjoin by .id` | Join on shared fields after by, or on field pairs after on. |
| `Db .members alias .m` | Name one side of a join so matching column names remain distinct. |
| `Table .column` | Projects one column of a table. |

## testing

Test blocks.

These need `use testing` but have no name to look up.

| Form | Summary |
| --- | --- |
| `test "name" ... end` | A test block the runner collects. |

## text

Splitting, formatting, parsing and code points.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Code character` | text | unary all | One-character text for a Unicode code point. |
| `Character codepoint` | integer | unary all | Integer code point of exactly one character. |
| `Bytes hex` | text | unary all | Lowercase hexadecimal text for bytes, without a prefix. |
| `Values Separator join` | text | binary 1 / 0 | Joins scalar elements of a finite collection into one text; a matrix joins each row. |
| `Text Pattern parse` | value | binary all / all | Captures /integer, /real, /word and /text from a complete pattern match. |
| `Text Separator split` | array | binary all / all | Splits at every exact occurrence of a separator, keeping empty parts. |
| `Value Prefix startswith` | boolean | binary all / all | Exact text or byte prefix test; ordinary arrays broadcast elementwise. |
| `Text lower` | text | unary all | Converts Unicode text to lowercase. |
| `Text Width Fill lpad` | text | 3 operands: whole | Pads text on the left without truncating longer values. |
| `Text Chars Replacement translate` | text | 3 operands: whole | Replaces listed characters, deleting those with no replacement. |
| `Texts Limit vocab` | array | binary all / all | Most frequent words, at most Limit of them, ties by code point. |
| `Text words` | array | unary all | Lowercase Unicode letter and number runs. |

## xml

XML decoding into a tree or a flat table of nodes.

| Form | Result | Default cells | Summary |
| --- | --- | --- | --- |
| `Text xml` | value | unary all; binary all / all | Decodes a complete XML document into a tree of element nodes. |

These need `use xml` but have no name to look up.

| Form | Summary |
| --- | --- |
| `Text xml .flat` | Rank-1 table of nodes in document order, with .attributes for elements. |
