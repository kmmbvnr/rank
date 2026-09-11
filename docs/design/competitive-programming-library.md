# Competitive-programming library roadmap

Rank adds an algorithmic structure when real solutions need it and ordinary
Rank code cannot meet judge limits. A passing small example is not enough. Each
addition needs a judge-scale benchmark and at least one complete problem.

The public form should reuse functions, modifiers and addressing before adding
grammar. Internal implementations may use specialized storage and native loops.

## Current base

The current library has heaps, ordered multisets, Fenwick trees, segment trees,
disjoint-set unions and graph algorithms. Arrays and deques already cover many
techniques that other contest libraries expose as separate types.

## Segment-tree extensions

These extend the current `segment` value instead of creating unrelated trees:

- **tree search** finds the first or last position where a prefix predicate
  changes. AtCoder calls these operations `max_right` and `min_left`. Hotel
  Queries and order-statistic selection are the first tests for the Rank form;
- **lazy range updates** apply one update to a complete interval while keeping
  range aggregates. Range Updates and Sums and Polynomial Queries should settle
  the update syntax;
- **persistent versions** share unchanged nodes between copies. Range Queries
  and Copies should settle ownership and version addressing.

Each extension needs its own evidence. Point updates do not require the lazy or
persistent machinery.

## Other candidates

| Structure | Problems it makes direct | Question to settle first |
| --- | --- | --- |
| Sparse table | immutable idempotent range queries | Is O(1) query faster than `segment` after construction cost? |
| Dynamic bitset | subset DP, reachability, dense graph sets | Can boolean arrays expose the same word-level speed without a new type? |
| Wavelet matrix | range rank, count and kth queries | Which two operations form a small readable API? |
| Rollback DSU | offline dynamic connectivity | How are snapshots represented without exposing an undo log? |
| Binary or xor trie | prefix lookup and maximum-xor queries | Can text tries and integer-bit tries share a useful model? |
| Li Chao tree | minimum or maximum line queries | What numeric domain and overflow rules does it promise? |
| Disjoint sparse table | static associative range queries | Does it beat the simpler segment tree on Rank workloads? |

An ordered-statistics tree is not listed separately yet. Rank multisets already
support sorted indexing, lower bounds and duplicates. A new type needs a task
that this interface cannot solve efficiently.

## Admission checks

A candidate enters `use algo` only after all of these checks:

1. A maintained demo needs the operation at official constraints.
2. Existing arrays or collections either cannot express it or miss the time or
   memory limit by a measured margin.
3. The Rank program becomes shorter and keeps the algorithm visible.
4. Unit tests cover semantics, errors, shadowing and composition.
5. A judge-scale benchmark protects the performance reason for adding it.

## References

- [AtCoder Library](https://atcoder.github.io/ac-library/production/document_en/index.html)
  provides Fenwick, segment and lazy segment trees with contest-focused APIs.
- [KACTL](https://github.com/kth-competitive-programming/kactl) is a compact
  ICPC reference whose structures are selected for usefulness, speed and test
  coverage.
- [ac-library-rs](https://github.com/rust-lang-ja/ac-library-rs) shows how the
  AtCoder abstractions map to a language with explicit traits and monoids.
