# text manual

## character

The character with a given Unicode
number.

```rank
use text
65 character
```

```result
A
```

### Usage

```text
Code character
```

### See also

codepoint

## codepoint

The Unicode number of a character.

```rank
use text
"A" codepoint
```

```result
65
```

### Usage

```text
Character codepoint
```

The text must be exactly one character.

### See also

character

## hex

Write bytes as hexadecimal text.

```rank
use text
"Rank" bytes hex
```

```result
52616e6b
```

### Usage

```text
Bytes hex
```

Two lowercase digits per byte, with no
0x in front.

### See also

bytes, binary

## join

Glue items into one text, with a
separator between them.

```rank
use text
(array 1 2 3) join ", "
```

```result
1, 2, 3
```

### Usage

```text
Values join Separator
```

Numbers and other single values are
turned into text first. A matrix joins
each row separately.

### See also

split, text

## parse

Read values out of text that follows a
pattern.

```rank
use text
P = "/integer /integer"
unpack A B = "12 7" parse P
A + B
```

```result
19
```

### Usage

```text
Text parse Pattern
```

In the pattern, /integer, /real, /word
and /text mark the values to read;
everything else must match exactly. The
whole text must match. Same-type
captures form an array; mixed captures
form a tuple. Use unpack to name them.

### See also

split, words, unpack

## split

Cut text into pieces at a separator.

```rank
use text
"a,b,c" split ","
```

```result
a b c
```

### Usage

```text
Text split Separator
```

Two separators in a row give an empty
piece between them. An empty separator
"" splits into single characters.

### See also

join, words, parse

## startswith

Check whether text begins with a given
prefix.

```rank
use text
"Rank" startswith "Ra"
```

```result
true
```

### Usage

```text
Text startswith Prefix
```

Upper and lower case must match. Also
works on bytes, and on each item of an
array.

### See also

find, lower

## lower

Change text to lowercase.

```rank
use text
"Rank" lower
```

```result
rank
```

### Usage

```text
Text lower
```

Works for every language, not only
English.

### See also

words, startswith

## letter

Test whether characters are letters.

```rank
use text
"Hi 5" split "" letter
```

```result
true true false false
```

### Usage

```text
Character letter
```

Works for every language. A text array
gives one answer per character; each
element must be exactly one character.

### See also

digit, alnum, split

## digit

Test whether characters are decimal
digits.

```rank
use text
"Hi 5" split "" digit
```

```result
false false false true
```

### Usage

```text
Character digit
```

Any script's decimal digits count.
A text array gives one answer per
character.

### See also

letter, alnum, split

## alnum

Test whether characters are letters
or numbers.

```rank
use text
"Hi 5!" split "" alnum
```

```result
true true false true false
```

### Usage

```text
Character alnum
```

The same characters that words keeps. A
text array gives one answer per
character.

### See also

letter, digit, words

## lpad

Pad text on the left to a minimum width.

```rank
use text
"7" 3 "0" lpad
```

```result
007
```

### Usage

```text
Text Width Fill lpad
```

Text already as wide as Width is left
unchanged; nothing is cut off.

### See also

join, text

## translate

Replace characters one for one; delete
the ones with no replacement.

a becomes A and n becomes N.

```rank
use text
"banana" "an" "AN" translate
```

```result
bANANA
```

### Usage

```text
Text From To translate
```

Each character of From is replaced by
the character at the same place in To.
If To is shorter, the leftover
characters of From are deleted.

### See also

lower, split

## vocab

The most common words, most frequent
first.

```rank
use text
(array "a a" "b") vocab 2
```

```result
a b
```

### Usage

```text
Texts vocab Limit
```

Gives at most Limit words. Words are
found as with words, so case and
punctuation are ignored. Ties are broken
alphabetically.

### See also

words

## words

The words of a text, in lowercase.

```rank
use text
"Hello, Rank!" words
```

```result
hello rank
```

### Usage

```text
Text words
```

A word is a run of letters and digits;
spaces and punctuation separate words.

### See also

split, vocab, lower

## bpeencode

Encode text using a GPT-2-compatible byte-level BPE tokenizer JSON.

```text
Text bpeencode TokenizerJson
```

The result is a rank-1 integer array. The tokenizer is supplied as JSON text,
for example from `"models/gpt2-tokenizer.json" read` with `use io`. The supported
format has a BPE vocabulary and ordered merges, ByteLevel pre-tokenization with
`add_prefix_space: false`, no normalizer, and a ByteLevel decoder. Vocabulary
IDs must be unique nonnegative signed 32-bit integers and cover all 256 bytes.
Merges may be two-element arrays or space-separated pairs.

Declared special tokens are recognized literally. Added tokens that strip
whitespace or require word boundaries, unknown-token fallback, dropout,
padding, truncation, non-ByteLevel processing and subword prefixes/suffixes are
rejected with `.InvalidTokenizer`. Padding and generation policy belong in the
calling program. Empty text produces an empty array; malformed Unicode is
rejected. One tokenizer and up to 1024 short BPE pieces are cached internally.

### See also

bpedecode

## bpedecode

Decode a rank-1 integer array using the same tokenizer JSON.

```text
Tokens bpedecode TokenizerJson
```

Token bytes are joined before UTF-8 decoding, so a character split between
tokens is reconstructed. Incomplete or invalid UTF-8 produces replacement
characters. Special tokens remain in the output; generation should stop before
appending EOS if the marker should be omitted. Unknown IDs and real-valued IDs
raise `.DomainError`. Empty input produces empty text.

### See also

bpeencode
