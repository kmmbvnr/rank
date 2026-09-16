# R data-analysis roadmap

The goal is not R compatibility. Rank should be able to express a small data
analysis script clearly with `use tables`, `use stats`, `use dates` and related
modules, while keeping its own array, type and addressing model.

This is a design roadmap, not a language specification. Names below are
examples unless current documentation defines them.

## Current base

Rank already has several foundations needed for data analysis:

- arrays, boolean addressing, shape-aware broadcasting, `axis` and `rank`;
- table `select`, `filter`, `sort by`, `group by`, joins and SQLite-backed
  table views;
- table-cell absence with `default`, plus missing table cells skipped by
  `mean`, `median` and `std`;
- `mean`, `median`, population `std`, sample `covariance`, `mse`, `mae`,
  seeded sampling and uniform random tensors;
- text operations and regex matching; and
- calendar `date` and local `datetime` values.

These are not R compatibility claims. They are the base to test against real
data-analysis tasks.

## First design questions

### Missing values

Absent table fields are useful, but they do not yet define a general missing
value for arrays and scalar data. A design must keep missing distinct from
`0`, `false`, empty text and `NaN`, and settle propagation, comparisons,
boolean masks, reductions, serialization and conversion at table boundaries.

Possible source is illustrative only:

```rank
Values = array 1 2 missing 4
Average = Values mean skip missing
Mask = Values missing
```

The design must also decide whether skipping is an explicit reduction modifier
or the default only for projected table columns.

### Categorical values

R factors combine stored values with a finite set of levels. Rank needs a
clearer categorical value rather than copying factor semantics. It should
support known levels, stable grouping and an explicit path to `onehot` for ML.

Questions to settle include inference during CSV import, ordering, missing
levels, display, serialization and whether a categorical array stays
homogeneous.

### Tables and grouped summaries

Rank has `group by` and joins, but it needs a task corpus before adding a
larger data-frame vocabulary. Repeated task failures may justify compact forms
for multiple grouped aggregates, group transforms, renaming, distinct rows and
long-to-wide or wide-to-long reshaping.

Do not import `dplyr` names by default. Each operation should fit Rank's
existing data-first application and addressing rules.

## Library layers

### Statistics and distributions

The next statistics layer includes variance, quantiles, correlation and a
consistent choice of sample or population behavior. Probability distributions
need density, CDF, quantile and sampling operations with named parameters and
reproducible random state.

```rank
Q = Values 0.95 quantile
R = Left Right correlation
Noise = Shape 0 1 normal
```

Hypothesis tests, confidence intervals, regression and other statistical
models belong in `use stats` only after recurring scripts justify their
contracts. Formula syntax is deliberately out of scope: it would introduce a
second language inside Rank.

### Text, dates and interoperability

Data-cleaning tasks should decide the gaps in split, trim, replacement and
regular-expression operations. Dates already cover calendar dates and local
datetimes; time zones and parsing conventions need real tasks before they gain
more syntax.

CSV and JSON are current interchange formats. NumPy `.npy` is a likely next
numeric format. A data-analysis corpus may reveal whether other formats are
worth their complexity.

### Plots and rich results

Exploratory work needs visible output. The REPL already retains code and
results, but not plots. Test line plots, scatter plots, histograms and matrix
images against scripts before choosing names or block syntax. A plot should be
a Rank value with a documented data contract, even when each frontend renders
it differently.

## What Rank should not copy

Rank should retain strict, shape-aware broadcasting rather than R vector
recycling. Boolean addressing stays explicit instead of adopting R's mixed
positive, negative and logical indexing rules. Arrays, records, indexes and
tables remain separate value kinds rather than reproducing R's overlapping
vector, list and data-frame behavior.

Elementwise array operations, `reduce` and `scan` already cover much of the
need for R-style `apply` functions. Add a general map operation only if the
task corpus exposes a case that these forms cannot express clearly.

## Evidence and order

Use the R corpus in [Task corpora](task-corpora.md), beginning with 20 to 30
Exercism tasks. Record every failure as one of: missing library operation,
missing table or value semantic, unclear syntax, or missing environment
feature. A single exercise does not justify a primitive.

The provisional order is:

1. Specify general missing values and categorical values.
2. Use corpus evidence to improve grouped summaries and table reshaping.
3. Add recurring statistics and distribution operations.
4. Close text and date gaps that block data cleaning.
5. Render plot values in the REPL.

The corpus can change this order. The target is a small, coherent Rank data
analysis environment, not a partial reimplementation of R.
