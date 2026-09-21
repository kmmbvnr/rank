# 0102. Transparent SQLite Views and Query Translation (use tables)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Tables Specification, SQLite Translation Engine

## Context

SQLite is the most deployed database engine in the world, embedded natively across mobile operating systems (Android, iOS), local developer workstations, and edge devices.

However, interacting with SQLite from dynamic languages typically requires:
1. **Raw SQL string queries:** Developers write error-prone raw SQL strings (`db.execute("SELECT * FROM ...")`), which lack compile-time checking, require manual string concatenation for dynamic filters, and invite SQL injection vulnerabilities if parameters are improperly handled.
2. **Eager row materialization:** Many database adapters fetch entire result sets into memory before downstream filtering, exhausting RAM on resource-constrained mobile devices.
3. **Heavy ORM abstraction layers:** Full-featured ORMs introduce thousands of lines of schema boilerplate, complex configuration files, and heavy runtime overhead that conflict with lightweight scripting.

Rank requires a database integration where SQLite tables look and behave identically to native Rank tables, construct queries lazily, prevent SQL injection by design, and inspect query plans directly from the language.

## Decision

Rank establishes **Transparent SQLite Views with Deferred Execution and SQL Translation via `use tables`**:

```rank
use tables

Db = "club.sqlite3" sqlite
Facilities = Db .facilities
Filtered = Facilities filter .membercost greater 0
Statement = Filtered sql
Rows = Filtered array
```

### 1. Lazy SQLite Table Views
- `Db = "path.sqlite3" sqlite`: Opens an existing SQLite database file.
- `Db .facilities`: Validates table existence against the SQLite catalog and returns a **lazy SQLite-backed view** without reading any rows from disk.
- Operations applied to the view (`filter`, projection, `sort by`, `innerjoin`, `leftjoin`, `from ... until`) **extend the abstract SQL query plan** rather than executing queries eagerly.

### 2. Pushdown Aggregations and Slicing
Common analytical operations compile directly to native SQL primitives:
- `View len` translates to `SELECT COUNT(*) FROM ...`
- `View .cost sum` translates to `SELECT SUM(cost) FROM ...`
- `View from 0 until 10` translates to `LIMIT 10 OFFSET 0`
- Relational joins translate directly to SQL `JOIN` clauses.
- Data is processed directly inside SQLite's optimized C engine, transferring only necessary results into memory.

### 3. Transparent Execution via Materialization (`array`)
- A SQLite view remains lazy until an explicit demand point is reached.
- Postfix `array` executes the compiled SQL statement and returns a rank-1 array of object rows:
  ```rank
  Rows = Filtered array
  ```
- Terminal operations like CSV export (`Filtered "out.csv" csv`) or printing execute the query stream directly.
- SQL `NULL` values become absent fields (ADR-0100), integrating seamlessly with Rank's `default` keyword.

### 4. First-Class Plan Inspection (`sql`, `explain`)
Rank allows developers to inspect generated SQL and execution plans programmatically without third-party tooling:
- `Query = View sql`: Returns a record containing `.text` (parameterized SQL with `?` placeholders) and `.params` (ordered array of bound values).
- `Plan = View explain`: Executes `EXPLAIN QUERY PLAN` inside SQLite and returns an ordinary Rank table of query plan steps.

### 5. Injection-Proof Parameter Binding
- Literals and expressions evaluated in Rank filters or assignments are **always bound as positional parameters** (`?`) via SQLite's native C API.
- Values are never interpolated into SQL text strings, making SQL injection structurally impossible.

### 6. Declarative Mutations with Dry-Run Previews
Direct updates, inserts, and deletions operate on base table views and return the count of affected rows:
```rank
Db .facilities insert NewFacility
Target = Db .facilities filter .facid equal 1
Target update
  .initialoutlay = 10000
end
Target delete
```
- **Dry-run previews:** Prefixing any write with `sql` or `explain` (`Statement = sql Target delete`) returns the compiled SQL statement or plan without executing the write.

### 7. Direct SQL Fallback (`sqlquery`)
For queries that cannot yet be expressed via Rank table syntax (e.g. specialized PRAGMAs or custom CTEs), `sqlquery` provides safe parameter-bound SQL execution:
```rank
Result = Db "SELECT * FROM t WHERE id = ?" (array TargetId) sqlquery
Rows = Result array
```

## Consequences

### Positive
* **Zero impedance mismatch:** Querying a SQLite database uses the exact same syntax (`Data .Age`, `filter`, `sort by`) as in-memory Rank arrays.
* **Minimal memory footprint:** Slicing and aggregation happen in-engine via SQL pushdown, avoiding loading unused rows into memory.
* **Built-in safety:** Native parameterized binding eliminates SQL injection risks.
* **Inspectability:** `sql` and `explain` let developers view and optimize generated queries directly in the REPL.

### Negative / Trade-offs
* **Subsetting restrictions:** Certain advanced tensor operations cannot be pushed down into SQLite and require materializing rows into arrays via `array` first.
