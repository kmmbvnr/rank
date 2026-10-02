# json manual

## json

Read JSON text into Rank values.

```rank
use json
R = "{\"name\":\"Ada\"}" json
R .name
```

```result
Ada
```

### Usage

```text
Text json
Text json .flat
```

JSON objects become objects with dot
fields. Same-type lists become arrays;
mixed lists become tuples. Add .flat
to get one table row per node. Its
.value column is text: filter .kind
and convert numbers before arithmetic.

### See also

table, xml, read
