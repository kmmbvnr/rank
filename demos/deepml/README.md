# Deep-ML

Linear algebra, statistics and machine-learning exercises from [Deep-ML](https://www.deep-ml.com/).

In problems 1–20, ordinary bindings retain reused data and writable numerical
state. Apostrophe bindings preserve one-use column selections, dot products,
transpose views, gradient stages and masks until their consumer. The
`scalar_multiply` helper accepts a deferred matrix; iterative solvers retain
their state, and PCA retains a writable copy before fixing eigenvector signs.
