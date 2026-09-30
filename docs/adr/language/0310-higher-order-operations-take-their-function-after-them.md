# 0310. Higher-Order Operations Take Their Function After Them

* **Status:** Accepted
* **Date:** 2026-09-30
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, ADR-0301 (data-first calling convention), issue #24

## Context

`scan`, `reduce`, `segment` and `outer` used to follow the function they apply, as in APL (`+\`, `+/`, `∘.×`): `A + scan with 0`, `A B * outer`, `Steps next scan`. Every other operation in Rank puts its parameters on the right: `sort by .field`, `json .flat`, `A F rank 0`, `M sum axis 0`, `scan with 0`. The combining function of a scan is a parameter of the scan, not the operation being called. The old order also made `(Start + Flow) + scan` read as if the scan applied to the right operand only.

## Decision

The function is the first word or symbol after the operation:

| Before | After |
|---|---|
| `A + scan with 0` | `A scan + with 0` |
| `A + reduce with 0` | `A reduce + with 0` |
| `A + segment` | `A segment +` |
| `A B * outer` | `A B outer *` |
| `Steps next scan with Start` | `Steps scan next with Start` |

* `rank` and `axis` are call parameters of the function they follow and do not move.
* An operator symbol directly after one of the four words is its argument, never an infix operator. The lexer joins the pair into one token, so the grammar needs no lookahead; grouping turns it into the call form the runtime and analysis already share.
* A named function follows the operation the same way (`scan next`). `Steps scan next` is therefore no longer a pipeline; a following call goes after `with` or takes parentheses. There is no `by` keyword, so there is one spelling for symbols and names.
* The operation takes the whole expression on its left, as before: `Start + Y scan +` scans `Start + Y`.
* The old order is an error that names the new spelling. There is no deprecation period: Rank is pre-alpha, and every demo, test and document was rewritten mechanically.
* If a program binds `scan`, `reduce`, `segment` or `outer`, the name form follows the binding, and the joined symbol form is rejected.

## Consequences

* Value facts and the interpreter see the same AST as before, so only grouping changed.
* Prefix-sum idioms and APL ordering are given up for consistency with the other trailing parameters.
* `reduce` still takes symbols only; a named reducer is not part of this change.
