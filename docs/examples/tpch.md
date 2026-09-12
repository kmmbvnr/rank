# TPC-H examples

TPC-H is a stress test for Rank's relational and analytical data model.
It is the third collection in the [SQL challenge roadmap](sql-challenges.md),
after PostgreSQL Exercises and SQL Murder Mystery.

It complements the other problem suites:
- LeetCode tests the algorithmic core;
- Project Euler tests numeric and sequence programming;
- Kaggle tests data processing and ML;
- TPC-H tests relational analytics.

The first runnable SQLite example is
[Q6](../../demos/tpch/001_q6_sqlite.ra). It keeps filtering and the revenue
calculation in SQLite while using Rank's ordinary table operations. The
database belongs in the ignored `demos/tpch/data/` directory.

## Q6. Forecasting Revenue Change

The [earlier draft](../../demos/tpch/001_q6_revchange.md) used a `filter`
clause that is not current Rank syntax. The runnable version uses first-class
boolean masks and explicit date bounds:

```rank
Lineitem = Db .lineitem
YearRows = Lineitem ((Lineitem .l_shipdate at least "1994-01-01") and (Lineitem .l_shipdate less "1995-01-01"))
Discounted = YearRows ((YearRows .l_discount at least 0.05) and (YearRows .l_discount at most 0.07))
Limited = Discounted (Discounted .l_quantity less 24)
Revenue = (Limited .l_extendedprice * Limited .l_discount) sum
```

The [CLI test](../../packages/cli/test/sqlite.test.mjs) creates a small
SQLite `lineitem` table and compares the Rank result with reference SQL.
