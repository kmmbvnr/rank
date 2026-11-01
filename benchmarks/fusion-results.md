# General fusion pipeline investigation

Baseline is main `51362d77`. Demo sources are unchanged. Work is isolated in
`perf/fusion-pipelines`; unrelated prime/Euler changes are excluded.
The harness checks independent JS oracles and forces all output cells.
Timings use alternating fresh processes, >=1 s warmup and three target
300 ms batches, without concurrent tests or profiles.

## Initial audit

Counters record completed typed buffer publications and cells through the
exclusive-ownership `typedArray` API. They are not total allocations or peak
memory: private scratch, boxed results and shared views are excluded.
Inputs are created before the diagnostic scope.

| Case | Compiled tensor runs | Published typed buffers | Published cells |
| --- | ---: | ---: | ---: |
| kmeans | 1024 | 2057 | 6152 |
| convolution | 0 | 0 | 0 |
| softmax | 1 | 2 | 8192 |
| logsoftmax | 0 | 4 | 16384 |
| gradient | 8 | 32 | 4224 |
| distance | 1 | 1 | 4096 |

K-means already combines square/sum; the earlier ordinary difference binding
remains a completion boundary. Conv2D performs 13,068 derived-cell
computations and no tensor kernels: native window addressing is opaque to
the graph lowerer. Softmax retains Exps for two consumers; removing it
blindly would repeat exp. Log-softmax publishes four 4,096-cell buffers.
Gradient descent already runs eight tensor kernels. Start with window
addressing, then inspect the next actual boundary.

[Initial evidence](baselines/2026-11-01-fusion-initial-audit.json).
