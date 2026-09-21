# 0101. Declarative Table Query Pipeline (select, filter, joins)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Tables Specification, Relational Query Design

## Context

Relational data transformation (filtering, projecting, joining, aggregating) is ubiquitous in data processing. However, conventional programming languages handle relational queries poorly:
1. **Raw SQL string embedding:** Embedding SQL strings (`cursor.execute("SELECT * FROM ...")`) loses syntax highlighting, compile-time validation, and composability, while opening vulnerabilities to injection if string interpolation is used.
2. **Heavy ORM and fluent DSL cascades:** Libraries like dplyr (R), LINQ (C#), or PySpark require long chains of method calls with lambda parameters (`.filter(row => row.age > 18).groupBy(...)`) that easily exceed the 40-column mobile screen budget (ADR-0000).
3. **Impedance mismatch between in-memory arrays and databases:** In-memory collections and database tables usually have completely different query APIs, forcing developers to rewrite logic when switching data backends.

Rank needs a declarative, syntax-checked query pipeline that looks like native Rank code, avoids raw SQL strings, and executes identically over both in-memory array tables and SQL databases.

## Decision

Rank establishes the **Declarative Table Query Pipeline via `use tables`**:

```rank
use tables

Sums = Bookings select
  .memid = .memid
  .total = .cost sum
end
```

### 1. The `select ... end` Block
- `select` constructs a new table schema in declaration order.
- Inside the block, `.field = expression` declares an output column.
- Local intermediate variables can be declared within the block to simplify complex column expressions:
  ```rank
  Out = Data select
    Base = .price * (1 - .discount)
    .final_price = Base + .tax
  end
  ```
- Window functions `rownumber` (1-based row index) and `ranknumber` (1-based rank handling ties) are first-class keywords inside `select` blocks.

### 2. Concise Filtering (`filter`)
- Single-line filtering:
  ```rank
  Active = Users filter .status equal .active and .age at least 18
  ```
- Multiline filtering blocks for complex composite predicates:
  ```rank
  Eligible = Members filter
    .id greater 0
    .status equal .active
  end
  ```
- The leading subject is implicitly the current row, eliminating repetitive `Row.` prefixes.

### 3. High-Level Joins (`innerjoin`, `leftjoin`)
Rank provides declarative join operations that avoid SQL boilerplate:
- **Join by matching key:**
  ```rank
  Joined = Bookings Members innerjoin by .memid
  ```
- **Join on explicit field conditions:**
  ```rank
  Matches = Left Right leftjoin on .source equal .target
  ```
- **Role Aliasing for Self-Joins (`alias`):**
  When joining a table with itself, each role is given a symbolic alias (`.alias`):
  ```rank
  M = Members alias .m
  R = Members alias .r
  Hierarchy = M R leftjoin on .recommender equal .memid
  ```
  Result rows preserve namespaced nested paths (`Hierarchy .m .name`, `Hierarchy .r .name`) without name collisions.

### 4. Grouping and Aggregation (`group by`, `rollup by`)
- `Table group by .field` segments rows into groups.
- `Table rollup by .field` generates hierarchical subtotals and rollups.
- Aggregations (`sum`, `count`, `min`, `max`, `mean`) inside a following `select` block automatically aggregate per group.

### 5. Directed Graph Traversal (`reach by`)
- Transitive reachability over relational edge tables is expressed declaratively:
  ```rank
  Reachable = Edges Starts reach by .source .target
  ```
- Finds all nodes reachable from `Starts` along directed edges without imperative BFS/DFS loops.

## Consequences

### Positive
* **Syntax-checked queries:** Queries are parsed and validated by Rank's Langium compiler at edit time, catching typos in field names and operations immediately.
* **40-column vertical layout:** `select ... end` and `filter` blocks align cleanly to 2-space indentation on small mobile screens.
* **Zero lambda noise:** Field expressions (`.cost * 2`) implicitly bind to row fields without requiring anonymous closure syntax (`x => x.cost * 2`).
* **Backend transparency:** The exact same query pipeline executes in-memory over arrays or translates to native SQL over SQLite databases.

### Negative / Trade-offs
* **Vocabulary expansion:** Introduces domain-specific contextual keywords (`select`, `filter`, `innerjoin by`, `leftjoin on`, `rollup by`, `rownumber`, `ranknumber`) under the `tables` module.
