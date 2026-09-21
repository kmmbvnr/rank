# 0100. Columnar Table Model and Record-Row Addressing (use tables)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Tables Specification, CSV and Table Test Suite

## Context

Data analysis workflows in mainstream ecosystems (Python/Pandas, R, Julia) suffer from fragmented dataframe abstractions:
1. **API fragmentation and confusing indexing:** Pandas alone has multiple conflicting addressing interfaces (`df['col']`, `df.col`, `df.loc[:, 'col']`, `df.iloc[:, 0]`), creating steep learning curves and cognitive friction on mobile screens.
2. **Missing data poisoning (`NaN` / `null`):** Traditional dataframes represent missing cells using sentinel floats (`NaN`), `None`, or `NA`. These sentinel values silently poison downstream arithmetic, coerce integers into floats, and require defensive checking (`df.fillna()`, `df.dropna()`).
3. **High memory overhead of ad-hoc row objects:** Dataframes frequently decouple column-oriented storage from row-oriented iterative access, making row-by-row iteration notoriously slow and error-prone.

Rank requires a unified tabular data model that reuses Rank's universal addressing equation ($\text{value} + \text{selector} \rightarrow \text{value}$, ADR-0202), integrates symbol scalars (`.Column`, ADR-0105), and eliminates `null` poisoning via the universal `default` keyword (ADR-0107).

## Decision

Rank establishes the **Columnar Table Model with Record-Row Addressing via `use tables`**:

```rank
use tables

Data = "titanic.csv" csv
Ages = Data .Age default 0
```

### 1. Unified Addressing for Columns and Subsets
Tables adhere strictly to Rank's core addressing model:
- **Single column projection:** Applying a symbol selector extracts that column as a lazy rank-1 array:
  ```rank
  Ages = Data .Age
  ```
- **Multi-column projection:** Applying an array of symbols extracts a sub-table with only the requested columns in array order:
  ```rank
  Features = Data (array .Age .Fare .Pclass)
  ```
- **Row indexing:** Integer addressing (`Data 0`) extracts the individual row object.
- **Row filtering via boolean masks:** Applying a boolean mask filters matching rows without syntax changes:
  ```rank
  Adults = Data (Data .Age at least 18)
  ```

### 2. Absent Fields Instead of `null` Poisoning
- A missing cell in a CSV file or table row is **absent** rather than represented by a toxic `null` or `NaN` sentinel.
- Demanding an absent cell raises `.Missing`, which composes directly with Rank's core `default` keyword:
  ```rank
  CleanAge = Data .Age default Median
  ```
- This completely prevents silent arithmetic poisoning: arithmetic on missing data without `default` fails fast, while `default` provides clean, explicit fallbacks.

### 3. Transparent CSV Serialization
Tabular I/O uses symmetrical postfix operations:
- **Reading CSV:** `"dataset.csv" csv` reads UTF-8 comma-separated files with headers, inferring uniform types (`integer`, `real`, `boolean`, `text`) for each column based on non-empty cells.
- **Writing CSV:** `Table "output.csv" csv` serializes row objects, quoting text fields where necessary and emitting empty cells for absent values.

### 4. CoW Revision Tracking and Invalidation
- A table maintains a single observable revision counter.
- Updating a row or mutating a column increments the table's revision, safely invalidating any dependent cached column views or downstream tensor expressions.

## Consequences

### Positive
* **Zero new syntax:** Reuses Rank's existing whitespace juxtaposition (`Data .Age`, `Data Mask`) without introducing dataframe-specific methods like `.loc[]` or `.iloc[]`.
* **No `null` / `NaN` bugs:** Missing data is handled safely through universal `.Missing` and `default`.
* **40-column compactness:** Table loading, cleaning, and projection fit comfortably into single lines on narrow screens.
* **Dual row-column efficiency:** Tables can be traversed by row objects or projected into flat column vectors for tensor computations.

### Negative / Trade-offs
* **Whole-table cache invalidation:** Mutating one column conservatively invalidates derived column caches across the whole table rather than tracking per-column versioning.
