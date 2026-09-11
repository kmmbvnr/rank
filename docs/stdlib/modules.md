# Standard library

Rank starts with a small core. Vocabulary is introduced through `use` modules.

Current module directions:

```rank
use numbers
use random
use linalg
use bits
use ranges
use graph
use tables
use stats
use text
use crypto
use dates
use io
use ml
use algo
use sequences
```

These names are organizational and may still be consolidated.

Each module owns its vocabulary, semantic handlers, validators and execution
planner rules. Common operations normally fit the stable application grammar
and do not add parser productions. Syntax extensions are combined before parser
construction and are then enabled semantically by the corresponding `use`.

## Numbers

Candidate reusable operations:

```rank
odd
even
abs
sqrt
isqrt
log
exp
round
sin
cos
tan
asin
acos
atan
atan2
sinh
cosh
tanh
asinh
acosh
atanh
gcd
lcm
powmod
binomial
binomialmod
factors
divisors
multiple by
min
max
infinity
```

`multiple by` is an elementwise divisibility test and returns a boolean value
or mask:

```rank
Mask = N multiple by 3
```

It is the readable shortcut for `N % 3 equal 0`.

`abs` has intrinsic rank 0 and returns the absolute value of an `integer` or
`real`, preserving its numeric type:

```rank
Distance = Difference abs
Magnitudes = Values abs
```

Its scalar rank makes the second form elementwise over arrays and lazy over
sequences. Negative infinity becomes positive infinity, and either signed real
zero becomes positive zero. A demanded nonnumeric cell is an error.

`sqrt` has intrinsic rank 0 and returns the real square root of an `integer` or
`real`:

```rank
Root = Value sqrt
Roots = Values sqrt
```

It maps lazily over arrays and sequences. A negative input raises
`.DomainError`; positive infinity remains infinity.

`isqrt` has intrinsic rank 0 and returns the exact integer floor of the square
root of a nonnegative `integer`:

```rank
Root = Value isqrt
Roots = Values isqrt
Perfect = Root ** 2 equal Value
```

It maps lazily over arrays and sequences. A negative integer raises
`.DomainError`, and a `real` raises `.TypeError`. The computation uses only
integer arithmetic, so large values do not lose precision.

`log` has intrinsic rank 0 and returns the natural logarithm as a `real`:

```rank
Natural = Value log
Bits = Value log / (2 log)
```

It maps lazily over arrays and sequences. Its input must be positive and
finite; zero, negative values and infinities raise `.DomainError`.

`exp` has intrinsic rank 0 and returns the natural exponential as a `real`:

```rank
Growth = Rate exp
Weights = Scores exp
```

It maps lazily over arrays and sequences. It accepts every numeric input;
negative infinity produces zero, positive infinity remains infinity, and a
finite input whose result overflows produces positive infinity.

`round` rounds a numeric value to a signed number of decimal places:

```rank
Price = Value round 2
Rounded = Values round 4
Hundreds = Count round -2
```

It applies lazily to scalar cells while preserving an array's shape or a
sequence's order. Halfway values round to the nearest even result, as in
Python and NumPy. An integer remains an integer and a real remains a real.
The places argument must be one scalar safe integer.

The trigonometric family uses radians and returns `real` values:

```rank
Y = Angle sin
X = Angle cos
Slope = Angle tan
Angle = Ratio atan
Angle = Y X atan2
```

The circular functions are `sin`, `cos` and `tan`; their inverse functions are
`asin`, `acos` and `atan`. `atan2` takes the vertical coordinate first and the
horizontal coordinate second, so it preserves quadrant information and handles
a zero horizontal coordinate.

`sinh`, `cosh` and `tanh` provide the hyperbolic functions; `asinh`, `acosh` and
`atanh` provide their inverses. `asin` and `acos` accept values from -1 through
1, `acosh` accepts values at least 1, and `atanh` accepts values strictly
between -1 and 1. An input outside a function's mathematical domain raises
`.DomainError`. `sin`, `cos` and `tan` also reject infinities.

Unary functions have intrinsic rank 0 and map lazily over arrays and
sequences. `atan2` has intrinsic ranks `0 0`. It uses the general trailing-axis
broadcasting rule for arrays, broadcasts a scalar over one array, and zips two
sequences. It can also be supplied to `outer`.

`factors` accepts a positive integer and returns its prime factors as a finite
lazy sequence in ascending order, including repeated factors:

```rank
Factors = 12 factors
rem 2 2 3
```

Factoring zero or a negative integer is an error. Factoring one produces an
empty sequence.

`divisors` accepts a positive integer and returns its positive divisors as a
finite lazy sequence in ascending order:

```rank
Values = 12 divisors
rem 1 2 3 4 6 12
```

The plan recognizes `count`, so the common composition below multiplies the
prime exponents without materializing the divisors:

```rank
Count = N divisors count
```

Zero and negative integers are errors. The divisors of one contain only one.

`gcd` and `lcm` use data-first application:

```rank
G = 54 24 gcd
L = 8 12 lcm
```

`lcm` also acts as a named reduction over a finite sequence:

```rank
Answer = (1 to 20) lcm
```

Both operations return nonnegative integers. `0 0 gcd` is zero, an `lcm`
containing zero is zero, and the `lcm` of an empty sequence is one.

`powmod` raises an integer base to a nonnegative integer exponent while reducing
every step modulo a positive integer:

```rank
Value = Base Exponent Modulus powmod
```

The result is normalized from zero through `Modulus - 1`. The implementation
uses repeated squaring, so it does not construct the potentially huge value
`Base ** Exponent` first.

`binomial` returns the exact binomial coefficient for nonnegative integers
with `0 at most K at most N`:

```rank
Exact = N K binomial
```

It has intrinsic ranks `0 0`, so it broadcasts over numeric arrays.
`binomialmod` has a separate fixed arity and calculates directly modulo a
prime:

```rank
Value = N K Modulus binomialmod
```

The current modular implementation requires `N` to be smaller than the prime
modulus, a safely indexable `N`, and a modulus within 64 bits. It caches and
incrementally extends factorial and inverse-factorial tables for each modulus,
so repeated calls cost `O(MaximumN)` preparation and `O(1)` each afterward.
Invalid coefficient bounds or modulus conditions raise `.DomainError`.

Postfix `min` and `max` reduce one collection. Their direct binary forms are
infix and return the smaller or larger numeric operand:

```rank
Smallest = Values min
Left = A max B
Bound = Low max Limit min High
```

Binary chains associate from the left and broadcast over arrays using the
ordinary trailing-axis rules. Parenthesize a compound right operand, as in
`0 max (Limit - Used)`. A stored operation remains an ordinary function value,
so `Operation = max` may be called as `A B Operation` or passed to `outer`.

`infinity` is the positive infinite `real` value. Unary negation produces
`-infinity`.

## Sequences

`all`, `any` and `count` are named boolean reductions:

```rank
Every = Mask all
Some = Mask any
TrueCount = Mask count
Rows = Flags all axis 1
RowCounts = Flags count axis 1
```

`all` and `any` are equivalent to `and reduce` and `or reduce`, respectively.
`count` returns the integer number of `true` values. All three accept only
boolean cells and support `rank` and `axis`. `all` and `any` short-circuit;
`count` examines the complete cell. Empty collections produce `true`, `false`
and zero, respectively. Known unbounded sequences are rejected.

A lazy sequence mask is also accepted by `count`. It returns the number of
source items selected by the mask and lets the source plan provide a direct
count without enumerating those items.

A finite lazy source may also define a direct cardinality count. For example,
`N divisors count` returns the number of positive divisors without enumerating
them. Other numeric sequences still fail the boolean-cell requirement.

## Random

`use random` provides random permutation operations:

```rank
State = 42 seed
Shuffled = Values shuffle
Repeatable = Values 42 shuffle
Sample = Values 10 choices
Rows = Data shuffle axis 0
Columns = Data 42 shuffle axis 1
```

`Seed seed` reinitializes the current interpreter's pseudorandom stream and
returns the integer seed. Imported functions share that stream, so the setting
applies to their later unseeded random operations as well. Repeating the call
with the same seed restarts the same sequence.

`shuffle` accepts an array or a finite sequence and returns a new eager dense
array. It never changes its source. A sequence is explicitly consumed by the
operation. An unbounded sequence, a scalar or a missing tensor axis is an
error.

`Values Count choices` independently draws `Count` values with replacement
and returns an eager dense array. For a tensor it draws complete cells along
the leading axis, preserving their shape. Count must be nonnegative. Count
zero is valid for an empty input; a positive draw from an empty input is an
error.

The default axis is zero. Selecting another axis reorders its complete slices
with one shared permutation: shuffling matrix columns moves every column as a
unit rather than shuffling each row independently.

Without a seed, `shuffle` consumes the current interpreter's pseudorandom
stream. Supplying an integer seed creates a private stream for that operation,
so equal inputs and equal seeds produce equal results within one interpreter
version without changing the default stream. The precise generator and seeded
order are implementation details and may change between versions. `shuffle`
and `choices` are not cryptographic randomness operations.

## Linear algebra

`use linalg` provides tensor contraction and matrix operations.

`det` has intrinsic rank 2 and returns the determinant of a square numeric
matrix:

```rank
D = A det
BatchDeterminants = Batch det
Planes = T det axis 1 rank 2
```

Integer-only matrices produce exact `integer` results; matrices containing a
`real` produce `real`. A singular matrix returns zero, and the determinant of a
`0` by `0` matrix is one. A non-square matrix raises `.DimensionMismatch`; a
nonnumeric element raises `.TypeError`. Higher-rank inputs use the ordinary
trailing-cell and `axis ... rank 2` rules.

`solve` directly solves `A * X = B`:

```rank
X = A B solve
```

`A` must be a square rank-2 numeric matrix. `B` may be a length-`N` vector
or an `N K` matrix, and the eager real result has the same shape as `B`.
Shape errors raise `.DimensionMismatch`, singular coefficients raise
`.SingularMatrix`, and nonnumeric elements raise `.TypeError`. The equation
is the semantic contract; implementations may select an equivalent algorithm
from known or detected matrix properties. The current interpreter uses
Gaussian elimination with partial pivoting.

`matmul` contracts the last axis of its left array with the first axis of its
right array:

```rank
C = A B matmul
C = A B matmul axis 2 0
```

The explicit form names the left and right contracted axes. Their dimensions
must match. Remaining left axes precede remaining right axes in the result, so
vector dot products, matrix-vector products, matrix products and higher tensor
contractions use the same rule. `matmul` does not implicitly broadcast leading
axes. Array results are lazy and cache each demanded numeric element; a shape
mismatch raises `.DimensionMismatch`.

`inverse` has intrinsic rank 2:

```rank
B = A inverse
BatchInverse = Batch inverse
```

It accepts a square rank-2 matrix and returns a real matrix of the same shape.
On a higher-rank tensor it applies independently to every trailing matrix cell.
The ordinary `axis ... rank 2` form selects matrices on other axes:

```rank
Planes = T inverse axis 1 rank 2
```

A non-square cell raises `.DimensionMismatch`; a singular cell raises
`.SingularMatrix`. In a higher-rank result, matrix cells are computed only when
demanded, and each demanded result is cached. Individual matrix inversion uses
partial-pivoting Gauss-Jordan elimination and does not round its real results.

`eigh` decomposes one real symmetric matrix:

```rank
unpack Values Vectors = A eigh
```

Eigenvalues are ascending, and the corresponding eigenvectors are columns of
`Vectors`. The operation accepts a square rank-2 numeric matrix and returns
eager real arrays. Asymmetric input raises `.NotSymmetric`; shape, element and
convergence errors use `.DimensionMismatch`, `.TypeError`, `.DomainError` and
`.ConvergenceError`. The current implementation uses Jacobi rotations.

## Bits

`use bits` provides bitwise operations over arbitrary-precision integers:

```rank
A B band
A B bor
A B bxor
A bnot
A N shl
A N shr
A N bit
A popcount
X binary
X Width binary
```

`bnot` follows infinite two's-complement semantics, so `A bnot` equals
`-A - 1`. Fixed-width code makes its width explicit with a mask:

```rank
Word = Value bnot 65535 band
```

Shifts require a nonnegative bit count. `shr` is an arithmetic right shift.
`bit` tests a zero-based position and returns a boolean. `popcount` returns the
number of set bits. `bit` and `popcount` require a nonnegative input value.
The module does not introduce a separate bit-mask type: bit masks are ordinary
integers and remain distinct from boolean array masks.

The two-argument forms of `band`, `bor`, `bxor`, `shl` and `shr` have intrinsic
ranks `0 0`, so they can be passed to `outer`:

```rank
Grid = Values Values bxor outer
```

`binary` formats a nonnegative integer as text. With one argument it uses the
shortest representation, including `"0"` for zero. A positive integer width
pads with leading zeroes and raises an error when the value does not fit:

```rank
Bits = 10 binary
Padded = 3 5 binary
rem "1010", "00011"
```

## Sequences

Examples:

```rank
primes
fibonacci
len
shape
transpose
window
copy
sort
argsort
count
```

`copy` eagerly copies a material or lazy array into independent writable dense
storage while preserving its shape. On a numeric `+ segment`, it creates an
independent persistent version that shares unchanged nodes. It does not accept
a sequence; postfix `array` materializes a finite sequence into a rank-1 array.

Both are infinite lazy sources until bounded. `primes` yields ascending prime
integers beginning with `2`, supports `to` and `until`, and may seek to a
zero-based position through normal sequence addressing:

```rank
BelowTwenty = primes until 20
SixthPrime = primes 5
```

`from` sets an inclusive lower value boundary and lets the source seek instead
of enumerating the discarded prefix:

```rank
Candidates = primes from 100
First = Candidates 0
rem First is 101
```

`fibonacci from Lower` uses the same plan interface. A lower-bounded source is
still infinite until `to` or `until` supplies an upper boundary.

`in` performs optimized primality testing on this source without enumerating
an unbounded prefix:

```rank
if Candidate in primes
  ...
end
```

A boundary remains part of membership, so `23 in (primes until 20)` is false.
Membership in another bounded sequence uses a finite linear scan. An unbounded
sequence without its own membership plan is rejected.

`argsort` has intrinsic rank 1 and returns stable, zero-based sorting positions.
For tensors it returns the same shape, orders along the last axis by default,
and accepts `axis N` to select another axis.

`sort by` performs a stable materializing sort of a finite rank-1 collection.
Record fields form a lexicographic key, or one unary function computes a scalar
key once for each value. `argsort by` accepts the same keys and returns source
positions:

```rank
Events = Events sort by .time .delta
Values = Values sort by magnitude
Order = Events argsort by .time .delta
```

The result is a new rank-1 array. Key values use the ordinary numeric, text,
boolean or symbol ordering.

## Tables

Includes concepts such as:

```rank
csv
group
join
labels
```

## Stats

`use stats` provides arithmetic mean, population standard deviation, error
metrics and sample covariance:

```rank
Average = Values mean
Rows = Matrix mean axis 1
Spread = Values std
Columns = Matrix std axis 0
Loss = Pred Target mse
Rows = Pred Target mae axis 1
Cov = Features covariance
Cov = Samples covariance axis 1 0
```

`mean` and `std` accept a numeric array or finite sequence and always return a
`real`. `std` divides by the population denominator `N`. An empty input raises
`.EmptyReduction`. Both operations support `rank` and `axis`; tensor behavior
is described in [Tensors](../language/tensors.md). `std` rejects nonfinite
cells with `.DomainError`.

`mse` and `mae` calculate mean squared error and mean absolute error between
two numeric values, finite sequences or arrays:

```rank
Loss = Pred Target mse
FeatureLoss = Pred Target mae axis 0
```

The inputs follow Rank's trailing-axis broadcasting rules. Without `axis`, the
metric averages every broadcast result. An axis list averages only the named
axes and preserves the others in their original order. Both metrics always
return real values, keep framed tensor results lazy, and raise
`.EmptyReduction` for an empty reduced cell. Incompatible shapes raise
`.DimensionMismatch`. Binary `rank` application remains deferred.

By default, `covariance` treats the last two axes as features and observations;
earlier axes are independent batches. The explicit `axis F O` form selects the
feature and observation axes in that order. It preserves the other axes and
replaces the selected axes with two feature axes. The operation uses the sample
denominator `N - 1`, returns real values, and requires at least two
observations. Its result and feature means are calculated lazily and cached.

## Text

Examples:

```rank
split
reverse
codepoint
character
text
integer
parse
startswith
hex
```

`+` concatenates two text values. Both operands must already be text; Rank does
not implicitly convert numbers or other values:

```rank
Candidate = Secret + N text
```

`split` separates text at every exact occurrence of a text separator and
returns a rank-1 array of text values. A rank-1 array of separators splits at
any of them. Adjacent separators preserve empty parts. An empty separator
splits by Unicode code point and must be used alone:

```rank
Parts = "2x3x4" "x" split
Fields = Text (array "," ";") split
Characters = "A😀Б" "" split
```

`parse` matches a complete text value against a text pattern and returns the
captured values as a rank-1 array. It is normally combined with `unpack`:

```rank
Pattern = "/word to /word = /integer"
unpack From To Distance = Line Pattern parse
```

Patterns use `/integer`, `/real`, `/word` and `/text`. Integers and reals are
converted to their corresponding scalar types. `/word` captures one or more
non-whitespace characters. `/text` captures as little text as possible while
allowing the following literal pattern to match. `//` matches one literal
slash. All other characters, including spaces, match exactly:

```rank
Pattern = "/integerx/integerx/integer"
unpack Length Width Height = "2x3x4" Pattern parse

Spaced = "/integer x /integer"
unpack A B = "2 x 3" Spaced parse
```

An unknown directive raises `.InvalidFormat`. Input that does not match the
complete pattern raises `.InvalidText`, with the original pattern or input
available as the error value respectively.

`startswith` tests an exact, case-sensitive prefix:

```rank
Ready = Text "Rank" startswith
```

`hex` converts `bytes` to lowercase hexadecimal text without a prefix:

```rank
Encoded = Bytes hex
```

`integer` parses optional `+` or `-` followed by decimal digits. Its intrinsic
unary rank is 1, so a complete text value is converted at once. Explicit
`rank 0` converts each Unicode character and produces a lazy sequence:

```rank
Value = "-1203" integer
Digits = "1203" integer rank 0
```

`text` formats one scalar value as text. Text input is returned unchanged.
Arrays and other collections require an explicit mapping rank rather than
being flattened implicitly.

A literal format after `text` selects fixed decimal output:

```rank
(2 / 3) text ".6f" print
rem 0.666667
12 text ".3f" print
rem 12.000
```

The format is `.Nf`, where N is an integer from 0 to 100. It produces exactly
N digits after the decimal point, with no exponent. Rounding uses the same
nearest-even rule as `round`; it does not add precision to a real value.
Integer inputs retain their exact value. A result that rounds to zero has no
minus sign. Nonfinite reals retain their ordinary text representation.
Invalid formats raise `.InvalidFormat`; nonnumeric input raises `.TypeError`.

This is a literal modifier, not a second function arity: `text` remains unary.
A format variable or an alias such as `F = text` does not accept the modifier.
Formatted arrays keep their shape; formatted sequences are lazy.
Plain `text` and `print` keep their existing behavior.

`join` takes a rank-1 array, queue-family collection or finite sequence followed
by a text separator. It converts scalar elements as plain `text` does and
returns one string. An empty collection produces empty text. An empty separator
concatenates the elements directly:

```rank
(array 1 2 3) ", " join print
rem 1, 2, 3
(array "ab" "cd") "" join print
rem abcd
```

A nontext separator, nonscalar element or higher-rank array raises
`.TypeError`. Join matrix rows explicitly instead of flattening the matrix:

```rank
for Row in Matrix
  Row text ".6f" " " join print
end
```

`join` consumes its input. Known infinite sequences are rejected; for a sequence
whose size is unknown, the caller must ensure that it terminates.


`reverse` reverses text by Unicode code point:

```rank
Back = "A😀Б" reverse
rem Б😀A
```

Reversal of array axes is a separate tensor operation and remains deferred.

`codepoint` converts exactly one Unicode character to its integer code point.
`character` performs the inverse conversion and returns one-character text:

```rank
Code = "😀" codepoint
C = 128512 character
```

`character` rejects negative integers, values above `0x10ffff`, and Unicode
surrogate code points.

`len` from `sequences` returns the number of Unicode code points in text, the
leading-axis length of an array, the size of a queue or set, or the length of a
finite sequence. It rejects an infinite sequence.

`reshape` from `sequences` constructs a dense array in row-major order:

```rank
M = Values (array Rows Columns) reshape
```

The shape is a rank-1 array of nonnegative integers. The source may be an
array, queue, finite sequence or text, and its element count must exactly match
the requested shape. An infinite source is an error.

`window` returns overlapping fixed-size cells lazily:

```rank
Pairs = Text 2 window
Windows = Values Width window
WindowShape = array 2 3
Blocks = M WindowShape window
Columns = M 3 window axis 1
Strided = M WindowShape window stride 2
Padded = M WindowShape window padding 1
```

Tensor window sizes correspond to all axes unless `axis` selects a subset.
`stride` and `padding` accept a scalar for all selected axes or one integer per
axis. Their defaults are one and zero. Strides are positive; padding is
nonnegative, symmetric, array-only and filled with integer zero. The modifiers
precede a final `axis` clause when combined. Results remain lazy and contain
only complete windows of the conceptually padded source.

## JSON

`use json` decodes a complete JSON document from text:

```rank
Data = Text json
FileData = Path read json
```

JSON integers become arbitrary-precision `integer` values. Decimal and
exponent forms become `real`; strings and booleans become the corresponding
Rank scalars; arrays become Rank arrays; objects become keyed `object` values;
and JSON `null` becomes `.null`. Invalid input raises `.InvalidJson`. File input
is composed explicitly with `read`, so file and UTF-8 failures keep their
ordinary I/O error kinds.

Object addressing follows the common data-first addressing model. Membership
tests keys, `len` counts entries, and iteration yields each value followed by
its text key:

```rank
Name = Data "name"
HasName = "name" in Data

for Value Key in Data
  Key print
end
```

Object entry order follows the source document. Values may be heterogeneous,
so the loop value binding receives an inferred union type and can be narrowed
with `is`.

## Cryptography

`use crypto` provides hash and related byte operations. `md5` hashes the UTF-8
encoding of text and returns 16 `bytes`; formatting remains an explicit step:

```rank
Digest = Text md5
Hash = Digest hex
```

## File I/O

`print` writes one line using Rank's default value representation and returns
the value so a pipeline may continue. Scalars and arrays keep their compact
grader-friendly form. Records include field names and values, for example
`{.value = 3, .name = root}`, rather than an opaque runtime marker.

`use io` provides symbol-directed access to standard input. `.word` reads one
whitespace-separated token as text. `.integer` reads the same unit and converts
it to an arbitrary-precision integer:

```rank
Name = stdin .word
N = stdin .integer
```

Spaces, tabs, LF and CRLF separate tokens. Optional `+` and `-` signs are
accepted. End of input raises `.EndOfInput`; a token that is not a decimal
integer raises `.InvalidNumber`. Standard input is supplied by the host, so an
embedded host without it raises `.IO`.

A count after the mode returns an exact-size lazy, single-pass sequence:

```rank
Count = N - 1
Values = stdin .integer Count
Words = stdin .word Count
```

The count must be a nonnegative integer. No input is read until the sequence is
consumed, so input and conversion errors are delayed too. Use postfix `array`
when the complete input must be validated or traversed more than once:

```rank
Values = stdin .integer Count array
```

Line-oriented input is not part of the current language yet.

`use io` provides one-shot UTF-8 text operations for the common case:

```rank
Text = Path read
Lines = Path readlines

Text Path write
Text Path append
```

`read` preserves the complete decoded text, including a final line ending.
Invalid UTF-8 raises `.InvalidEncoding`. `readlines` recognizes LF, CRLF and CR,
removes the line separators and does not add an empty item for a final line
ending. An empty file produces an empty rank-1 array.

`write` creates or replaces a file. `append` creates a missing file or adds text
to the end of an existing file. Both encode text as UTF-8.

Random access uses byte offsets. A one-shot block read does not create a visible
file handle:

```rank
Bytes = Path Offset Count readbytes
```

`bytes` is a specialized rank-1 tensor whose atoms are integers from 0 through
255. It formats as hexadecimal text such as `0x52616e6b`. Offsets and counts are
nonnegative integers, and a block ending past the file returns the available
bytes.

Repeated and stateful I/O uses a `file` value:

```rank
File = Path open

Header = File 64 readbytes
File 1024 seek
Chunk = File 128 readbytes

Offset = File position
Length = File size
Done = File eof
```

`seek` sets an absolute byte offset from the beginning. `position` and `size`
return byte counts. `eof` is true when the current position is at or beyond the
current size.

`open` is read-only by default. A mode label selects another mode:

```rank
Output = Path .write open
Update = Path .update open
Log = Path .append open
```

`.write` creates or clears a file, `.update` opens an existing file for reading
and writing, and `.append` creates a missing file and forces writes to its end.
Handles opened by all three modes can be read. Binary output takes a `bytes`
value previously obtained from `readbytes`:

```rank
Output Bytes writebytes
Output flush
```

`flush` requests that buffered output reach the host file system. File-system
failures raise `.IO` and carry the path as `.Value`.

A file is a scoped resource. It closes automatically when its owning function,
test or program exits, including through `return` or an error. Returning a file,
directly or inside a returned collection, moves ownership to the caller. A file
may be closed early with `File close`; closing an already closed file has no
effect, and other operations on it raise `.IO`.

The interpreter accesses files only through its host adapter. The command-line
host uses the local file system; browser and embedded hosts may provide a file
picker, virtual file system or another implementation with the same semantics.

## Dates

Examples:

```rank
hour
weekday
month
year
```

## Algorithm profile

`use algo` provides algorithmic collections and combinatorial generators:

```rank
Seen = new set
Counts = new counter
Empty = new multiset
F = Size fenwick
Tree = Values min segment
Data = Values wavelet
Seen add Value
Counts add Value
Bag = Values multiset
Bag add Value
Bag remove Value
Third = Bag 2
Lower = Bag floor Limit
Upper = Bag ceiling Limit
Routes = Cities permutations
Pairs = Values 2 combinations
Repeated = Values 2 multicomb
```

`new stack`, `new deque` and `new heap` create empty named containers.
`pop` and `peek` work on queues, stacks, deques and heaps. Deques also provide
`pushfront`, `pushback`, `popfront`, `popback`, `peekfront` and `peekback`.
`Heap Priority Value enqueue` inserts a payload with a separate priority into
a stable min-heap. `Heap push Value` uses the value as its priority.
`new orderedset` creates a duplicate-free multiset. `lowerbound` returns the
smallest value >= the query; `upperbound` returns the smallest value > it.
These names, together with `floor` and `ceiling`, are contextual rather than
reserved: receiver-first method dispatch occurs only when the evaluated
receiver is a multiset. Otherwise Rank resolves the word as an ordinary
function.
See [collections](../language/collections.md) for examples and empty-container rules.

`Values multiset` constructs a populated ordered multiset; `new multiset`
creates an empty one. A multiset preserves duplicates. `Bag I` selects a sorted
occurrence by zero-based index. Its lookup and mutation operations take expected
`O(log N)` time. Missing indexed, `floor` and `ceiling` results raise `.Missing`
and therefore compose with `pad`. The complete collection semantics are defined
in [Collections](../language/collections.md).

`Size fenwick` constructs a fixed-size integer Fenwick tree. It supports
zero-based cell access and assignment plus inclusive prefix sums through
`F sum I`, all as specified in [Collections](../language/collections.md).
This middle use of `sum` dispatches by the receiver's Fenwick type and does not
reserve the word in other application chains.

`Values Operation segment` builds a segment tree for an associative binary
operation. `Tree Left Right query` reduces an inclusive range, and addressed
assignment performs a point update. Construction, bounds and error behavior
are specified in [Collections](../language/collections.md).

`Tree Target firstatleast` finds the first monotone numeric prefix that reaches
the target. `Values maxsum segment` selects the native prefix/subarray summary
profile and returns `.sum`, `.prefix`, `.suffix` and `.best` from `query`.

Numeric `Values + segment` trees also accept inclusive addressed range
assignment and addition. Both updates and `query` take `O(log N)` time.

`Values wavelet` prepares an immutable wavelet matrix. The form
`Data Left Right Low High within` counts values inside inclusive position and
value ranges. `sumwithin` sums a numeric rectangle, and
`Data Bounds missing` finds the first missing subset sum for positive integer
values. `Bounds` may be one range pair or a matrix of range pairs because the
operation has intrinsic ranks `all 1`. See [Collections](../language/collections.md).

## Graph profile

`use graph` provides the `new graph` constructor, graph-specific `add` and
`edges` dispatch, and the `bfs`, `dfs`, `components`, `bipartite`, `dijkstra`,
`bellmanford`, `floyd`, `cycle`, `euler`, `topological`, `scc`, `mst`, and `maxflow`
algorithms. It also provides the experimental `Next functional` prepared value
with `jump`, `distance`, `lengths`, and the increasing-path `upto` query.
`Next Cost weighted` adds numeric edge sums to that path. Their inputs and
results are specified in [Graphs](../language/graphs.md).
An undirected tree can be prepared with `Tree Root root`; its postfix
`ancestor`, `lca`, and `distance` queries and traversal fields are specified
in the same document. `Tree pathlengths` provides a lazy unordered-pair
distance sequence with planned exact and bounded-range counts.
The same module provides closed and open `new dsu` structures with contextual
`merge`, `find`, and `connected` methods plus `components` and `len` queries.

## Rule for adding library vocabulary

A word belongs in the standard library when it represents a broad, reusable
concept with established meaning.

Do not add a word merely because it makes one LeetCode, Euler or Kaggle task
shorter.
