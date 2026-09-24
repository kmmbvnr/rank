# TidyTuesday R Demos

Data science and tabular analysis benchmarks based on the weekly [TidyTuesday](https://github.com/rfordatascience/tidytuesday) project from the R community.

## Available Demos

- **`001_africa.ra`**: Languages of Africa dataset analysis, aggregating families, spoken languages by country, and multi-country languages.
- **`003_brazil.ra`**: Brazilian Companies dataset statistics using the `stats` module, aggregating capital stock metrics (`mean`, `median`, `std`, `variance`, `skewness`, `quantile`) by legal nature, company size, and owner qualification.

## Running Demos & Tests

Run a demo solution:
```bash
node packages/cli/bin/cli.js demos/tidytuesday/003_brazil.ra
```

Run test suites:
```bash
node packages/cli/bin/cli.js test demos/tidytuesday/003_brazil_test.ra
```
