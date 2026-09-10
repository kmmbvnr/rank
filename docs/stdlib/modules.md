# Standard library

Rank starts with a small core. Vocabulary is introduced through `use` modules.

Current module directions:

```rank
use numbers
use random
use linalg
use bits
use ranges
use collections
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
prime
gcd
lcm
powmod
factors
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

`min` and `max` use data-first application. With one collection they reduce it;
with two numeric values they return the smaller or larger operand:

```rank
Smallest = Values min
Left = A B max
```

`infinity` is the positive infinite `real` value. Unary negation produces
`-infinity`.

## Sequences

`all` and `any` are named boolean reductions:

```rank
Every = Mask all
Some = Mask any
Rows = Flags all axis 1
```

They are equivalent to `and reduce` and `or reduce`, respectively. They accept
only boolean cells, short-circuit when the result is known, and support `rank`
and `axis`. Empty collections produce `true` for `all` and `false` for `any`.
Known unbounded sequences are rejected.

## Random

`use random` provides random permutation operations:

```rank
Shuffled = Values shuffle
Repeatable = Values 42 shuffle
Rows = Data shuffle axis 0
Columns = Data 42 shuffle axis 1
```

`shuffle` accepts an array or a finite sequence and returns a new eager dense
array. It never changes its source. A sequence is explicitly consumed by the
operation. An unbounded sequence, a scalar or a missing tensor axis is an
error.

The default axis is zero. Selecting another axis reorders its complete slices
with one shared permutation: shuffling matrix columns moves every column as a
unit rather than shuffling each row independently.

Without a seed, `shuffle` consumes the current interpreter's pseudorandom
stream. Supplying an integer seed creates a private stream for that operation,
so equal inputs and equal seeds produce equal results within one interpreter
version without changing the default stream. The precise generator and seeded
order are implementation details and may change between versions. `shuffle`
is not a cryptographic randomness operation.

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
```

`copy` eagerly copies a material or lazy array into independent writable dense
storage while preserving its shape. It does not accept a sequence; postfix
`array` materializes a finite sequence into a rank-1 array.

Both are infinite lazy sources until bounded. `primes` yields ascending prime
integers beginning with `2`, supports `to` and `until`, and may seek to a
zero-based position through normal sequence addressing:

```rank
BelowTwenty = primes until 20
SixthPrime = primes 5
```

## Tables

Includes concepts such as:

```rank
csv
group
join
labels
```

## Stats

`use stats` provides arithmetic mean, population standard deviation and sample
covariance:

```rank
Average = Values mean
Rows = Matrix mean axis 1
Spread = Values std
Columns = Matrix std axis 0
Cov = Features covariance
Cov = Samples covariance axis 1 0
```

`mean` and `std` accept a numeric array or finite sequence and always return a
`real`. `std` divides by the population denominator `N`. An empty input raises
`.EmptyReduction`. Both operations support `rank` and `axis`; tensor behavior
is described in [Tensors](../language/tensors.md). `std` rejects nonfinite
cells with `.DomainError`.

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
```

Tensor window sizes correspond to all axes unless `axis` selects a subset.
Only complete windows are produced.

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

`use algo` may act as a contest-oriented umbrella module rather than introducing
new semantics.

## Rule for adding library vocabulary

A word belongs in the standard library when it represents a broad, reusable
concept with established meaning.

Do not add a word merely because it makes one LeetCode, Euler or Kaggle task
shorter.
