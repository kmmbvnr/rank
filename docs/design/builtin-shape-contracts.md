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
| Derive runtime result-cell shape | `native` builds its shape hook from the unary signature. Empty-frame tests cover large cells, existential lengths and the fallback for unsigned builtins. |
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
  instantiate to an unknown dimension today; #67 can inspect the declaration
  to distinguish them. An entirely `null` result pattern means the result rank
  also needs values; it does not promise uniform cells.
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

## Standard-library names

Standard-library operation names are unique, enforced by the catalogue test.
The DSU operation is now `findroot`; `find` belongs to collection search in
`sequences`. Both `Dsu findroot Value` and `Dsu Value findroot` work. There is
no compatibility alias: keeping `graph.find` would preserve the collision.
Native metadata can therefore still resolve by the unique catalogue name.
Examples, receiver dispatch and analyzer facts use the new DSU name.

## Remaining scope

Symbolic shape propagation (#66), ragged-lift diagnostics (#67), compiler/Rust
consumers and additional contracts for currently unannotated operations are
follow-up work. Shape facts do not establish element types, purity, callback
safety or the absence of effects. Those require their existing independent
proofs.
