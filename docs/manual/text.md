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
(array 1 2 3) ", " join
```

```result
1, 2, 3
```

### Usage

```text
Values Separator join
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
unpack A B = "12 7" P parse
A + B
```

```result
19
```

### Usage

```text
Text Pattern parse
```

In the pattern, /integer, /real, /word
and /text mark the values to read;
everything else must match exactly. The
whole text must match. The values come
back as an array, often split with
unpack.

### See also

split, words, unpack

## split

Cut text into pieces at a separator.

```rank
use text
"a,b,c" "," split
```

```result
a b c
```

### Usage

```text
Text Separator split
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
"Rank" "Ra" startswith
```

```result
true
```

### Usage

```text
Text Prefix startswith
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
(array "a a" "b") 2 vocab
```

```result
a b
```

### Usage

```text
Texts Limit vocab
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
