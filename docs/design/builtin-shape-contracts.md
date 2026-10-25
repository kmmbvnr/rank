# Builtin shape contracts: migration audit

This records the implementation of [#65](https://github.com/kmmbvnr/rank/issues/65).
The catalogue describes cell shapes. Runtime empty-frame handling and the
analyzer instantiate those same structured signatures without reading values.

## Checklist

| Issue task | Implementation and evidence |
| --- | --- |
| Structured type and validator | `packages/language/src/shape-signature.ts`; tests cover named dimensions, spreads, sums, incompatible shapes and existential dimensions. |
| Annotate ranked and shape-flag operations | Every catalogue entry with explicit ranks, dense element metadata or collection-preservation metadata must have a signature. `operations.test.ts` enforces coverage. |
| Check ranks and old flags | Fixed cell patterns are checked against explicit numeric ranks. Runtime ranks come from the catalogue. `scalarResult`, `preservesArrayShape`, `resultShapeFromOperand` and `denseResult.shape` are removed with their consumers. Element/representation metadata remains separate. |
| Derive runtime result-cell shape | `native` builds its shape hook from the unary signature. Empty-frame tests cover large cells, existential lengths and the fallback for builtins without signatures. |
| Generic analyzer transfer | `operationShapeFacts` splits frames, instantiates cell contracts and broadcasts frames. It supplies no element or callback-safety proofs. Value-aware cases, including known reshape targets, remain. |
| Document notation | The generated standard-library reference explains structured literals, unknown dimensions and empty frames. Its source is `REFERENCE_PREAMBLE` in the CLI. |

`shape-contracts.test.ts` requires a real-call fixture for every declared signature
arity. Fixtures include overloaded operations, empty arrays, text, matrices and
value-dependent lengths. They compare known predicted axes with result headers.
Lazy sequences use their declared size; tests never enumerate them just to
check a postcondition. A separate test verifies that shape checks and lazy
rounding read no source cells. These checks run in tests, with no production
postcondition overhead.

## Accepted differences from the proposal

- Cell ranks remain explicit in the catalogue. Counting dimensions before a
  shape spread cannot determine where a cell ends: the spread may be inside it.
  Runtime modules no longer duplicate these ranks.
- `sum` consumes the whole input. `append` writes to a file. Remora's vector sum
  and array concatenation examples are not contracts for these Rank operations.
- `{ exists: 'k' }` marks a value-dependent output dimension. A result dimension
  `null` is reserved for a shape-determined but unexpressed length. Both
  instantiate to an unknown dimension in the signature matcher; the ragged-lift
  analysis added in #67 inspects the declaration to distinguish them. An entirely
  `null` result pattern means the result rank also needs values; it does not promise uniform cells.
- `permutations` removes duplicate permutations. Three distinct values produce
  six items and three equal values produce one, so its length is existential.
  `reshape` depends on target values; its specialized analysis still recovers
  known target dimensions. This migration does not add a `flat` contract.
- On empty frames, unknown dimensions in a declared result become zero without
  calling the function. Unknown result rank adds no cell axes. Only pure
  builtins without a signature may probe a bounded zero-filled cell. Text and
  sequence results remain boxed under tensor lifting.
- Signature instantiation binds dimensions and solves sums with one unknown;
  it is not a general arithmetic solver. Multiplication is not supported.

## Ordered unary cell axes (#457)

Unary `axis` selection preserves the written cell-axis order; frame axes keep
source order. Runtime and shape analysis restore same-rank result axes by their
corresponding positions in that list, including selections covering the whole
operand. Binary cell selection and reduction traversal retain their existing rules.

`covariance`, `correlation` and `corr` declare monadic rank 2 and cell shape
`[f, n] -> [f, f]`. Their `cellResultPlacement: 'append'` contract keeps new
feature axes after the batch frame. They use the ordinary rank/axis application
form, including aliases and matching explicit `rank 2`; no dedicated covariance
or correlation axis AST form remains.

## Standard-library names

Standard-library operation names are unique, enforced by the catalogue test.
The DSU operation is now `findroot`; `find` belongs to collection search in
`sequences`. Both `Dsu findroot Value` and `Dsu findroot Value` work. There is
no compatibility alias: keeping `graph.find` would preserve the collision.
Native metadata can therefore still resolve by the unique catalogue name.
Examples, receiver dispatch and analyzer facts use the new DSU name. A shared
rename table makes the old DSU spelling report `DSU find is now findroot` during
execution and static checking, without affecting collection search or user functions.

## Remaining scope

Symbolic shape propagation (#66) and ragged-lift diagnostics (#67) have since
been implemented; these are no longer migration follow-ups. Symbolic dimensions
are a sidecar to concrete/unknown shapes, as described in
[the analysis architecture](../adr/implementation/0002-abstract-interpretation-and-symbolic-shape-inference.md).
The current [rank rules](../language/sequences-arrays.md#rank) describe assembly
and empty-frame limits. Further compiler/Rust consumers and contracts for
currently unannotated operations remain possible extensions. Shape facts do not
establish element types, purity, callback safety or the absence of effects. Those require their existing independent
proofs.

An extension beyond #66 would be flattening each rank-k cell of a
batch of dense tensors with scalar elements: `[3, 2, 4]` would become `[3, 8]`.
Its cell length is `2 * 4`, uniformly across the batch, so an addition-only
contract would need an unexpressed dimension rather than an existential one.
This remains a proposed tensor operation. Rank's current `flat` copies a
rank-1 record array into compact storage, or initializes it from a count and
record state; it does not flatten numeric tensors. Its missing contract is a
separate catalogue addition, not a multiplication example.

## Application-model maintenance (#281)

The canonical language rules now live in the Rank section linked above.
`rank-shape-parity.test.ts` checks independent frame/cell expectations against
analysis and runtime, including batched contraction and zero-sized axes.

The audit found separate concrete runtime and partial static partition/agreement
helpers. They have different responsibilities: runtime creates readers and
raises errors; analysis accepts unknown axes and conservatively returns facts.
The shared signature instantiator already owns operation cell contracts.
No additional universal plan or helper extraction was justified by this audit.
Changes to optimizer eligibility remain separate from the shape contract.

The conformance extension also exposed a runtime inconsistency: a binary user
function without header ranks rejected array results when lifted with call-site
ranks, although the same builtin call worked. User functions now advertise array
cell results regardless of header ranks. Tests compare direct `matmul` and its
user-function wrapper, including empty batches, preserved singleton axes and an
empty contracted axis, with execution optimizations enabled and disabled.
