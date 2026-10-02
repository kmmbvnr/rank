# json manual

## json

### NAME

Decodes a complete JSON document into
Rank values.

### SYNOPSIS

```text
Text json -> value
Text: complete JSON text
```

### DESCRIPTION

Accepts a complete JSON document.
Objects become object values; arrays
become homogeneous arrays or tuples
when element types differ. A trailing
.flat requests a table of document
nodes. Its .value column contains text;
filter .kind and convert numeric leaves
before arithmetic.

### EXAMPLES

Decode JSON into a Rank array.

```rank
use json
"[1,2,3]" json
```
