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
become arrays. A trailing .flat requests
a table of document nodes. Begin the
program with use json.

### EXAMPLES

Decode JSON into a Rank array.

```rank
use json
"[1,2,3]" json
```
