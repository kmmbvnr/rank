# text manual

## character

### NAME

One-character text for a Unicode code
point.

### SYNOPSIS

```text
Code character -> text
Code: valid integer Unicode code point
```

### DESCRIPTION

Accepts a valid Unicode code point and
returns one-character text.

### EXAMPLES

Unicode code point 65 gives A.

```rank
use text
65 character
```

## codepoint

### NAME

Integer code point of exactly one
character.

### SYNOPSIS

```text
Character codepoint -> integer
Character: one-code-point text
```

### DESCRIPTION

Input must contain exactly one Unicode
code point, not an arbitrary-length
string.

### EXAMPLES

A has Unicode code point 65.

```rank
use text
"A" codepoint
```

## hex

### NAME

Lowercase hexadecimal text for bytes,
without a prefix.

### SYNOPSIS

```text
Bytes hex -> text
Bytes: bytes
```

### DESCRIPTION

Input is bytes. Two hexadecimal digits
represent each byte; no 0x prefix is
added.

### EXAMPLES

Encode bytes as lowercase hexadecimal.

```rank
use text
"Rank" bytes hex
```

## join

### NAME

Joins scalar elements of a finite
collection into one text; a matrix joins
each row.

### SYNOPSIS

```text
Values Separator join -> text
Values: finite collection; Separator:
text
```

### DESCRIPTION

Scalar values are formatted as text. A
matrix joins each row separately; the
separator is placed between items.

### EXAMPLES

Join items with commas: a,b.

```rank
use text
(array "a" "b") "," join
```

## parse

### NAME

Captures /integer, /real, /word and
/text from a complete pattern match.

### SYNOPSIS

```text
Text Pattern parse -> array
Text, Pattern: text
```

### DESCRIPTION

The pattern supports /integer, /real,
/word and /text. The entire text must
match; unpack assigns the captured
values to names.

### EXAMPLES

Capture two integers from the complete
text.

```rank
use text
"12 7" "/integer /integer" parse
```

## split

### NAME

Splits at every exact occurrence of a
separator, keeping empty parts.

### SYNOPSIS

```text
Text Separator split -> array
Text: text; Separator: text or text
array
```

### DESCRIPTION

Splits at every exact separator
occurrence. An empty separator splits
into Unicode code points and must be
used alone.

### EXAMPLES

Keep the empty item between adjacent
commas.

```rank
use text
"a,,b" "," split
```

## startswith

### NAME

Exact text or byte prefix test; ordinary
arrays broadcast elementwise.

### SYNOPSIS

```text
Value Prefix startswith -> boolean
Value, Prefix: text or bytes
```

### DESCRIPTION

The match is exact and case-sensitive.
Text and bytes are supported; ordinary
arrays broadcast cell by cell.

### EXAMPLES

The text has prefix Ra: true.

```rank
use text
"Rank" "Ra" startswith
```

## lower

### NAME

Converts Unicode text to lowercase.

### SYNOPSIS

```text
Text lower -> text
Text: text
```

### DESCRIPTION

Uses Unicode lowercase rules. Input
cells must be text.

### EXAMPLES

Convert uppercase R to lowercase: rank.

```rank
use text
"Rank" lower
```

## lpad

### NAME

Pads text on the left without truncating
longer values.

### SYNOPSIS

```text
Text Width Fill lpad -> text
Text, Fill: text; Width: integer
```

### DESCRIPTION

Width counts Unicode code points. Text
already at least that wide is unchanged;
longer values are not truncated.

### EXAMPLES

Pad on the left: 007.

```rank
use text
"7" 3 "0" lpad
```

## translate

### NAME

Replaces listed characters, deleting
those with no replacement.

### SYNOPSIS

```text
Text Chars Replacement translate -> text
Text, Chars, Replacement: text
```

### DESCRIPTION

Chars names source characters and
Replacement supplies their replacements.
Source characters without replacements
are deleted.

### EXAMPLES

Replace a with A and n with N.

```rank
use text
"banana" "an" "AN" translate
```

## vocab

### NAME

Most frequent words, at most Limit of
them, ties by code point.

### SYNOPSIS

```text
Texts Limit vocab -> array
Texts: text array; Limit: integer
```

### DESCRIPTION

Limit is a nonnegative integer. Words
are normalized; ties are ordered by
Unicode code point. Zero limit returns
an empty array.

### EXAMPLES

Find the two most frequent words.

```rank
use text
(array "a a" "b") 2 vocab
```

## words

### NAME

Lowercase Unicode letter and number
runs.

### SYNOPSIS

```text
Text words -> array
Text: text
```

### DESCRIPTION

Keeps Unicode letter and number runs.
Punctuation and whitespace separate
words.

### EXAMPLES

Extract lowercase words: hello, rank.

```rank
use text
"Hello, Rank!" words
```
