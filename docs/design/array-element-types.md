# Array element types and compact storage

Ordinary numeric Rank arrays currently store every cell as a boxed Rank atom: a JS `BigInt` for
`integer` and a JS number for `real`. An optional element-type annotation would
let an array name a narrower representation — `int32`, `f32`, `fp8`, `fp4` — and
keep its cells in a typed buffer instead.

Compact record arrays are now available through `Values flat` and
`Count State flat`; see [flat record arrays](../language/sequences-arrays.md#flat-record-arrays).
The scalar element-type annotations below are not current syntax. The page records the measurements, the semantic
fork and the syntax candidates so the decision does not have to be rediscovered.

## Why: capacity, not speed

Per-element cost, measured on 4,000,000 elements under Node 24 (one process per
case, `--expose-gc`, `heapUsed + arrayBuffers` before and after the allocation):

| Representation | Bytes per element |
| --- | --- |
| JS array of `BigInt` — today's `integer` array | 31.9 |
| JS array of numbers — today's `real` array | 8.0 |
| `Float64Array` | 8.0 |
| `Float32Array`, `Int32Array` | 4.0 |
| `Uint8Array` — the `fp8` slot | 1.0 |
| packed `fp4`, two cells per byte | 0.5 |

A 4096×4096 integer matrix costs 537 MB today, 67 MB as `int32` and 16.8 MB as
`fp8`. That is the argument for the feature: it decides which problems fit in
memory at all. The speed case is weaker and is discussed below.

## What already exists

Three pieces of the runtime already point this way, so the work is
generalization rather than invention.

**`RankBytes` is already a typed array.** `RankBytes` in `value.ts` and
`ByteArray` in `bytes.ts` carry a `Uint8Array` alongside `shape`, widen each
byte to a Rank atom in `itemAt`, and materialize `items` lazily on demand. One
narrow element type already travels the whole path from storage to operations.

**Reads need no new code.** Every `arrayItem` — there are copies in
`interpreter.ts`, `tensor.ts` and `graph.ts` — is
`source.itemAt?.(index) ?? source.items[index]`. A new variant that supplies
`itemAt` is read correctly by all existing consumers. Writes are the real work:
the selector fast path and the array-assignment statement both require
`itemAt === undefined` and store straight into `target.items[offset]`, so a
typed array needs its own write path or it falls back to the general one.

**The region compiler is the consumer.** The scalar-region compiler already
proves element types at loop entry. An annotation is exactly the fact it tries
to derive, so an annotated array should let it skip the proof and emit direct
typed-buffer loads and stores.

**The language has no type annotations at all.** A variable's type is fixed by
its first assignment and recorded per frame slot. Whatever is added here is the
first annotation syntax in the language, which is a reason to keep it narrow.

## The fork: storage or semantics

The formats do not all answer this the same way.

`int32` can be a pure storage choice. Values stay exact Rank integers, and a
value that does not fit is an error. Nothing wraps, the operator table does not
change, and `typeName` does not change.

`fp4` and `fp8` cannot. They are lossy: rounding happens on write, and a read
returns the dequantized value, not the one that was stored. That is a semantic
change and has to be stated rather than hidden behind a storage hint.

The recommended model keeps the two levels apart:

- the **type** stays `integer` or `real`, so `assign`, the recorded type sets,
  the type-mismatch errors and the whole checking path are untouched;
- the **representation** is a separate attribute of the array.

The price is that `A .int32` and a plain `A` are the same type, assignment
between them is allowed, and the representation changes silently at the
boundary. The alternative — promoting representations to real types — would
spread through the operator table and every type message, for a gain that is
mostly about storage.

## Syntax candidates

All three fit Rank's existing vocabulary: a bare word or a label, no new
punctuation. Rank already uses a label as a mode selector in `stdin .integer`,
and already accepts a trailing `array` word as a materialize step.

### A. Label on the constructor

```rank
A = array shape 1000000 pad 0 .int32
W = array shape 4096 4096 pad 0 .fp8
```

A trailing optional label on `ArrayExpression`. Local change, reads in the same
direction as the rest of the constructor.

### B. Postfix conversion

```rank
B = A .int32 array
W = Weights .fp8 array
```

A label in front of the existing trailing `array` word, reusing the
`MaterializeExpression` slot. This is the form needed to convert an array that
already exists — loading weights, narrowing a computed result.

### C. Declaration statement

```rank
store Weights fp8
```

Shaped like the existing `option N integer` and `argument Path text many`
declarations. It annotates a variable rather than an array, which conflicts with
a variable's type already being fixed by its first assignment. Not recommended.

A and B together cover construction and conversion with one word list and one
runtime concept, and are the recommended pair.

## Quantized float formats

If the motivation is ML weights, the float formats carry decisions of their own.

`fp8` is two incompatible formats, not one. E4M3 trades range for precision and
is the usual choice for weights; E5M2 keeps more exponent and is the usual
choice for gradients. Either pick one or expose both as separate labels.

`fp4` is block-scaled in practice. MXFP4 stores 32 elements plus one shared
`e8m0` scale, and a bare `fp4` array without a scale is close to useless for the
workloads that motivate it. The scale belongs to a block, not to an element, so
this is a larger representation question than the element width — it is the
reason `fp4` should not be the first format implemented.

JS has no native `fp8` or `fp4`, so both need hand packing over a `Uint8Array`.
Dequantizing `fp8` is best done with a 256-entry `Float64Array` lookup table:
every `fp8` bit pattern is covered exactly, so a read is one array access rather
than bit manipulation. Quantizing is a round-to-nearest step.

## What to expect from performance

For integers, narrow storage on its own makes reads *slower*. Every read becomes
a `BigInt` construction with an allocation — exactly what `ByteArray` does
today. The speed win appears only where compiled regions read the buffer without
boxing, which is why the region compiler is the gating dependency rather than a
nice-to-have.

For reals there is little speed to win either way: V8 already keeps a JS array
of numbers unboxed at 8 bytes per element. The gain there is memory, and at
`f32` or narrower.

So: memory immediately, speed only in combination with the region compiler.

## Suggested order

Start with `.f32` and `.i32` over native `Float32Array` and `Int32Array`. That
exercises the whole pipeline — grammar, a new array variant, the write path, the
region compiler — without packing or block scales. Add `fp8` once the pipeline
stands and the write path is settled, and treat `fp4` with block scaling as a
separate design step.

Files that a first cut touches:

- `packages/language/src/rank.langium` — the label on `ArrayExpression`, or in
  front of the trailing `array` word;
- `packages/interpreter/src/value.ts` — a typed variant beside `RankBytes`;
- `packages/interpreter/src/array-storage.ts` — `eagerArrayStorage` and
  `materializedArrayItems` currently sniff an own `items` property and reject
  anything with `itemAt`;
- `packages/interpreter/src/interpreter.ts` — the selector write fast path and
  the array-assignment statement;
- the scalar-region compiler, to consume the annotation instead of proving it.

## Open questions

- Does an out-of-range store raise, saturate, or promote the array to boxed
  cells?
- Does a narrowed array keep its representation through arithmetic, or does a
  result fall back to boxed cells unless a kernel opts in?
- Which `fp8` format, and are both exposed?
- Where does an MXFP4 block scale live in the representation, and does it show
  up in `shape`?
- Does `typeName` stay at `integer` and `real`, accepting that representation is
  invisible to the type system?
- Do tables and tensors inherit the annotation, or is it an array-only concept?

Related: [Array storage and the internal JS boundary](array-storage.md),
[Tensor fusion architecture](tensor-fusion.md),
[Performance roadmap](performance-roadmap.md).
