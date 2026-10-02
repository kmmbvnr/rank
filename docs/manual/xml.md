# xml manual

## xml

### NAME

Decodes a complete XML document into a
tree of element nodes.

### SYNOPSIS

```text
Text xml -> value
Text: complete XML text
```

### DESCRIPTION

Requires one complete XML document.
Returns a tree of element nodes; a
trailing .flat gives a table with depth,
parent, kind, name and value fields.
Begin the program with use xml.

### EXAMPLES

Decode an XML element and its text.

```rank
use xml
"<a>hello</a>" xml
```
