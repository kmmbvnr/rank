# xml manual

## xml

Read XML text into a tree of elements.

```rank
use xml
X = "<a>hello</a>" xml
X .name
```

```result
a
```

### Usage

```text
Text xml
Text xml .flat
```

The text must be one complete XML
document. Each element has a .name and
.children. Add .flat to get a table
instead, with one row per node and
columns .depth, .parent, .kind, .name,
.value and .attributes.

### See also

json, table
