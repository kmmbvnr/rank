# Deep-ML

Linear algebra, statistics and machine-learning exercises from [Deep-ML](https://www.deep-ml.com/).

In problems 1–20, ordinary bindings retain reused data and writable numerical
state. Apostrophe bindings preserve one-use column selections, dot products,
transpose views, gradient stages and masks until their consumer. The
`scalar_multiply` helper accepts a deferred matrix; iterative solvers retain
their state, and PCA retains a writable copy before fixing eigenvector signs.

Problems 21–40 retain softmax exponentials, shuffled orders and training state
when several consumers need them. Sigmoid and diagonal helpers accept deferred
inputs. Correlation, masks and dense-layer gradient expressions use plans;
record updates and autograd tape mutations still execute on computed values.

Problems 41–55 keep convolution windows, attention views and temporary gradient
expressions deferred. Optimizers retain weights and accumulated moments; each
RNN step completes its hidden state. RREF, Lasso and string-alignment working
arrays remain writable computed values.
