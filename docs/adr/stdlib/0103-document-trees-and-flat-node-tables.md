# 0103. Document Trees and Flat Node Tables (use json, use xml)

* **Status:** Accepted
* **Date:** 2026-09-26
* **Deciders:** @kmmbvnr
* **Consulted:** Dyalog `⎕JSON` and `⎕XML`, Dyalog Programming Contest 2010 Task 1 (issue #12), Advent of Code 2015 Day 12

## Context

`use json` decoded a document into nested Rank values: arrays, keyed objects and
scalars. That form is right when the shape of the document is known and a path
names what to read, and an array of objects is already a table.

Dyalog 2010 Task 1 reads twelve attributes of one element of an XML document.
XML has no single mapping to values: repeated children are neither an array nor
an object, attributes and children are two kinds of fields, and text interleaves
with elements. APL's `⎕XML` answers with a flat matrix of nodes — depth, name,
content, attributes — where finding an element at any depth is a selection
rather than a recursive walk. `⎕JSON` offers the same matrix as an option next
to its nested form.

Adding XML only in the flat form, while JSON has only the tree, would give two
decoders with two unrelated vocabularies. One consistent design covers both.

## Decision

### 1. Two forms per format, chosen by a trailing modifier

```rank
Data = Text json          rem nested Rank values, as before
Nodes = Text json .flat   rem table of nodes
Doc = Text xml            rem tree of nodes
Nodes = Text xml .flat    rem table of nodes
```

The tree is the default; `.flat` after the name selects the table. The modifier
follows the operation, as `.descending` follows `sort`, because it names a form
of the result. Written before the name, `Text .flat json` would read like a
field of the text.

An operation declares its modifiers in the catalogue (`modifiers: ['flat']`).
Grouping rewrites `X json .flat` into the ordinary call with the label as its
last operand before analysis and execution, taking the whole pipeline before
the name as the document: `Path read json .flat` decodes the file text, and a
following step applies to the table. A label that the operation does not
declare keeps its ordinary meaning, a field read of the result.

### 2. One row shape for both formats

A flat table is a rank-1 array of row objects in document order, so a parent
precedes its descendants. Every row has:

| Field | JSON | XML |
|---|---|---|
| `.depth` | nesting depth, document value at 0 | same, root element at 0 |
| `.parent` | row of the enclosing container, -1 at the top | same |
| `.kind` | `"object" "array" "integer" "real" "text" "boolean" "null"` | `"element" "text" "comment"` |
| `.name` | key of an object entry, `""` otherwise | tag name, `""` for text and comments |
| `.value` | leaf value, `""` for containers | content of text and comments, `""` for elements |

XML rows add `.attributes`, a keyed object. Rows are objects rather than
records because objects are the row form the table pipeline reads, so
`Nodes filter .name equal "BuyRentParams"` needs nothing new.

`.kind` is text, not a label: inside a table condition a label names a column,
so `.kind equal .integer` would compare two columns. `.parent` goes beyond
`⎕XML`/`⎕JSON`, which carry only depth; with it a program climbs to an ancestor
or groups children without reconstructing the tree.

### 3. The XML tree uses the same fields

A tree node is an object with `.kind`, `.name`, `.value`, `.attributes` and
`.children` — the row fields, with `.children` in place of `.depth` and
`.parent`. The JSON tree stays plain values: for JSON the natural mapping
exists, and changing it would gain nothing.

### 4. XML scope

The decoder accepts elements, attributes, text, comments, CDATA, the five
predefined entities and character references. It skips the XML declaration,
processing instructions and a document type declaration, merges adjacent text
and CDATA, and drops whitespace-only text between markup. Namespaces are not
resolved; `a:b` is an ordinary name. Attribute values stay text. Malformed input
raises `.InvalidXml`.

### 5. Addressing that the node forms rely on

- An object addressed by an array of text keys returns the entries in that
  order: `Attributes Fields`.
- A field label inside an address addresses what it reads:
  `Found 0 .attributes Fields` is `((Found 0) .attributes) Fields`.

## Consequences

- Task 1 is a filter and a projection:
  `Found = Nodes filter .name equal "BuyRentParams"` then
  `Found 0 .attributes Fields real rank 0`.
- A search at any depth in JSON is a filter as well; AoC 2015 Day 12 part 1 is
  `(Nodes filter .kind equal "integer") .value sum`.
- Filtering a node table by a field needs `use tables`, like any table.
- Other decoders adopt the same row fields and the `.flat` modifier.
- Filtering the node table by ancestry, such as excluding every descendant of a
  matched row, still needs a walk; a subtree end column is left for when a
  program needs it.
