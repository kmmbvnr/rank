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

JSON objects become records with dot
fields, and JSON lists become arrays.
Add .flat to get a table with one row
per node instead.

### See also

table, xml, read
