# Dyalog Programming Competition 2011

Rank examples based on tasks from the 2011 programming competition from [Dyalog](https://www.dyalog.com/).

- [Take To The Air](001_air.ra): weighted flight records, bounded trips without
  repeated airports, and great-circle segment totals. Run with
  `rank demos/dyalog/2011/001_air.ra --max-stops 2`.
- [What's in a Name?](002_names.ra): letter noise and approximate text matching.

- [It's All About Image](003_image.ra): packed RGB conversion, row and column
  replication, wrapped convolution, and Gaussian kernels. The six functions
  can be imported with `use "003_image"`; run the examples with
  `rank test demos/dyalog/2011/003_image_test.ra`.

- [Genes](004_genes.ra): nucleotide frequency matrices, natural-log position
  weights, sliding motif scores, and the five best subsequences. Run with
  `rank demos/dyalog/2011/004_genes.ra`, or verify the contest examples with
  `rank test demos/dyalog/2011/004_genes_test.ra`.

The Genes demo implements [Problem 4 of the contest](https://www.dyalog.com/uploads/files/student_competition/2011_problems.pdf)
with `freqMat`, `makePWM`, `score`, and `top5`. Training cells are individual
`A/C/G/T` characters in an M by N matrix. Frequency and weight matrices are
4 by N, with rows ordered A, C, G, T. Weights use natural logarithms after
adding one to every count and normalizing each column; weights and scores
retain their full precision. Scores follow the overlapping windows in source
order. `top5` returns a 5 by N character matrix, preserving earlier positions
on ties and retaining duplicate subsequences. Its input has at least N+4
characters. Import the functions with `use "004_genes"`; `run` evaluates the
published sample data and prints the matrices and results.

The image functions follow [Problem 3 of the contest](https://www.dyalog.com/uploads/files/student_competition/2011_problems.pdf).
RGB is `65536 * red + 256 * green + blue`; channel planes have shape `3 H W`.
Grayscale conversion preserves the input shape. Byte quantization uses
nearest-even rounding. Scaling factors are vertical then horizontal: zero
makes that output axis empty, and negative factors raise an error.

Convolution requires odd positive kernel dimensions and keeps the kernel's
orientation. It wraps at borders, divides weights by their sum when positive
(or by one otherwise), and clamps each channel to `[0,1]`. RGB filtering uses
the same rule independently on each channel. Gaussian kernels have radius
`ceil(3 * Sigma)` for positive finite Sigma and are normalized to sum to one.
This discrete normalization differs slightly from the contest's continuous
Gaussian formula: at Sigma 1 the center is about `0.15924` rather than
`0.15915`. Convolution normalizes either kernel by its sum.
