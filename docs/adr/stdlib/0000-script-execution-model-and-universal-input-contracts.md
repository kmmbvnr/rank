# 0000. Script Execution Model and Universal Input Contracts (use cli)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Modules and Programs Specification, CLI Test Suite

## Context

Most programming languages split script execution and CLI parsing into two disjoint paradigms:
1. **Ceremonial entry points (`main`):** Systems languages (C, Rust, Java) require wrapping code in a boilerplate `main(argc, argv)` function and manually parsing string arrays into typed variables.
2. **Ad-hoc CLI argument libraries:** In Python (`argparse`, `click`) or Node.js (`yargs`, `commander`), declaring command-line flags requires complex API calls, callback registrations, and repetitive schema definitions that consume dozens of lines—untenable on narrow 40-column screens (ADR-0000).
3. **Friction in embedded or testing environments:** When a script is called from another script, a testing harness, or a mobile notebook/REPL, passing inputs through synthetic string arrays (`argv = ["--limit", "10"]`) is clumsy, error-prone, and bypasses native in-memory data structures.

Rank requires a unified execution and input model: a program should run as a clean, sequential script without `main()`, declare inputs declaratively with primary keyboard words, and accept inputs transparently from the terminal, a parent workspace, or a host embedding.

## Decision

Rank establishes the **Script Execution Model with Universal Input Contracts via `use cli`**:

```rank
use cli

rem Upper boundary for summation, excluded.
option Limit integer = 1000

rem Positional input file path.
argument Input path

rem Optional boolean flag.
flag Verbose = false
```

### 1. No `main()` Function: Sequential Top-Level Execution
- A Rank program is a sequence of top-level statements that executes from top to bottom.
- Running a file from the host terminal (`rank solution.ra`) executes its top-level statements directly.
- Helper functions declared with `fun` or `memo` are hoisted (ADR-0302) and can be placed at the bottom of the file without requiring forward declarations.

### 2. Declarative Input Contracts (`option`, `argument`, `flag`)
Program inputs are declared as first-class statements guarded by `use cli`:
- `option Name Type [= Default]`: Declares a named option (maps to `--limit 10` on CLI or `Limit = 10` in workspace).
- `argument Name Type [many] [= Default]`: Declares a positional argument. The `many` keyword collects remaining or repeated inputs into a rank-1 sequence.
- `flag Name [= Boolean]`: Declares a boolean toggle (defaulting to `false` if omitted).
- `path`: An input constraint validated as a valid file/directory path and represented as `text`.
- **Automatic help text:** Contiguous `rem` lines immediately preceding an input declaration serve as its canonical documentation in `--help` output.

### 3. Strict Input Resolution Precedence
Rank enforces one universal precedence order across all environments:
$$\text{workspace} \longrightarrow \text{args} \longrightarrow \text{default}$$

1. **Workspace:** If a caller sets `Limit = 500` in the current workspace, that value takes top priority. This allows callers and tests to inject in-memory values directly.
2. **Args:** If not in the workspace, values supplied via CLI flags or the `args` statement (`args "--limit" "500"`) are used.
3. **Default:** If neither is provided, the declared default expression is evaluated. If an input has no default and was not provided, execution halts with a clear error before statements run.

### 4. Early Type Validation
All inputs are validated against their declared types (`integer`, `real`, `text`, `path`, `boolean`) **before any program statement executes**. Malformed input fails fast with diagnostic reporting, guaranteeing that program logic only encounters typed, valid values.

### 5. Programmatic Execution (`use "file"`, `run`)
- `use "worker"` loads a source file, registering its functions in the current workspace without running its top-level executable statements.
- `use "worker" as W` namespaces the imported file under an alias (`W.Limit = 100`, `W.solve`).
- `run` (or `run "worker"`) transfers execution to the target program's top-level statements, returning to the caller when complete.

## Consequences

### Positive
* **Zero ceremony:** No `def main(argv):` boilerplate; programs begin executing immediately.
* **40-column readability:** Input declarations (`option Limit integer = 1000`) are concise, self-documenting, and fit on a single line.
* **Universal adapter:** The exact same script can be driven from the command line, imported as a library module, or exercised inside an automated test suite without modifying a single line of code.
* **Automatic documentation:** Preceding `rem` comments generate clean CLI help messages automatically.

### Negative / Trade-offs
* **Requires `use cli`:** Programs that declare CLI options or read command-line arguments must explicitly declare `use cli`.
