# 0106. Record Types as Closed, Typed Reference Structures

* **Status:** Accepted
* **Date:** 2026-09-08
* **Updated:** 2026-09-28 — fixed recursive field schemas (issue #32)
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Lexical Syntax Specification

## Context

When building complex algorithms, graph algorithms, and machine learning computation graphs (such as autograd nodes in neural networks):
1. **Dynamic dictionary traps (Python/JS):** Using arbitrary hash maps (`node = {"data": 2.0, "grad": 0.0}`) invites silent typo bugs: writing `node["graad"] = 1.0` silently creates a new key instead of updating the gradient.
2. **Object-oriented boilerplate:** Class definitions (`class Node: def __init__(self, ...): ...`) require constructor ceremonies that crowd narrow 40-column screens.
3. **Reference sharing requirement:** While Rank's arrays and tensors strictly follow Copy-on-Write value semantics (ADR-0101), data structures like DAG nodes and trees require **shared identity**—a gradient update on `Node .parent .grad += Change` must mutate the target node across all branches sharing that reference.

Rank needs a lightweight structured type that is safe against typos, ceremony-free, and explicitly carries reference identity.

## Decision

Rank introduces **`record` types** as closed, typed structures addressed via symbols:

```rank
Node = record
  .data = 2.0
  .grad = 0.0
  .op = .leaf
end
```

### 1. Symbol Field Addressing (Building on ADR-0105)
Fields are defined and addressed exclusively using Symbol literals (`.data`, `.grad`, `.op`):
```rank
Value = Node .data
Node .grad += 1.0
```

### 2. Closed Schema at Creation
A record schema is permanently closed once created:
- Field names cannot be repeated during declaration.
- Assignment **cannot add unknown fields**: attempting `Node .extra = 1` raises a static/runtime error. This completely prevents silent spelling mistakes.

### 3. Field Type Invariance (Building on ADR-0100)
Each field statically infers its type from its initial value (`.data = 2.0` infers `real`). Later direct or compound assignments must preserve that type; attempting to assign text to a numeric field is an error.

Array fields preserve rank and recursive cell types, not axis lengths. Integer
and real are distinct. An empty array fixes rank but leaves cell types undecided;
the first nonempty assignment fixes them, even if the field becomes empty later.
An established mixed-cell contract accepts subsets without narrowing itself.

Nested records preserve their complete field-name set and recursive field types.
Declaration order does not matter. Replacing a nested record compares established
schemas, so a separately created record with a narrower array-field contract is
not interchangeable with a wider one. Empty cell contracts may still be refined.
These checks apply through aliases and function calls. Failed validation does not
install a partial replacement contract.

Checking array cells can evaluate lazy callbacks. Absent table cells contribute
no type. Callback side effects are not rolled back when validation fails.
Static analysis preserves proven field types and ranks but drops mutable axis
lengths and read-safety facts; runtime checks cover cases it cannot prove.

### 4. Reference Identity Semantics (ADR-0101 Exception)
Records are part of the deliberate, closed list of reference types (ADR-0101):
- Assignment (`B = Node`) and argument passing share the record instance.
- Mutations through one name are immediately visible through all aliases:
  ```rank
  Node .parent .grad += Change
  ```
  This is critical for autograd graphs, Disjoint-Set Union (DSU), and tree representations.

### 5. Functional Update with a `with` Block
Because records share identity, deriving a new state from an old one (search nodes, game states, simulations) must not mutate the original. A `with` block makes a shallow copy and changes only the listed fields:
```rank
Next = State with
  .mana -= 53
  .boss -= 4
  .spent += 53
end
```
- Each line uses `=` or any compound assignment operator; compound operators read the source record's value.
- The field rules of assignment still hold: no unknown fields, no repeated fields, no type change.
- The copy is shallow. Arrays inside keep copy-on-write value semantics; nested records stay shared.
- The copy retains the source's established contracts, including cell types of currently empty arrays.
- Only the block form exists. An inline form (`State with .mana -= 53 .boss -= 4`) was rejected: a field value such as `Mana - 53 .boss` cannot be told apart from a field read without extra lookahead, and the block mirrors `record ... end`.
- `with` is a contextual keyword: it still works as a name, as in `reduce with`.

### 6. Clear Tripartite Distinction
Rank strictly differentiates between three data-mapping structures:
1. **`record`:** Statically closed schema, symbol keys (`.field`), typed fields, reference identity.
2. **`object`:** Dynamic JSON-compatible key-value maps with string keys (`"key"`).
3. **`index`:** Sparse associative arrays that accept arbitrary and tuple keys.

### Function return schemas

One function specialization must return records with the same field names and
recursive field types. Returning a leaf record and a branch record with different
fields is an error. Use one tagged schema with same-typed fields on both paths,
or separate the functions. Array lengths may vary within that schema.

Record argument schemas distinguish specializations; record identity, field order
and array lengths do not. See [ADR-0302](0302-function-declarations-closures-and-tail-calls.md).

## Consequences

### Positive
* **Typo safety:** Closed schema prevents accidental property creation.
* **Zero class boilerplate:** No `class`, `constructor`, `self`, or `this` keywords needed.
* **Autograd and graph friendly:** Shared reference semantics allow natural graph algorithms without pointer gymnastics.
* **Predictable types:** Field types cannot drift or become corrupted during computation.
* **Cheap state transitions:** `State with ... end` names only the fields that change, so records replace positional state arrays.

### Negative & Trade-offs
* **Mutable reference discipline:** Because records share state, developers must exercise care when mutating records stored in sets or memoization caches.
* **Validation cost:** Establishing and checking array field contracts reads their cells, including lazy cells. Work grows with the values inspected.

## References
* Section "Record types" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* ADR-0100: [Inferred Type Stability and Invariant Variable Binding](0100-inferred-type-stability-and-invariance.md)
* ADR-0101: [Value Semantics with Copy-on-Write for Arrays and Tensors](0101-value-semantics-and-copy-on-write.md)
* ADR-0105: [Symbol Scalars for Labels, Enums, Fields, and Type Tags](0105-symbol-scalars-for-labels-and-enums.md)
* Initial commit `f8ef89b` (2026-09-08)
* Issue #8: functional record update (2026-09-26)
* Issue #32: recursive record field and return contracts (2026-09-28)
* [Runtime contract tests](../../../packages/interpreter/test/record-contracts.test.ts)
