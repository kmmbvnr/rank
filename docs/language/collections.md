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
Last = index C pad -1
```

Multi-dimensional keyed addressing:

```rank
index A B C = Value
X = index A B C
```

The key and value types are inferred from uses within the function.

### Queue

```rank
queue push X
return queue
```

The first use of `queue` lazily creates one queue in the current function-call
workspace. Separate and recursive calls receive separate queues. The queue is
ordered, zero-based, iterable and addressable after it is returned.
For elementwise operations, a queue behaves as a rank-1 array. This lets a
function return a queue and a test compare it directly with an array literal.

`push` takes one argument, so the rest of its line is one complete expression:

```rank
queue push A i + Carry
```

Structure methods place the receiver first and the method second. A method with
no arguments ends after its name; a method with one argument consumes the rest
of the line. The block syntax for methods with two or more arguments is not yet
settled. The earlier `with ... end` proposal is disputed and is not current
syntax.

Addressed mutation uses assignment rather than a `put` method:

```rank
index Row Column = Value
rem A Row Column = Value when mutable array cells are implemented
```

### Set

```rank
set add X
```

### Counter

```rank
counter add X
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
