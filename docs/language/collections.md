# Collections

Rank supports standard local structures with implicit naming.

## Implicit local structure

If a function uses only one instance of a standard structure, the type word
itself denotes that lazily-created local instance.

### Index

`index` is a sparse keyed structure.

```rank
index Ai = i
```

Read:

```rank
j = index Need
```

Membership:

```rank
if Need in index
    ...
end
```

Default:

```rank
Last = index Ci pad -1
```

Multi-dimensional keyed addressing:

```rank
index A B C = Value
X = index A B C
```

The key and value types are inferred from uses within the function.

### Queue

```rank
push queue X
return queue
```

### Set

```rank
add set X
```

### Counter

```rank
add counter X
```

If multiple structures of the same type are needed, they should be given
explicit names.

## Design rule

These are general data structures, not puzzle-specific shortcuts. Advanced
structures may live in modules:

- heaps;
- disjoint-set union;
- Fenwick tree;
- segment tree;
- bitset;
- sparse table;
- graph structures.
