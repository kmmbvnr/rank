# Standard library reference

Core vocabulary and standard modules, including constructs without a
function name. Rank is data-first, so an operation
follows the data it reads: `Values sum`, `Text Separator split`.

This page is generated from `packages/language/src/operations.ts` by
`rank ops --markdown`, and `npm test` fails when the two disagree. Edit the
catalogue, not this file. For what each module means and how its operations
behave at the edges, read [the standard library](modules.md).

## algo

Algorithmic collections, range structures and combinatorial generators.

| Form | Result | Summary |
| --- | --- | --- |
| `Seen add Value` | collection, mutates | Adds a value to a set, counter or multiset. |
| `Bag ceiling Limit` | element | Smallest stored value at least the limit. |
| `Values Count combinations` | sequence, lazy | Lazy sequence of the combinations of that size, in input order. |
| `Heap Priority Value enqueue` | collection, mutates | Inserts a payload into a heap under a separate priority. |
| `Size fenwick` | structure | Fixed-size integer Fenwick tree with inclusive prefix sums. |
| `Tree Target firstatleast` | integer | First position whose monotone prefix aggregate reaches the target. |
| `Bag floor Limit` | element | Largest stored value at most the limit. |
| `Bag lowerbound Value` | element | Smallest stored value at least the query, an alias for ceiling. |
| `Values maxsum segment` | record | Prefix and subarray sum profile: query returns sum, prefix, suffix and best. |
| `Data Bounds missing` | integer | Smallest subset sum a wavelet position range cannot make. |
| `Values Count multicomb` | sequence, lazy | Lazy sequence of the combinations of that size with repetition. |
| `Values multiset` | collection | Ordered multiset holding every value, duplicates kept. |
| `Q peek` | element | Next value of a queue, stack, deque or heap, left in place. |
| `Ends peekback` | element | Last value of a deque, left in place. |
| `Ends peekfront` | element | First value of a deque, left in place. |
| `Values permutations` | sequence, lazy | Lazy sequence of every ordering of the values. |
| `Q pop` | element, mutates | Removes and returns the next value of a queue, stack, deque or heap. |
| `Ends popback` | element, mutates | Removes and returns the last value of a deque. |
| `Ends popfront` | element, mutates | Removes and returns the first value of a deque. |
| `Q push Value` | collection, mutates | Appends a value to a queue, stack, deque or heap, which orders it by priority. |
| `Ends Value pushback` | collection, mutates | Appends a value to the back of a deque. |
| `Ends Value pushfront` | collection, mutates | Adds a value to the front of a deque. |
| `Tree Left Right query` | element | Reduces an inclusive segment-tree range in left-to-right order. |
| `Bag remove Value` | collection, mutates | Removes one occurrence from a set, counter or multiset. |
| `Values Operation segment` | structure | Segment tree over one associative binary operation. |
| `Data Left Right Low High sumwithin` | number | Sums wavelet values inside inclusive position and value ranges. |
| `Bag upperbound Value` | element | Smallest stored value greater than the query. |
| `Values wavelet` | structure | Immutable wavelet matrix for range counts and sums. |
| `Data Left Right Low High within` | integer | Counts wavelet values inside inclusive position and value ranges. |

These need `use algo` but have no name to look up.

| Form | Summary |
| --- | --- |
| `new queue` | Empty container: queue, stack, deque, heap, set, counter, multiset or index. |
| `Q push Value` | Receiver-first mutation on a container. |
| `Seen add Value` | Adds a value to a set, counter or multiset. |

## bits

Bitwise operations over arbitrary-precision integers.

| Form | Result | Summary |
| --- | --- | --- |
| `A B band` | integer | Bitwise and. |
| `Value binary` | text | Formats a nonnegative integer as binary text, a width padding with zeroes. |
| `Value Position bit` | boolean | Tests a zero-based bit position. |
| `Value bnot` | integer | Bitwise not in infinite two-complement form, so the result is -Value - 1. |
| `A B bor` | integer | Bitwise or. |
| `A B bxor` | integer | Bitwise exclusive or. |
| `Value popcount` | integer | Number of set bits in a nonnegative integer. |
| `Value Count shl` | integer | Shifts left by a nonnegative bit count. |
| `Value Count shr` | integer | Arithmetic shift right by a nonnegative bit count. |

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

| Form | Result | Summary |
| --- | --- | --- |
| `Left Right max` | number | Larger of two numbers, or the largest of one collection. |
| `Left Right min` | number | Smaller of two numbers, or the smallest of one collection. |
| `Values sum` | number | Adds every numeric cell of an array, collection or finite sequence. |
| `Value len` | integer | Code points of text, leading axis of an array, or size of a collection. |
| `Value bytes` | bytes | Converts UTF-8 text or a rank-1 array of integers in 0..255 to compact bytes. |
| `Value integer` | integer | Truncates a finite real toward zero, preserves an integer, or parses signed decimal integer text. |
| `Value real` | real | Converts an integer or decimal text to a real, or preserves a real. |
| `Value text` | text | Formats one scalar as text; a .Nf literal after it selects fixed decimals. |

These constructs are always available.

| Form | Summary |
| --- | --- |
| `Left Right max` | The larger of two numbers; min gives the smaller. |
| `Low to High` | Counting range with an inclusive upper bound. |
| `Low until High` | Counting range with an exclusive upper bound. |

## crypto

Hashes and related byte operations.

| Form | Result | Summary |
| --- | --- | --- |
| `Value md5` | bytes | MD5 digest of bytes or UTF-8 text, as 16 bytes. |

## dates

Calendar dates and local date-times.

| Form | Result | Summary |
| --- | --- | --- |
| `Text date` | date | Parses YYYY-MM-DD or truncates a datetime to its calendar day. |
| `Db Start End calendar` | table, lazy | Inclusive daily table; optional database keeps it as a SQLite view. |
| `Value datetime` | datetime | Parses a local timestamp or casts a date to midnight. |
| `Seconds duration` | duration, lazy | Creates an exact duration from integer seconds. |
| `Value day` | integer | Day of the month of a date or datetime. |
| `Moment hour` | integer | Hour of a datetime. |
| `Moment minute` | integer | Minute of a datetime. |
| `Value month` | integer | Month of a date or datetime. |
| `Value monthstart` | datetime, lazy | Midnight on the first day of the current month. |
| `Value nextmonth` | datetime, lazy | Midnight on the first day of the following month. |
| `Moment second` | integer | Second of a datetime. |
| `Duration seconds` | integer | Exact signed number of seconds in a duration. |
| `Value weekday` | integer | Day of the week, Monday zero through Sunday six. |
| `Value year` | integer | Year of a date or datetime. |

## graph

Graphs, disjoint sets, rooted trees and their algorithms.

| Form | Result | Summary |
| --- | --- | --- |
| `Rooted Vertex K ancestor` | element | Vertex K parent edges above another in a rooted tree. |
| `Graph Start bellmanford` | record | Shortest distances allowing negative weights, plus reachable negative cycles. |
| `Graph Start bfs` | record | Breadth-first search returning distance, parent and discovery order. |
| `Graph bipartite` | record | Two-colouring of an undirected graph, or possible false for an odd cycle. |
| `Graph components` | record | Connected components: their count, a per-vertex index and the roots. |
| `Dsu A B connected` | boolean | True when two values share a disjoint-set representative. |
| `Graph cycle` | array | One cycle with its first vertex repeated at the end, or an empty array. |
| `Graph Start dfs` | record | Depth-first search returning distance, parent and discovery order. |
| `Graph Start dijkstra` | record | Shortest distances for nonnegative numeric weights. |
| `Rooted A B distance` | integer | Edges between two vertices of a rooted tree or functional graph. |
| `Graph Start euler` | array | Euler trail using every edge once, or an empty array when none exists. |
| `Dsu Value find` | element | Representative of the disjoint-set component holding a value. |
| `Graph floyd` | record | All-pairs shortest distances addressed Distance From To. |
| `Next functional` | structure | Successor structure prepared for jump, distance and path queries. |
| `F Start Steps jump` | element | Vertex reached after exactly that many successor steps. |
| `Rooted A B lca` | element | Lowest common ancestor of two vertices. |
| `F lengths` | array | Path length from every vertex of a functional graph. |
| `Graph Source Sink maxflow` | record | Maximum flow value, the per-edge flow and the minimum cut. |
| `Dsu A B merge` | boolean, mutates | Unions two disjoint-set components, true only when they differed. |
| `Graph mst` | record | Minimum spanning forest: connectivity, component count, weight and edges. |
| `Tree pathlengths` | sequence, lazy | Lazy sequence of every unordered pair distance in a tree. |
| `Tree Root root` | structure | Immutable rooted view of a connected undirected tree. |
| `Graph scc` | record | Strongly connected components of a directed graph. |
| `Graph topological` | record | Topological order of a directed graph, or possible false. |
| `F Start Limit upto` | integer | Counts path vertices from a start whose numbers do not exceed a limit. |
| `Next Cost weighted` | structure | Functional graph carrying numeric edge costs along its paths. |

These need `use graph` but have no name to look up.

| Form | Summary |
| --- | --- |
| `new graph Nodes .undirected` | Closed graph over a finite vertex domain; direction is always explicit. |
| `new graph .directed` | Open graph that registers endpoints as edges arrive. |
| `new dsu` | Disjoint-set structure, open when no collection is given. |
| `Graph add From To` | Adds an edge, a weighted edge, or a bulk M by 2 or M by 3 array. |
| `Graph edges Vertex` | Lazy outgoing entries of a vertex as array Next Cost pairs. |

## grids

Neighbors and straight segments of dense rank-2 arrays.

| Form | Result | Summary |
| --- | --- | --- |
| `Grid Row Column .eight neighbors` | array | In-bounds row and column pairs around one grid cell; four neighbors by default. |
| `Grid Width segments` | array | All in-bounds horizontal, vertical and diagonal segments of a fixed width. |

## images

Image directories decoded into tensors.

| Form | Result | Summary |
| --- | --- | --- |
| `Directory images` | table, io | Table of the JPEG and PNG files in a directory, with name and path. |
| `Images Height Width resize` | array, lazy, io | Decodes every image and stretches it into a lazy RGB tensor. |

## io

Standard input, whole-file text and stateful file handles.

| Form | Result | Summary |
| --- | --- | --- |
| `Text Path append` | text, io | Appends UTF-8 text to a file, creating it when missing. |
| `File close` | file, io | Closes a file early; closing an already closed file does nothing. |
| `File eof` | boolean, io | True when the position is at or past the end of the file. |
| `File flush` | file, io | Asks the host to write buffered output to the file system. |
| `Path open` | file, io | Opens a file, read-only unless a mode label selects write, update or append. |
| `File position` | integer, io | Current byte offset of an open file. |
| `Value print` | same, io | Writes one line and returns the value, so a pipeline continues. |
| `Path read` | text, io | Complete decoded UTF-8 text of a file, final line ending included. |
| `Path Offset Count readbytes` | bytes, io | Reads a block of bytes by offset, or the next Count bytes of an open file. |
| `Path readlines` | array, io | Lines of a file with their separators removed. |
| `File Offset seek` | file, io | Sets an absolute byte offset from the beginning. |
| `File size` | integer, io | Length of an open file in bytes. |
| `Text Path write` | text, io | Creates or replaces a file with UTF-8 text. |
| `File Bytes writebytes` | file, io | Writes a bytes value to an open file. |

These need `use io` but have no name to look up.

| Form | Summary |
| --- | --- |
| `stdin .integer` | Reads one token of standard input; a count makes it a lazy sequence. |

## json

JSON decoding into values or a flat table of nodes.

| Form | Result | Summary |
| --- | --- | --- |
| `Text json` | value | Decodes a complete JSON document into Rank values. |

These need `use json` but have no name to look up.

| Form | Summary |
| --- | --- |
| `Text json .flat` | Rank-1 table of nodes in document order: .depth .parent .kind .name .value. |

## linalg

Matrix products, solvers and decompositions.

| Form | Result | Summary |
| --- | --- | --- |
| `Matrix det` | number | Determinant of a square numeric matrix, exact for integers. |
| `Values diag` | array | Diagonal matrix from a vector, or the main diagonal of a matrix. |
| `Matrix eigh` | array | Ascending eigenvalues and their eigenvector columns of a symmetric matrix. |
| `Matrix inverse` | array, lazy | Inverse of a square matrix, one trailing cell at a time. |
| `A B matmul` | array, lazy | Contracts the last axis of the left array with the first axis of the right. |
| `A B solve` | array | Solves A * X = B for a square coefficient matrix. |

## numbers

Arithmetic, roots, logarithms, trigonometry and number theory.

| Form | Result | Summary |
| --- | --- | --- |
| `Value abs` | number | Absolute value, keeping the integer or real type. |
| `Value acos` | real | Inverse cosine in radians, for values from -1 through 1. |
| `Value acosh` | real | Inverse hyperbolic cosine, for values at least 1. |
| `Value asin` | real | Inverse sine in radians, for values from -1 through 1. |
| `Value asinh` | real | Inverse hyperbolic sine. |
| `Value atan` | real | Inverse tangent in radians. |
| `Y X atan2` | real | Angle in radians from the coordinates, keeping the quadrant. |
| `Value atanh` | real | Inverse hyperbolic tangent, for values strictly between -1 and 1. |
| `N K binomial` | integer | Exact binomial coefficient. |
| `N K Modulus binomialmod` | integer | Binomial coefficient calculated directly modulo a prime. |
| `Angle cos` | real | Cosine of an angle in radians. |
| `Value cosh` | real | Hyperbolic cosine. |
| `N divisors` | sequence, lazy | Lazy ascending sequence of the positive divisors. |
| `Value even` | boolean | True for an even integer. |
| `Value exp` | real | Natural exponential. |
| `N factors` | sequence, lazy | Lazy ascending sequence of the prime factors, repeated factors included. |
| `A B gcd` | integer | Greatest common divisor, always nonnegative. |
| `infinity` | real | The positive infinite real value. |
| `Value isqrt` | integer | Exact integer floor of the square root, calculated without reals. |
| `A B lcm` | integer | Least common multiple, also a reduction over one finite collection. |
| `Value log` | real | Natural logarithm of a positive finite number. |
| `Value odd` | boolean | True for an odd integer. |
| `Base Exponent Modulus powmod` | integer | Modular exponentiation by repeated squaring, never building the full power. |
| `Value Places round` | number | Rounds to a signed number of decimal places, halfway values to even. |
| `Angle sin` | real | Sine of an angle in radians. |
| `Value sinh` | real | Hyperbolic sine. |
| `Value sqrt` | real | Real square root of a nonnegative number. |
| `Angle tan` | real | Tangent of an angle in radians. |
| `Value tanh` | real | Hyperbolic tangent. |

These need `use numbers` but have no name to look up.

| Form | Summary |
| --- | --- |
| `Values multiple by N` | Elementwise divisibility test. |

## random

Seeded pseudorandom sampling.

| Form | Result | Summary |
| --- | --- | --- |
| `Values Count choices` | array, random | Draws Count values with replacement, complete cells for a tensor. |
| `Seed seed` | integer, random | Restarts the pseudorandom stream of the session and returns the seed. |
| `Values shuffle` | array, random | New array in random order; a seed makes the order repeatable. |
| `Shape Low High uniform` | array, random | Real tensor drawn from the half-open interval between the bounds. |

## sequences

Shapes, orderings, windows and lazy sources.

| Form | Result | Summary |
| --- | --- | --- |
| `Mask all` | boolean | True when every boolean cell is true; empty collections are true. |
| `Mask any` | boolean | True when one boolean cell is true; empty collections are false. |
| `Values argsort .descending` | array | Stable zero-based positions that put the values in order. |
| `Mask TrueValues FalseValues choose` | value, lazy | Selects each cell by a boolean mask; SQLite expressions become CASE. |
| `Values copy` | array | Independent dense copy of an array or finite sequence; equally shaped array or sequence items stack. |
| `Mask count` | integer | Number of true cells, or of source items a lazy mask selects. |
| `Values Count drop` | value, lazy | Skips Count leading items; sequences stay lazy and arrays slice their leading axis. |
| `Values Target find` | integer | First zero-based position equal to Target in a vector or text. |
| `Values Target findall` | array | Every zero-based position equal to Target in a vector or text. |
| `Values flat` | array | Copies records into fixed-width storage; Count State flat initializes a compact array. |
| `fibonacci` | sequence, lazy | Unbounded lazy Fibonacci numbers; bound with to, until or from. |
| `Mask indices` | array | Zero-based positions of the true values in a boolean vector. |
| `primes` | sequence, lazy | Unbounded ascending primes, with planned membership and positional seeking. |
| `Values Shape reshape` | array | Dense array in row-major order, the element count matching exactly. |
| `Value shape` | array | Axis lengths as a rank-1 array. |
| `Values sort .descending` | array | Stable sort into a new rank-1 array, ascending by default. |
| `Matrix transpose` | array | Reverses the axes of an array. |
| `Values Count take` | value, lazy | Keeps at most Count leading items; sequences stay lazy and arrays slice their leading axis. |
| `Values unique` | array | Distinct values in first-appearance order. |
| `Values Width window` | array, lazy | Overlapping complete cells of that size, with optional stride and padding. |

These need `use sequences` but have no name to look up.

| Form | Summary |
| --- | --- |
| `Values sort by .field` | Stable sort by record fields or by one key function. |
| `Values argsort by .field` | Source positions of that same order. |
| `Index Choices choose` | Selects each cell from the choice its integer index names; choices are leading cells. |
| `Values sort .descending` | Sorts in descending order; argsort and per-key sort directions preserve ties. |

## stats

Averages, spread, error metrics and covariance.

| Form | Result | Summary |
| --- | --- | --- |
| `Features correlation` | array, lazy | Pearson correlation matrix over feature and observation axes. |
| `Features corr` | array, lazy | Alias for correlation. |
| `Features covariance` | array, lazy | Sample covariance matrix over feature and observation axes. |
| `Pred Target mae` | real | Mean absolute error between two broadcast numeric values. |
| `Values mean` | real | Arithmetic mean, missing table cells skipped. |
| `Values median` | real | Middle value of a sorted copy, averaging the two middle values when even. |
| `Values mode` | value | Most frequent value in a collection or array. |
| `Pred Target mse` | real | Mean squared error between two broadcast numeric values. |
| `Values P percentile` | value | Percentile P in 0..100. |
| `Values Q quantile` | value | Linear interpolation quantile Q in 0..1. |
| `Values skew` | real | Alias for skewness. |
| `Values skewness` | real | Sample skewness of numeric values. |
| `Values std` | real | Population standard deviation, dividing by N. |
| `Values var` | real | Alias for variance. |
| `Values variance` | real | Population variance of numeric values. |

## tables

CSV, SQLite, grouping and joins.

| Form | Result | Summary |
| --- | --- | --- |
| `Path csv` | table, io | Reads a CSV file into a rank-1 table, or writes a table to a path. |
| `Query explain` | table, io | SQLite query plan rows for a prepared query view. |
| `Table labels` | array | Ordered column labels of a rank-1 table. |
| `Ids Keys Values lookup` | value, lazy | First keyed match; SQLite expressions become a correlated subquery. |
| `Query sql` | record | Statement text and bound parameters of a query view. |
| `Path sqlite` | database, io | Opens an existing SQLite database; reads are lazy, writes explicit. |
| `Db Text Parameters sqlquery` | table, io | Read-only SELECT view with bound positional parameters. |

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

| Form | Result | Summary |
| --- | --- | --- |
| `Code character` | text | One-character text for a Unicode code point. |
| `Character codepoint` | integer | Integer code point of exactly one character. |
| `Bytes hex` | text | Lowercase hexadecimal text for bytes, without a prefix. |
| `Values Separator join` | text | Joins scalar elements of a finite collection into one text. |
| `Text Pattern parse` | array | Captures /integer, /real, /word and /text from a complete pattern match. |
| `Text reverse` | text | Reverses text by Unicode code point. |
| `Text Separator split` | array | Splits at every exact occurrence of a separator, keeping empty parts. |
| `Value Prefix startswith` | boolean | Exact text or byte prefix test; ordinary arrays broadcast elementwise. |
| `Text lower` | text | Converts Unicode text to lowercase. |
| `Text Width Fill lpad` | text | Pads text on the left without truncating longer values. |
| `Text Chars Replacement translate` | text | Replaces listed characters, deleting those with no replacement. |
| `Texts Limit vocab` | array | Most frequent words, at most Limit of them, ties by code point. |
| `Text words` | array | Lowercase Unicode letter and number runs. |

## xml

XML decoding into a tree or a flat table of nodes.

| Form | Result | Summary |
| --- | --- | --- |
| `Text xml` | value | Decodes a complete XML document into a tree of element nodes. |

These need `use xml` but have no name to look up.

| Form | Summary |
| --- | --- |
| `Text xml .flat` | Rank-1 table of nodes in document order, with .attributes for elements. |
