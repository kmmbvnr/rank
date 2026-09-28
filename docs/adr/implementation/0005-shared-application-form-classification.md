# 0005. Shared Application Form Classification

* **Status:** Accepted
* **Date:** 2026-09-28
* **Deciders:** @kmmbvnr
* **Issue:** [#36](https://github.com/kmmbvnr/rank/issues/36)

## Context

Runtime execution, abstract interpretation and modifier grouping recognized
overlapping application syntax independently. A new form could reach execution
without an analysis case, and several runtime recognizers matched operation
spellings without checking bindings.

## Decision

`language/application-forms.ts` owns `applicationForm` and its discriminated
`ApplicationForm` union. It recognizes existing application and symbolic
modifier forms through a binding lookup. Builtin aliases carry catalogue
identity. A user function does not acquire builtin behavior from its spelling.
Receiver methods retain their contextual interpretation.

The classifier preserves recognition order. Invalid literal syntax produces an
`invalid` form with a diagnostic; it does not evaluate user code or array cells.
Axis bounds against an actual shape remain runtime checks. Binary modifier
forms retain their source, operator and optional seed independently of how the
source text spells the application.

The interpreter and application-fact transfer dispatch with exhaustive switches
ending in `assertNever`. Unsupported abstract transfers return an explicit
unknown. Runtime handlers keep evaluation and module checks. A cached handler
is reused only while the relevant binding identities still match.

Available builtin names cannot be redefined by Rank source; the rule is defined
in [language ADR-0003](../language/0003-modular-vocabulary-and-grammar-independence.md).
This removes local core-name overrides from specialization checks. Host-injected
values still require identity guards, and receiver methods still require type
dispatch. Neither mechanism is removed by the source binding rule.

## Verification

- `npm run check:semantic-boundaries` rejects AST form recognizers outside
  `language` and checks dependency direction among semantic owners.
- `npm run check:application-forms` injects a fake form into an in-memory
  compiler input. Both runtime and analysis must fail compilation at their
  exhaustive dispatches. It does not edit the checkout.
- The same check prototypes `A scan + with 0` in an isolated classifier module.
  Existing runtime and analysis handlers consume its descriptor unchanged.
  Production syntax remains `A + scan with 0`; #24 remains a separate decision.
- Language and runtime application-form tests cover literal validation,
  builtin aliases, contextual methods and changing alias identities.

## Consequences

A new form requires a classifier case and a visible decision in each consumer.
Adding syntax that maps to an existing form needs no new execution or analysis
handler. Unknown analysis remains conservative rather than blocking execution.
The classifier does not replace operation-specific value or safety proofs.
