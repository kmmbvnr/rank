import type { SignatureType, TypeSignature } from './type-signature.js';
import type { ShapeSignature } from './shape-signature.js';

/**
 * The catalogue of standard-library vocabulary.
 *
 * Every builtin name appears here exactly once, including the always-available
 * core, with how it is written, what it returns and what it touches. The runtime owns the
 * implementations; this file owns what a reader, a console or an editor needs
 * to know about them before anything runs, which is why it lives in the
 * language package and imports nothing. `operations.test.ts` in the interpreter
 * checks the two against each other, so a new builtin cannot stay undescribed.
 */

/** Cell rank an operation applies at. `all` takes the whole value at once. */
export type IntrinsicRank = number | 'all';

/** What an application touches besides its operands. */
export type Effect = 'io' | 'random' | 'mutates';

/** Short label for what an application produces. */
export type ResultKind =
    | 'integer' | 'real' | 'number' | 'boolean' | 'text' | 'bytes'
    | 'array' | 'sequence' | 'table' | 'record' | 'collection'
    | 'element' | 'structure' | 'functional' | 'segment' | 'fenwick' | 'date' | 'datetime' | 'duration' | 'file' | 'database'
    | 'tuple' | 'value' | 'same';

// Common compiler vocabulary. Backend profiles declare the supported subset.
export type CompiledAtomType = 'integer' | 'real' | 'boolean' | 'text' | 'bytes';
/** Types currently supported by direct native calls and registers in loops. */
export type CompiledLoopType = Exclude<CompiledAtomType, 'real'>;

/** A verified compiler-supported subset, not the operation's full language signature.
 * Calls are synchronous and cannot invoke Rank callbacks or mutate bindings.
 * `same` requires the first scalar operand's type; it does not imply broadcasting.
 * Runtime binding must still verify the actual builtin and any host override.
 */
export interface CompiledCallSignature {
    readonly inputs: readonly (CompiledLoopType | 'text-or-bytes' | 'text-or-array' | 'text-array' | 'same')[];
    readonly result: CompiledLoopType;
    /** No callbacks except guarded operand-cell reads and the declared host override. */
    readonly callbacks: 'none' | 'read-cells';
    /** Conservative work classification, not a complexity or latency bound.
     * Even integer formatting and validation may depend on input size. */
    readonly cost: 'input-dependent' | 'host-dependent';
    /** An installed override must be explicitly certified pure at region entry. */
    readonly hostFunction?: 'md5';
}

/** Match a complete proven native input domain; no coercion or cell inspection. */
export function matchCompiledCallSignature(operation: Operation, inputs: readonly string[]): CompiledCallSignature | undefined {
    const signature = operation.compiledCall;
    return signature && signature.inputs.length === inputs.length && signature.inputs.every((expected, index) =>
        expected === 'same' ? inputs[index] === inputs[0]
            : expected === 'text-or-array' ? ['text', 'array', 'text-array'].includes(inputs[index])
            : expected === 'text-or-bytes' ? inputs[index] === 'text' || inputs[index] === 'bytes'
            : expected === inputs[index]) ? signature : undefined;
}

/** One builtin name, either always available in core or opened by a module. */
export interface Operation {
    /** The word written in the program. */
    readonly name: string;
    /** The owning module; `core` names are visible without an import. */
    readonly module: string;
    /**
     * Operand counts the runtime accepts, the left-hand data included, so
     * `Values sum` is arity one and `Text Separator split` is arity two. Empty
     * for a name that is a value rather than an operation.
     */
    readonly arities: readonly number[];
    /**
     * How the name is written. Rank is data-first, so operands precede it; the
     * few names that exist to be handed to a modifier are shown that way.
     */
    readonly form: string;
    /** One sentence describing the result. */
    readonly summary: string;
    readonly result: ResultKind;
    /** Audited language overloads for readers and editors, independent of compiler subsets. */
    readonly signatures?: readonly TypeSignature[];
    /** Syntax marker dispatched by application forms; its native placeholder cannot be called. */
    readonly formOnly?: true;
    /** Direct-call eligibility for existing compiler backends. Never use this
     * restricted subset as a complete operand-domain rule or displayed signature. */
    readonly compiledCall?: CompiledCallSignature;
    /** Field result kinds for a built-in record with a stable schema. */
    readonly recordFields?: Readonly<Record<string, ResultKind>>;
    /** Fresh rank-1 record fields containing vertices from a closed graph operand. */
    readonly recordVertexArrays?: readonly string[];
    /** Scalar record fields containing a vertex from a closed graph operand. */
    readonly recordVertexFields?: readonly string[];
    /** Values stored in fresh graph-result index fields. */
    readonly recordIndexValues?: Readonly<Record<string, 'integer' | 'number' | 'vertices'>>;
    /** Scalar element type of a builtin collection value (zero operands). */
    readonly valueElements?: 'integer' | 'real';
    /** Reading the builtin value's cells cannot call Rank code. */
    readonly valueCallbackFree?: true;
    /** Omitted when the operation takes its whole argument at once (`all`). */
    readonly monadicRank?: IntrinsicRank;
    readonly dyadicRanks?: readonly [IntrinsicRank, IntrinsicRank];
    /** The result length depends on the values, not only on the operand shapes (Σ in the shape signature). */
    readonly dataLength?: true;
    /** A cell of a ranked call may return an array; results stack under the frame. */
    readonly arrayCells?: true;
    /** Cell shape contracts, one per supported operand count. Ranks remain explicit. */
    readonly shape?: readonly ShapeSignature[];
    /** Accepted scalar/cell domains for requirement diagnostics, not callback proofs.
     * Omit an operand when its overloads do not have one unconditional domain. */
    readonly operandDomains?: readonly (readonly string[] | null)[];
    /** Present when the result is produced on demand rather than at once. */
    readonly lazy?: true;
    readonly effects?: readonly Effect[];
    /** Operand domain in which scalar calls cannot invoke Rank callbacks. Throws are allowed. */
    readonly scalarNoCallback?: 'integer' | 'number';
    /** A numeric scalar result keeps its operand's integer or real type. */
    readonly preservesNumericScalarType?: true;
    /** Unary application maps each scalar cell of an array or sequence. */
    readonly mapsScalarCells?: true;
    /** Accepted cells for a callback-free reduction of one scalar-cell array. */
    readonly scalarCellArrayNoCallback?: 'number' | 'boolean';
    /** A successful unary reduction returns one of its numeric input cells. */
    readonly selectsNumericCell?: true;
    /** Numeric array operands with callback-free cells yield no Rank callbacks, including when the result is read. */
    readonly numericArrayNoCallback?: true;
    /** Reads only array metadata, for an array whose representation is already proved callback-free. */
    readonly arrayHeaderNoCallback?: true;
    /** An array or sequence result keeps the input collection kind and element types. */
    readonly preservesCollectionElements?: true;
    /** A fresh dense array with these proven cell types on every successful call. */
    readonly denseElements?: readonly string[];
    /**
     * Labels written after the name that choose another form of the result,
     * as in `Text json .flat`. The call receives the label as its last operand.
     */
    readonly modifiers?: readonly string[];
    /** This unary operation accepts the `axis` reduction form. */
    readonly axisReduction?: true;
    /** A trailing direction label selects the sort form. */
    readonly sortDirection?: true;
}

/** A library module or the always-available core catalogue group. */
export interface Module {
    readonly name: string;
    readonly summary: string;
}

/**
 * A construct with no exported name to look up: an
 * operator, a block, a constructor or a mutation. `example` is complete Rank,
 * so tests can verify core availability or the corresponding import gate.
 */
export interface ModuleForm {
    readonly module: string;
    readonly form: string;
    readonly summary: string;
    readonly example: string;
}

export const modules: readonly Module[] = [
    { name: 'algo',
        summary: 'Algorithmic collections, range structures and combinatorial generators.' },
    { name: 'bits', summary: 'Bitwise operations over arbitrary-precision integers.' },
    { name: 'cli', summary: 'Command-line arguments, flags and options.' },
    { name: 'core', summary: 'Always available: conversions, ranges, length, sums and extrema. No use required.' },
    { name: 'crypto', summary: 'Hashes and related byte operations.' },
    { name: 'dates', summary: 'Calendar dates and local date-times.' },
    { name: 'graph', summary: 'Graphs, disjoint sets, rooted trees and their algorithms.' },
    { name: 'grids', summary: 'Neighbors and straight segments of dense rank-2 arrays.' },
    { name: 'images', summary: 'Image directories decoded into tensors.' },
    { name: 'io', summary: 'Standard input, whole-file text and stateful file handles.' },
    { name: 'json', summary: 'JSON decoding into values or a flat table of nodes.' },
    { name: 'linalg', summary: 'Matrix products, solvers and decompositions.' },
    { name: 'numbers', summary: 'Arithmetic, roots, logarithms, trigonometry and number theory.' },
    { name: 'random', summary: 'Seeded pseudorandom sampling.' },
    { name: 'sequences', summary: 'Shapes, orderings, windows and lazy sources.' },
    { name: 'stats', summary: 'Averages, spread, error metrics and covariance.' },
    { name: 'tables', summary: 'CSV, SQLite, grouping and joins.' },
    { name: 'testing', summary: 'Test blocks.' },
    { name: 'text', summary: 'Splitting, formatting, parsing and code points.' },
    { name: 'xml', summary: 'XML decoding into a tree or a flat table of nodes.' },
];

/** Scalar/collection extrema share the runtime's ordered scalar domains. */
const extremaSignatures: readonly TypeSignature[] = (['number', 'text', 'boolean', 'symbol', 'date', 'datetime', 'record'] as const)
    .flatMap((type): TypeSignature[] => [
        { inputs: [{ union: [type, ...(['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'multiset'] as const)
            .map(collection => ({ collection, element: { union: [type, 'missing'] } } as SignatureType))] }], result: type },
        { inputs: [type, type], result: type, ranks: [0, 0] },
    ]).concat([
        { inputs: ['missing', 'unknown'], result: 'missing', ranks: [0, 0] },
        { inputs: ['unknown', 'missing'], result: 'missing', ranks: [0, 0] },
    ]);
/** `Values max .index` and `.indexed`: the position of the extreme, alone or beside it. */
const genericCollection: SignatureType = { collection: 'array', element: { variable: 0 } };
const positionSignatures: readonly TypeSignature[] = [
    { inputs: [{ union: [genericCollection, { collection: 'sequence', element: { variable: 0 } }] }, { label: 'index' }], result: 'integer' },
    { inputs: [{ union: [genericCollection, { collection: 'sequence', element: { variable: 0 } }] }, { label: 'indexed' }], result: 'tuple' },
];
const elementVariable: SignatureType = { variable: 0 };
const genericArray: SignatureType = { collection: 'array', element: elementVariable };
const randomInput: SignatureType = { union: [genericArray, { collection: 'sequence', element: elementVariable }] };
const integerArray: SignatureType = { collection: 'array', element: 'integer' };
const booleanArray: SignatureType = { collection: 'array', element: 'boolean' };
const booleanCollection: SignatureType = { union: ['boolean', ...(['array', 'sequence', 'queue', 'stack', 'deque', 'heap'] as const)
    .map(collection => ({ collection, element: 'boolean' as const }))] };
const collectionEnds: readonly TypeSignature[] = [
    { inputs: ['text'], result: 'text' },
    { inputs: [genericArray], result: { union: [elementVariable, genericArray] } },
    ...(['sequence', 'queue', 'stack', 'deque'] as const).map(collection => ({
        inputs: [{ collection, element: elementVariable }], result: elementVariable,
    })),
];
const sortDirection: SignatureType = { union: [{ label: 'ascending' }, { label: 'descending' }] };
const orderedValue: SignatureType = { union: ['number', 'boolean', 'text', 'symbol', 'date', 'datetime', 'record'] };
const combinationInput: SignatureType = { union: (['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'counter'] as const)
    .map(collection => ({ collection, element: elementVariable })) };
const combinationResult: SignatureType = { collection: 'sequence', element: genericArray };
const queueReadSignatures: readonly TypeSignature[] = (['queue', 'stack', 'deque', 'heap'] as const)
    .map(collection => ({ inputs: [{ collection, element: elementVariable }], result: elementVariable }));
const dequeReadSignatures: readonly TypeSignature[] = [
    { inputs: [{ collection: 'deque', element: elementVariable }], result: elementVariable },
];
const dequeWriteSignatures: readonly TypeSignature[] = [
    { inputs: [{ collection: 'deque', element: elementVariable }, elementVariable],
        result: { collection: 'deque', element: elementVariable } },
];
const collectionWriteSignatures: readonly TypeSignature[] = (['set', 'counter', 'multiset'] as const)
    .map(collection => ({ inputs: [{ collection, element: elementVariable }, elementVariable],
        result: { collection, element: elementVariable } }));
const orderedQuerySignatures: readonly TypeSignature[] = [
    { inputs: [{ collection: 'multiset', element: elementVariable }, orderedValue], result: elementVariable, ranks: ['all', 0] },
];
const graphVertex: SignatureType = { union: ['number', 'boolean', 'text', 'symbol'] };
const graphVertexArray: SignatureType = { collection: 'array', element: graphVertex };
const printableScalar: SignatureType = { union: ['number', 'boolean', 'text', 'symbol', 'date', 'datetime'] };
const numericCells: SignatureType = { union: ['number', 'missing'] };
const numericArray: SignatureType = { collection: 'array', element: 'number' };
const realArray: SignatureType = { collection: 'array', element: 'real' };
const statisticalInput: SignatureType = { union: ['number',
    { collection: 'array', element: numericCells }, { collection: 'sequence', element: numericCells }] };
const statisticalSignatures: readonly TypeSignature[] = [{ inputs: [statisticalInput], result: 'real' }];
const quantileSignatures: readonly TypeSignature[] = [...statisticalSignatures,
    { inputs: [statisticalInput, 'number'], result: 'real' },
    { inputs: [statisticalInput, numericArray], result: realArray }];
const metricInput: SignatureType = { union: ['number', numericArray, { collection: 'sequence', element: 'number' }] };
const metricSignatures: readonly TypeSignature[] = [{ inputs: [metricInput, metricInput], result: 'real' }];

const numericReductionInputs: SignatureType = { union: ['number', 'missing', 'column',
    ...(['array', 'sequence', 'queue', 'stack', 'deque', 'set'] as const).map(collection => ({ collection, element: numericCells }))] };

/** Whole-value maps preserve the collection kind, independently of intrinsic rank lifting. */
function mappingSignatures(input: SignatureType, result: SignatureType): readonly TypeSignature[] {
    return [{ inputs: [input], result },
        ...(['array', 'sequence'] as const).map(collection => ({
            inputs: [{ collection, element: input }], result: { collection, element: result },
        }))];
}
const realMathSignatures: readonly TypeSignature[] = [
    { inputs: ['number'], result: 'real' }, { inputs: ['missing'], result: 'missing' },
    ...mappingSignatures(numericCells, { union: ['real', 'missing'] }).slice(1),
];
const integerPredicateSignatures = mappingSignatures('integer', 'boolean');
const integerDyadicSignatures: readonly TypeSignature[] = [
    { inputs: ['integer', 'integer'], result: 'integer', ranks: [0, 0] },
];

/** Text helpers either map arrays or build SQL expressions. Only startswith
 * recurses through array cells before dispatching SQL; the others reject mixing
 * an array argument with a column expression. */
function textArgumentSignatures(inputs: readonly SignatureType[], result: SignatureType, recursiveSql = false): readonly TypeSignature[] {
    if (recursiveSql) {
        let rows: { inputs: SignatureType[]; array: boolean; column: boolean }[] = [{ inputs: [], array: false, column: false }];
        for (const input of inputs) rows = rows.flatMap(row => [
            { ...row, inputs: [...row.inputs, input] },
            { ...row, inputs: [...row.inputs, { collection: 'array' as const, element: input }], array: true },
            { ...row, inputs: [...row.inputs, 'column' as const], column: true },
            { inputs: [...row.inputs, { collection: 'array' as const, element: 'column' as const }], array: true, column: true },
        ]);
        return rows.map(row => ({ inputs: row.inputs, result: row.array
            ? { collection: 'array', element: row.column ? 'column' : result } : row.column ? 'column' : result }));
    }
    const signatures: TypeSignature[] = [{ inputs, result }];
    for (let mask = 1; mask < 2 ** inputs.length; mask++) {
        signatures.push({ inputs: inputs.map((input, index) => mask & 2 ** index
            ? { collection: 'array', element: input } : input), result: { collection: 'array', element: result } });
        signatures.push({ inputs: inputs.map((input, index) => mask & 2 ** index ? 'column' : input), result: 'column' });
    }
    return signatures;
}

// These date operations map whole arrays/sequences themselves; this is not
// intrinsic rank lifting. SQL column refinements remain runtime constraints.
function dateMappingSignatures(input: SignatureType, result: SignatureType): readonly TypeSignature[] {
    return [...mappingSignatures(input, result), { inputs: ['column'], result: 'column' }];
}
const calendarValue: SignatureType = { union: ['date', 'datetime'] };
const dateInput: SignatureType = { union: ['text', 'date', 'datetime'] };
const calendarComponentSignatures: readonly TypeSignature[] = [
    { inputs: [calendarValue], result: 'integer', ranks: [0] },
    { inputs: ['column'], result: 'column', ranks: [0] },
];

export const operations: readonly Operation[] = [
    { name: 'add', module: 'algo', arities: [2], form: 'Seen add Value', result: 'collection',
        signatures: collectionWriteSignatures,
        effects: ['mutates'], summary: 'Adds a value to a set, counter or multiset.' },
    { name: 'ceiling', module: 'algo', arities: [2], form: 'Bag ceiling Limit', result: 'element',
        signatures: orderedQuerySignatures,
        shape: [{ args: [null, []], result: [] }],
        dyadicRanks: ['all', 0],
        summary: 'Smallest stored value at least the limit.' },
    { name: 'combinations', module: 'algo', arities: [2], form: 'Values Count combinations',
        signatures: [{ inputs: [combinationInput, 'integer'], result: combinationResult }],
        result: 'sequence', lazy: true,
        summary: 'Lazy sequence of the combinations of that size, in input order.' },
    { name: 'enqueue', module: 'algo', arities: [3], form: 'Heap Priority Value enqueue',
        signatures: [{ inputs: [{ collection: 'heap', element: elementVariable }, orderedValue, elementVariable],
            result: { collection: 'heap', element: elementVariable } }],
        result: 'collection', effects: ['mutates'],
        summary: 'Inserts a payload into a heap under a separate priority.' },
    { name: 'fenwick', module: 'algo', arities: [1], form: 'Size fenwick', result: 'fenwick',
        signatures: [{ inputs: ['integer'], result: 'fenwick' }],
        summary: 'Fixed-size integer Fenwick tree with inclusive prefix sums.' },
    { name: 'firstatleast', module: 'algo', arities: [2], form: 'Tree Target firstatleast',
        signatures: [{ inputs: ['segment', 'number'], result: 'integer', ranks: ['all', 0] }],
        shape: [{ args: [null, []], result: [] }],
        result: 'integer',
        dyadicRanks: ['all', 0],
        summary: 'First position whose monotone prefix aggregate reaches the target.' },
    { name: 'floor', module: 'algo', arities: [2], form: 'Bag floor Limit', result: 'element',
        signatures: orderedQuerySignatures,
        shape: [{ args: [null, []], result: [] }],
        dyadicRanks: ['all', 0],
        summary: 'Largest stored value at most the limit.' },
    { name: 'lowerbound', module: 'algo', arities: [2], form: 'Bag lowerbound Value',
        signatures: orderedQuerySignatures,
        result: 'element',
        shape: [{ args: [null, []], result: [] }],
        dyadicRanks: ['all', 0],
        summary: 'Smallest stored value at least the query, an alias for ceiling.' },
    { name: 'maxsum', module: 'algo', arities: [2], form: 'Values segment maxsum', result: 'record',
        formOnly: true,
        summary: 'Prefix and subarray sum profile: query returns sum, prefix, suffix and best.' },
    { name: 'missing', module: 'algo', arities: [2], form: 'Data Bounds missing', result: 'integer',
        signatures: [{ inputs: ['wavelet', { collection: 'array', element: 'integer' }], result: 'integer', ranks: ['all', 1] }],
        shape: [{ args: [null, [null]], result: [] }],
        dyadicRanks: ['all', 1],
        summary: 'Smallest subset sum a wavelet position range cannot make.' },
    { name: 'multicomb', module: 'algo', arities: [2], form: 'Values Count multicomb',
        signatures: [{ inputs: [combinationInput, 'integer'], result: combinationResult }],
        result: 'sequence', lazy: true,
        summary: 'Lazy sequence of the combinations of that size with repetition.' },
    { name: 'multiset', module: 'algo', arities: [1], form: 'Values multiset', result: 'collection',
        signatures: [{ inputs: ['text'], result: { collection: 'multiset', element: 'text' } },
            { inputs: [{ union: [...(['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'counter', 'multiset'] as const)
                .map(collection => ({ collection, element: elementVariable }))] }], result: { collection: 'multiset', element: elementVariable } }],
        summary: 'Ordered multiset holding every value, duplicates kept.' },
    { name: 'peek', module: 'algo', arities: [1], form: 'Q peek', result: 'element',
        signatures: queueReadSignatures,
        summary: 'Next value of a queue, stack, deque or heap, left in place.' },
    { name: 'peekback', module: 'algo', arities: [1], form: 'Ends peekback', result: 'element',
        signatures: dequeReadSignatures,
        summary: 'Last value of a deque, left in place.' },
    { name: 'peekfront', module: 'algo', arities: [1], form: 'Ends peekfront', result: 'element',
        signatures: dequeReadSignatures,
        summary: 'First value of a deque, left in place.' },
    { name: 'permutations', module: 'algo', arities: [1], form: 'Values permutations',
        signatures: [{ inputs: ['text'], result: { collection: 'sequence', element: 'text' } },
            { inputs: [combinationInput], result: combinationResult }],
        shape: [{ args: [['d']], result: [{ exists: 'k' }] }],
        result: 'sequence', monadicRank: 1, lazy: true,
        summary: 'Lazy sequence of every ordering of the values.' },
    { name: 'pop', module: 'algo', arities: [1], form: 'Q pop', result: 'element',
        signatures: queueReadSignatures,
        effects: ['mutates'],
        summary: 'Removes and returns the next value of a queue, stack, deque or heap.' },
    { name: 'popback', module: 'algo', arities: [1], form: 'Ends popback', result: 'element',
        signatures: dequeReadSignatures,
        effects: ['mutates'], summary: 'Removes and returns the last value of a deque.' },
    { name: 'popfront', module: 'algo', arities: [1], form: 'Ends popfront', result: 'element',
        signatures: dequeReadSignatures,
        effects: ['mutates'], summary: 'Removes and returns the first value of a deque.' },
    { name: 'push', module: 'algo', arities: [2], form: 'Q push Value', result: 'collection',
        signatures: [...(['queue', 'stack', 'deque'] as const).map(collection => ({
            inputs: [{ collection, element: elementVariable }, elementVariable], result: { collection, element: elementVariable } })),
            { inputs: [{ collection: 'heap', element: orderedValue }, orderedValue], result: { collection: 'heap', element: orderedValue } }],
        effects: ['mutates'],
        summary: 'Appends a value to a queue, stack, deque or heap, which orders it by priority.' },
    { name: 'pushback', module: 'algo', arities: [2], form: 'Ends Value pushback',
        signatures: dequeWriteSignatures,
        result: 'collection', effects: ['mutates'],
        summary: 'Appends a value to the back of a deque.' },
    { name: 'pushfront', module: 'algo', arities: [2], form: 'Ends Value pushfront',
        signatures: dequeWriteSignatures,
        result: 'collection', effects: ['mutates'],
        summary: 'Adds a value to the front of a deque.' },
    { name: 'query', module: 'algo', arities: [3], form: 'Tree Left Right query', result: 'element',
        signatures: [{ inputs: ['segment', 'integer', 'integer'], result: 'unknown' }],
        summary: 'Reduces an inclusive segment-tree range in left-to-right order.' },
    { name: 'remove', module: 'algo', arities: [2], form: 'Bag remove Value', result: 'collection',
        signatures: collectionWriteSignatures,
        effects: ['mutates'], summary: 'Removes one occurrence from a set, counter or multiset.' },
    { name: 'segment', module: 'algo', arities: [2], form: 'Values segment Operation',
        formOnly: true,
        result: 'segment', summary: 'Segment tree over one associative binary operation.' },
    { name: 'sumwithin', module: 'algo', arities: [5],
        signatures: [{ inputs: ['wavelet', 'integer', 'integer', 'number', 'number'], result: 'number' }],
        form: 'Data Left Right Low High sumwithin', result: 'number',
        summary: 'Sums wavelet values inside inclusive position and value ranges.' },
    { name: 'upperbound', module: 'algo', arities: [2], form: 'Bag upperbound Value',
        signatures: orderedQuerySignatures,
        result: 'element', shape: [{ args: [null, []], result: [] }],
        dyadicRanks: ['all', 0],
        summary: 'Smallest stored value greater than the query.' },
    { name: 'wavelet', module: 'algo', arities: [1], form: 'Values wavelet', result: 'structure',
        signatures: [{ inputs: [{ union: ['text', ...(['array', 'sequence', 'queue', 'stack', 'deque'] as const).map(collection => ({
            collection, element: orderedValue }))] }], result: 'wavelet' }],
        summary: 'Immutable wavelet matrix for range counts and sums.' },
    { name: 'within', module: 'algo', arities: [5], form: 'Data Left Right Low High within',
        signatures: [{ inputs: ['wavelet', 'integer', 'integer', orderedValue, orderedValue], result: 'integer' }],
        result: 'integer',
        summary: 'Counts wavelet values inside inclusive position and value ranges.' },

    { name: 'band', module: 'bits', arities: [2], form: 'A B band', result: 'integer',
        signatures: [{ inputs: ['integer', 'integer'], result: 'integer', ranks: [0, 0] }],
        shape: [{ args: [[], []], result: [] }],
        dyadicRanks: [0, 0], scalarNoCallback: 'integer', summary: 'Bitwise and.' },
    { name: 'binary', module: 'bits', arities: [1, 2], form: 'Value binary', result: 'text',
        signatures: [{ inputs: ['integer'], result: 'text', ranks: [0] },
            { inputs: ['integer', 'integer'], result: 'text' }],
        shape: [{ args: [[]], result: [{ exists: 'k' }] }, { args: [null, null], result: [{ exists: 'k' }] }],
        monadicRank: 0, scalarNoCallback: 'integer',
        summary: 'Formats a nonnegative integer as binary text, a width padding with zeroes.' },
    { name: 'bit', module: 'bits', arities: [2], form: 'Value Position bit', result: 'boolean',
        signatures: [{ inputs: ['integer', 'integer'], result: 'boolean', ranks: [0, 0] }],
        shape: [{ args: [null, null], result: [] }],
        scalarNoCallback: 'integer',
        dyadicRanks: [0, 0],
        summary: 'Tests a zero-based bit position.' },
    { name: 'bnot', module: 'bits', arities: [1], form: 'Value bnot', result: 'integer',
        signatures: [{ inputs: ['integer'], result: 'integer', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, scalarNoCallback: 'integer',
        summary: 'Bitwise not in infinite two-complement form, so the result is -Value - 1.' },
    { name: 'bor', module: 'bits', arities: [2], form: 'A B bor', result: 'integer',
        signatures: [{ inputs: ['integer', 'integer'], result: 'integer', ranks: [0, 0] }],
        shape: [{ args: [[], []], result: [] }],
        dyadicRanks: [0, 0], scalarNoCallback: 'integer', summary: 'Bitwise or.' },
    { name: 'bxor', module: 'bits', arities: [2], form: 'A B bxor', result: 'integer',
        signatures: [{ inputs: ['integer', 'integer'], result: 'integer', ranks: [0, 0] }],
        shape: [{ args: [[], []], result: [] }],
        dyadicRanks: [0, 0], scalarNoCallback: 'integer', summary: 'Bitwise exclusive or.' },
    { name: 'popcount', module: 'bits', arities: [1], form: 'Value popcount', result: 'integer',
        signatures: [{ inputs: ['integer'], result: 'integer', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, scalarNoCallback: 'integer', summary: 'Number of set bits in a nonnegative integer.' },
    { name: 'shl', module: 'bits', arities: [2], form: 'Value Count shl', result: 'integer',
        signatures: [{ inputs: ['integer', 'integer'], result: 'integer', ranks: [0, 0] }],
        shape: [{ args: [[], []], result: [] }],
        dyadicRanks: [0, 0], scalarNoCallback: 'integer', summary: 'Shifts left by a nonnegative bit count.' },
    { name: 'shr', module: 'bits', arities: [2], form: 'Value Count shr', result: 'integer',
        signatures: [{ inputs: ['integer', 'integer'], result: 'integer', ranks: [0, 0] }],
        shape: [{ args: [[], []], result: [] }],
        dyadicRanks: [0, 0], scalarNoCallback: 'integer', summary: 'Arithmetic shift right by a nonnegative bit count.' },

    { name: 'md5', module: 'crypto', arities: [1], form: 'Value md5', result: 'bytes',
        signatures: [{ inputs: [{ union: ['text', 'bytes'] }], result: 'bytes' }],
        compiledCall: { inputs: ['text-or-bytes'], result: 'bytes', callbacks: 'none', cost: 'host-dependent', hostFunction: 'md5' },
        summary: 'MD5 digest of bytes or UTF-8 text, as 16 bytes.' },

    { name: 'date', module: 'dates', arities: [1], form: 'Text date', result: 'date',
        signatures: dateMappingSignatures(dateInput, 'date'),
        summary: 'Parses YYYY-MM-DD or truncates a datetime to its calendar day.' },
    { name: 'calendar', module: 'dates', arities: [2, 3],
        signatures: [{ inputs: [dateInput, dateInput], result: 'table' },
            { inputs: ['database', dateInput, dateInput], result: 'view' }],
        form: 'Db Start End calendar', result: 'table', lazy: true,
        summary: 'Inclusive daily table; optional database keeps it as a SQLite view.' },
    { name: 'datetime', module: 'dates', arities: [1], form: 'Value datetime', result: 'datetime',
        signatures: dateMappingSignatures(dateInput, 'datetime'),
        summary: 'Parses a local timestamp or casts a date to midnight.' },
    { name: 'duration', module: 'dates', arities: [1], form: 'Seconds duration', result: 'duration',
        signatures: dateMappingSignatures({ union: ['number', 'duration'] }, 'duration'),
        lazy: true, summary: 'Creates an exact duration from integer seconds.' },
    { name: 'day', module: 'dates', arities: [1], form: 'Value day', result: 'integer',
        signatures: calendarComponentSignatures,
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Day of the month of a date or datetime.' },
    { name: 'hour', module: 'dates', arities: [1], form: 'Moment hour', result: 'integer',
        signatures: [{ inputs: ['datetime'], result: 'integer', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Hour of a datetime.' },
    { name: 'minute', module: 'dates', arities: [1], form: 'Moment minute', result: 'integer',
        signatures: [{ inputs: ['datetime'], result: 'integer', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Minute of a datetime.' },
    { name: 'month', module: 'dates', arities: [1], form: 'Value month', result: 'integer',
        signatures: calendarComponentSignatures,
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Month of a date or datetime.' },
    { name: 'monthstart', module: 'dates', arities: [1], form: 'Value monthstart', result: 'datetime',
        signatures: dateMappingSignatures(calendarValue, 'datetime'),
        lazy: true, summary: 'Midnight on the first day of the current month.' },
    { name: 'nextmonth', module: 'dates', arities: [1], form: 'Value nextmonth', result: 'datetime',
        signatures: dateMappingSignatures(calendarValue, 'datetime'),
        lazy: true, summary: 'Midnight on the first day of the following month.' },
    { name: 'second', module: 'dates', arities: [1], form: 'Moment second', result: 'integer',
        signatures: [{ inputs: ['datetime'], result: 'integer', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Second of a datetime.' },
    { name: 'seconds', module: 'dates', arities: [1], form: 'Duration seconds', result: 'integer',
        signatures: [{ inputs: ['duration'], result: 'integer', ranks: [0] },
            { inputs: ['column'], result: 'column', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Exact signed number of seconds in a duration.' },
    { name: 'weekday', module: 'dates', arities: [1], form: 'Value weekday', result: 'integer',
        signatures: [{ inputs: [calendarValue], result: 'integer', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Day of the week, Monday zero through Sunday six.' },
    { name: 'year', module: 'dates', arities: [1], form: 'Value year', result: 'integer',
        signatures: calendarComponentSignatures,
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Year of a date or datetime.' },

    { name: 'ancestor', module: 'graph', arities: [3], form: 'Rooted Vertex K ancestor',
        signatures: [{ inputs: ['record', graphVertex, 'integer'], result: graphVertex }],
        result: 'element', summary: 'Vertex K parent edges above another in a rooted tree.' },
    { name: 'bellmanford', module: 'graph', arities: [2], form: 'Graph Start bellmanford',
        signatures: [{ inputs: ['graph', graphVertex], result: 'record' }],
        result: 'record',
        summary: 'Shortest distances allowing negative weights, plus reachable negative cycles.' },
    { name: 'bfs', module: 'graph', arities: [2], form: 'Graph Start bfs', result: 'record',
        signatures: [{ inputs: ['graph', graphVertex], result: 'record' }],
        recordVertexArrays: ['order'], recordIndexValues: { distance: 'integer', parent: 'vertices' },
        summary: 'Breadth-first search returning distance, parent and discovery order.' },
    { name: 'bipartite', module: 'graph', arities: [1], form: 'Graph bipartite', result: 'record',
        signatures: [{ inputs: ['graph'], result: 'record' }],
        recordFields: { possible: 'boolean' },
        summary: 'Two-colouring of an undirected graph, or possible false for an odd cycle.' },
    { name: 'components', module: 'graph', arities: [1], form: 'Graph components', result: 'record',
        signatures: [{ inputs: ['graph'], result: 'record' }, { inputs: ['dsu'], result: 'integer' }],
        recordFields: { count: 'integer' },
        summary: 'Connected components: their count, a per-vertex index and the roots.' },
    { name: 'connected', module: 'graph', arities: [3], form: 'Dsu A B connected',
        signatures: [{ inputs: ['dsu', graphVertex, graphVertex], result: 'boolean' }],
        shape: [{ args: [null, null, null], result: [] }],
        result: 'boolean',
        summary: 'True when two values share a disjoint-set representative.' },
    { name: 'cycle', module: 'graph', arities: [1], form: 'Graph cycle', result: 'array',
        signatures: [{ inputs: ['graph'], result: graphVertexArray }],
        summary: 'One cycle with its first vertex repeated at the end, or an empty array.' },
    { name: 'dfs', module: 'graph', arities: [2], form: 'Graph Start dfs', result: 'record',
        signatures: [{ inputs: ['graph', graphVertex], result: 'record' }],
        recordVertexArrays: ['order'], recordIndexValues: { distance: 'integer', parent: 'vertices' },
        summary: 'Depth-first search returning distance, parent and discovery order.' },
    { name: 'dijkstra', module: 'graph', arities: [2], form: 'Graph Start dijkstra',
        signatures: [{ inputs: ['graph', graphVertex], result: 'record' }],
        result: 'record', recordVertexArrays: ['order'],
        recordIndexValues: { distance: 'number', parent: 'vertices' },
        summary: 'Shortest distances for nonnegative numeric weights.' },
    { name: 'distance', module: 'graph', arities: [3], form: 'Rooted A B distance',
        signatures: [{ inputs: ['record', graphVertex, graphVertex], result: 'integer' },
            { inputs: ['functional', 'integer', 'integer'], result: 'integer' }],
        result: 'integer',
        summary: 'Edges between two vertices of a rooted tree or functional graph.' },
    { name: 'euler', module: 'graph', arities: [2], form: 'Graph Start euler', result: 'array',
        signatures: [{ inputs: ['graph', graphVertex], result: graphVertexArray }],
        summary: 'Euler trail using every edge once, or an empty array when none exists.' },
    { name: 'findroot', module: 'graph', arities: [2], form: 'Dsu Value findroot', result: 'element',
        signatures: [{ inputs: ['dsu', graphVertex], result: graphVertex, ranks: ['all', 0] }],
        shape: [{ args: [null, []], result: [] }],
        dyadicRanks: ['all', 0],
        summary: 'Representative of the disjoint-set component holding a value.' },
    { name: 'floyd', module: 'graph', arities: [1], form: 'Graph floyd', result: 'record',
        signatures: [{ inputs: ['graph'], result: 'record' }],
        summary: 'All-pairs shortest distances addressed Distance From To.' },
    { name: 'functional', module: 'graph', arities: [1], form: 'Next functional',
        signatures: [{ inputs: [{ collection: 'array', element: 'integer' }], result: 'functional' }],
        result: 'functional',
        summary: 'Successor structure prepared for jump, distance and path queries.' },
    { name: 'jump', module: 'graph', arities: [3], form: 'F Start Steps jump', result: 'integer',
        signatures: [{ inputs: ['functional', 'integer', 'integer'], result: 'integer' }],
        summary: 'Vertex reached after exactly that many successor steps.' },
    { name: 'lca', module: 'graph', arities: [3], form: 'Rooted A B lca', result: 'element',
        signatures: [{ inputs: ['record', graphVertex, graphVertex], result: graphVertex }],
        summary: 'Lowest common ancestor of two vertices.' },
    { name: 'lengths', module: 'graph', arities: [1], form: 'F lengths', result: 'array',
        signatures: [{ inputs: ['functional'], result: { collection: 'array', element: 'integer' } }],
        shape: [{ args: [null], result: [{ exists: 'k' }] }],
        denseElements: ['integer'],
        summary: 'Path length from every vertex of a functional graph.' },
    { name: 'maxflow', module: 'graph', arities: [3], form: 'Graph Source Sink maxflow',
        signatures: [{ inputs: ['graph', graphVertex, graphVertex], result: 'record' }],
        result: 'record', recordFields: { value: 'number' },
        summary: 'Maximum flow value, the per-edge flow and the minimum cut.' },
    { name: 'mst', module: 'graph', arities: [1], form: 'Graph mst', result: 'record',
        signatures: [{ inputs: ['graph'], result: 'record' }],
        recordFields: { connected: 'boolean', components: 'integer', weight: 'number' },
        summary: 'Minimum spanning forest: connectivity, component count, weight and edges.' },
    { name: 'pathlengths', module: 'graph', arities: [1], form: 'Tree pathlengths',
        signatures: [{ inputs: ['graph'], result: { collection: 'sequence', element: 'integer' } }],
        result: 'sequence', lazy: true,
        summary: 'Lazy sequence of every unordered pair distance in a tree.' },
    { name: 'root', module: 'graph', arities: [2], form: 'Tree Root root', result: 'record',
        signatures: [{ inputs: ['graph', graphVertex], result: 'record' }],
        recordVertexFields: ['root'], recordVertexArrays: ['order'],
        recordIndexValues: { parent: 'vertices', depth: 'integer', entry: 'integer',
            size: 'integer', head: 'vertices' },
        summary: 'Immutable rooted view of a connected undirected tree.' },
    { name: 'scc', module: 'graph', arities: [1], form: 'Graph scc', result: 'record',
        signatures: [{ inputs: ['graph'], result: 'record' }],
        recordFields: { count: 'integer' },
        summary: 'Strongly connected components of a directed graph.' },
    { name: 'topological', module: 'graph', arities: [1], form: 'Graph topological',
        signatures: [{ inputs: ['graph'], result: 'record' }],
        result: 'record', recordFields: { possible: 'boolean', order: 'array' }, recordVertexArrays: ['order'],
        summary: 'Topological order of a directed graph, or possible false.' },
    { name: 'upto', module: 'graph', arities: [3], form: 'F Start Limit upto', result: 'value',
        signatures: [{ inputs: ['functional', 'integer', 'integer'], result: { union: ['integer', 'record'] } }],
        summary: 'Counts path vertices through a limit; weighted paths return count, sum and last.' },
    { name: 'weighted', module: 'graph', arities: [2], form: 'Next Cost weighted',
        signatures: [{ inputs: [{ collection: 'array', element: 'integer' }, numericArray], result: 'functional' }],
        result: 'functional',
        summary: 'Functional graph carrying numeric edge costs along its paths.' },

    { name: 'images', module: 'images', arities: [1], form: 'Directory images', result: 'table',
        signatures: [{ inputs: ['text'], result: { collection: 'array', element: 'object' } }],
        effects: ['io'],
        summary: 'Table of the JPEG and PNG files in a directory, with name and path.' },
    { name: 'resize', module: 'images', arities: [3], form: 'Images Height Width resize',
        signatures: [{ inputs: [{ collection: 'array', element: 'object' }, 'integer', 'integer'],
            result: { collection: 'array', element: 'integer' } }],
        result: 'array', lazy: true, effects: ['io'],
        summary: 'Decodes every image and stretches it into a lazy RGB tensor.' },

    { name: 'neighbors', module: 'grids', arities: [3, 4], form: 'Grid Row Column .eight neighbors', result: 'array',
        signatures: [{ inputs: ['array', 'integer', 'integer'], result: { collection: 'array', element: 'integer' } },
            { inputs: ['array', 'integer', 'integer', { union: [{ label: 'four' }, { label: 'eight' }] }], result: { collection: 'array', element: 'integer' } }],
        shape: [{ args: [null, null, null], result: [{ exists: 'k' }, 2] }, { args: [null, null, null, null], result: [{ exists: 'k' }, 2] }],
        denseElements: ['integer'],
        summary: 'In-bounds row and column pairs around one grid cell; four neighbors by default.' },
    { name: 'segments', module: 'grids', arities: [2], form: 'Grid Width segments', result: 'array',
        signatures: [{ inputs: [genericArray, 'integer'], result: genericArray }],
        summary: 'All in-bounds horizontal, vertical and diagonal segments of a fixed width.' },

    { name: 'append', module: 'io', arities: [2], form: 'Text Path append', result: 'text',
        signatures: [{ inputs: ['text', 'text'], result: 'text' }],
        effects: ['io'], summary: 'Appends UTF-8 text to a file, creating it when missing.' },
    { name: 'close', module: 'io', arities: [1], form: 'File close', result: 'file',
        signatures: [{ inputs: ['file'], result: 'file' }],
        effects: ['io'],
        summary: 'Closes a file early; closing an already closed file does nothing.' },
    { name: 'eof', module: 'io', arities: [1], form: 'File eof', result: 'boolean',
        signatures: [{ inputs: ['file'], result: 'boolean' }],
        shape: [{ args: [null], result: [] }],
        effects: ['io'],
        summary: 'True when the position is at or past the end of the file.' },
    { name: 'flush', module: 'io', arities: [1], form: 'File flush', result: 'file',
        signatures: [{ inputs: ['file'], result: 'file' }],
        effects: ['io'], summary: 'Asks the host to write buffered output to the file system.' },
    { name: 'open', module: 'io', arities: [1, 2], form: 'Path open', result: 'file',
        signatures: [{ inputs: ['text'], result: 'file' }, { inputs: ['text', { union: [{ label: 'write' }, { label: 'update' }, { label: 'append' }] }], result: 'file' }],
        effects: ['io'],
        summary: 'Opens a file, read-only unless a mode label selects write, update or append.' },
    { name: 'position', module: 'io', arities: [1], form: 'File position', result: 'integer',
        signatures: [{ inputs: ['file'], result: 'integer' }],
        shape: [{ args: [null], result: [] }],
        effects: ['io'], summary: 'Current byte offset of an open file.' },
    { name: 'print', module: 'io', arities: [1], form: 'Value print', result: 'same',
        signatures: [{ inputs: [{ variable: 0 }], result: { variable: 0 } }],
        effects: ['io'],
        summary: 'Writes one line and returns the value, so a pipeline continues.' },
    { name: 'read', module: 'io', arities: [1], form: 'Path read', result: 'text',
        signatures: [{ inputs: ['text'], result: 'text' }],
        effects: ['io'],
        summary: 'Complete decoded UTF-8 text of a file, final line ending included.' },
    { name: 'readbytes', module: 'io', arities: [2, 3], form: 'Path Offset Count readbytes',
        signatures: [{ inputs: ['file', 'integer'], result: 'bytes' },
            { inputs: ['text', 'integer', 'integer'], result: 'bytes' }],
        result: 'bytes', effects: ['io'],
        summary: 'Reads a block of bytes by offset, or the next Count bytes of an open file.' },
    { name: 'readlines', module: 'io', arities: [1], form: 'Path readlines', result: 'array', dataLength: true,
        signatures: [{ inputs: ['text'], result: { collection: 'array', element: 'text' } }],
        effects: ['io'], summary: 'Lines of a file with their separators removed.' },
    { name: 'seek', module: 'io', arities: [2], form: 'File Offset seek', result: 'file',
        signatures: [{ inputs: ['file', 'integer'], result: 'file' }],
        effects: ['io'], summary: 'Sets an absolute byte offset from the beginning.' },
    { name: 'size', module: 'io', arities: [1], form: 'File size', result: 'integer',
        signatures: [{ inputs: ['file'], result: 'integer' }],
        shape: [{ args: [null], result: [] }],
        effects: ['io'], summary: 'Length of an open file in bytes.' },
    { name: 'write', module: 'io', arities: [2], form: 'Text Path write', result: 'text',
        signatures: [{ inputs: ['text', 'text'], result: 'text' }],
        effects: ['io'], summary: 'Creates or replaces a file with UTF-8 text.' },
    { name: 'writebytes', module: 'io', arities: [2], form: 'File Bytes writebytes',
        signatures: [{ inputs: ['file', 'bytes'], result: 'file' }],
        result: 'file', effects: ['io'], summary: 'Writes a bytes value to an open file.' },

    { name: 'json', module: 'json', arities: [1, 2], form: 'Text json', result: 'value', modifiers: ['flat'],
        signatures: [{ inputs: ['text'], result: { union: ['number', 'boolean', 'text', 'symbol', 'array', 'tuple', 'object'] } },
            { inputs: ['text', { label: 'flat' }], result: { collection: 'array', element: 'object' } }],
        summary: 'Decodes a complete JSON document into Rank values.' },


    { name: 'det', module: 'linalg', arities: [1], form: 'Matrix det', result: 'number',
        signatures: [{ inputs: [{ collection: 'array', element: 'integer' }], result: 'integer', ranks: [2] },
            { inputs: [{ collection: 'array', element: 'real' }], result: 'number', ranks: [2] }],
        shape: [{ args: [['n', 'n']], result: [] }],
        monadicRank: 2, summary: 'Determinant of a square numeric matrix, exact for integers.' },
    { name: 'diag', module: 'linalg', arities: [1], form: 'Values diag', result: 'array',
        signatures: [{ inputs: [numericArray], result: numericArray }],
        summary: 'Diagonal matrix from a vector, or the main diagonal of a matrix.' },
    { name: 'eigh', module: 'linalg', arities: [1], form: 'Matrix eigh', result: 'tuple',
        signatures: [{ inputs: [numericArray], result: { tuple: [realArray, realArray] } }],
        summary: 'Ascending eigenvalues and their eigenvector columns of a symmetric matrix.' },
    { name: 'inverse', module: 'linalg', arities: [1], form: 'Matrix inverse', result: 'array',
        signatures: [{ inputs: [numericArray], result: realArray, ranks: [2] }],
        shape: [{ args: [['n', 'n']], result: ['n', 'n'] }],
        monadicRank: 2, lazy: true,
        summary: 'Inverse of a square matrix, one trailing cell at a time.' },
    { name: 'matmul', module: 'linalg', arities: [2], form: 'A B matmul', result: 'array',
        signatures: [{ inputs: [numericArray, numericArray], result: { union: ['number', numericArray] } }],
        lazy: true, numericArrayNoCallback: true,
        summary: 'Contracts the last axis of the left array with the first axis of the right.' },
    { name: 'solve', module: 'linalg', arities: [2], form: 'A B solve', result: 'array',
        signatures: [{ inputs: [numericArray, numericArray], result: realArray }],
        shape: [{ args: [['n', 'n'], [{ spread: 's' }]], result: [{ spread: 's' }] }],
        numericArrayNoCallback: true,
        summary: 'Solves A * X = B for a square coefficient matrix.' },

    { name: 'abs', module: 'numbers', arities: [1], form: 'Value abs', result: 'number',
        signatures: [{ inputs: ['integer'], result: 'integer', ranks: [0] },
            { inputs: ['real'], result: 'real', ranks: [0] }, { inputs: ['missing'], result: 'missing', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, scalarNoCallback: 'number', preservesNumericScalarType: true,
        summary: 'Absolute value, keeping the integer or real type.' },
    { name: 'acos', module: 'numbers', arities: [1], form: 'Value acos', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Inverse cosine in radians, for values from -1 through 1.' },
    { name: 'acosh', module: 'numbers', arities: [1], form: 'Value acosh', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Inverse hyperbolic cosine, for values at least 1.' },
    { name: 'asin', module: 'numbers', arities: [1], form: 'Value asin', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Inverse sine in radians, for values from -1 through 1.' },
    { name: 'asinh', module: 'numbers', arities: [1], form: 'Value asinh', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Inverse hyperbolic sine.' },
    { name: 'atan', module: 'numbers', arities: [1], form: 'Value atan', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Inverse tangent in radians.' },
    { name: 'atan2', module: 'numbers', arities: [2], form: 'Y X atan2', result: 'real',
        signatures: [{ inputs: ['number', 'number'], result: 'real', ranks: [0, 0] },
            { inputs: ['missing', 'unknown'], result: 'missing', ranks: [0, 0] },
            { inputs: ['unknown', 'missing'], result: 'missing', ranks: [0, 0] }],
        shape: [{ args: [[], []], result: [] }],
        dyadicRanks: [0, 0],
        summary: 'Angle in radians from the coordinates, keeping the quadrant.' },
    { name: 'atanh', module: 'numbers', arities: [1], form: 'Value atanh', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Inverse hyperbolic tangent, for values strictly between -1 and 1.' },
    { name: 'binomial', module: 'numbers', arities: [2], form: 'N K binomial', result: 'integer',
        signatures: [...integerDyadicSignatures,
            { inputs: ['missing', 'unknown'], result: 'missing', ranks: [0, 0] },
            { inputs: ['unknown', 'missing'], result: 'missing', ranks: [0, 0] }],
        shape: [{ args: [[], []], result: [] }],
        dyadicRanks: [0, 0], summary: 'Exact binomial coefficient.' },
    { name: 'binomialmod', module: 'numbers', arities: [3], form: 'N K Modulus binomialmod',
        signatures: [{ inputs: ['integer', 'integer', 'integer'], result: 'integer' }],
        shape: [{ args: [null, null, null], result: [] }],
        result: 'integer', scalarNoCallback: 'integer',
        summary: 'Binomial coefficient calculated directly modulo a prime.' },
    { name: 'cos', module: 'numbers', arities: [1], form: 'Angle cos', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Cosine of an angle in radians.' },
    { name: 'cosh', module: 'numbers', arities: [1], form: 'Value cosh', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Hyperbolic cosine.' },
    { name: 'divisors', module: 'numbers', arities: [1], form: 'N divisors', result: 'sequence',
        signatures: [{ inputs: ['integer'], result: { collection: 'sequence', element: 'integer' } }],
        lazy: true, summary: 'Lazy ascending sequence of the positive divisors.' },
    { name: 'even', module: 'numbers', arities: [1], form: 'Value even', result: 'boolean',
        signatures: integerPredicateSignatures,
        scalarNoCallback: 'integer', summary: 'True for an even integer.' },
    { name: 'exp', module: 'numbers', arities: [1], form: 'Value exp', result: 'real',
        signatures: realMathSignatures,
        scalarNoCallback: 'number', mapsScalarCells: true,
        summary: 'Natural exponential.' },
    { name: 'factors', module: 'numbers', arities: [1], form: 'N factors', result: 'sequence',
        signatures: [{ inputs: ['integer'], result: { collection: 'sequence', element: 'integer' } }],
        lazy: true,
        summary: 'Lazy ascending sequence of the prime factors, repeated factors included.' },
    { name: 'gcd', module: 'numbers', arities: [2], form: 'A B gcd', result: 'integer',
        signatures: integerDyadicSignatures,
        shape: [{ args: [null, null], result: [] }],
        scalarNoCallback: 'integer',
        dyadicRanks: [0, 0],
        summary: 'Greatest common divisor, always nonnegative.' },
    { name: 'infinity', module: 'numbers', arities: [], form: 'infinity', result: 'real',
        summary: 'The positive infinite real value.' },
    { name: 'isnan', module: 'numbers', arities: [1], form: 'Value isnan', result: 'boolean',
        signatures: mappingSignatures(numericCells, 'boolean'),
        scalarNoCallback: 'number', summary: 'True for the real value nan; it does not equal itself.' },
    { name: 'isqrt', module: 'numbers', arities: [1], form: 'Value isqrt', result: 'integer',
        signatures: [{ inputs: ['integer'], result: 'integer', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, scalarNoCallback: 'integer',
        summary: 'Exact integer floor of the square root, calculated without reals.' },
    { name: 'lcm', module: 'numbers', arities: [1, 2], form: 'A B lcm', result: 'integer',
        signatures: [...integerDyadicSignatures, { inputs: [{ union: ['integer',
            { collection: 'array', element: 'integer' }, { collection: 'sequence', element: 'integer' }] }], result: 'integer' }],
        shape: [{ args: [null], result: [] }, { args: [null, null], result: [] }],
        dyadicRanks: [0, 0],
        summary: 'Least common multiple, also a reduction over one finite collection.' },
    { name: 'log', module: 'numbers', arities: [1], form: 'Value log', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Natural logarithm of a positive finite number.' },
    { name: 'max', module: 'core', arities: [1, 2], form: 'Left Right max', result: 'number', axisReduction: true,
        modifiers: ['index', 'indexed'],
        signatures: [...extremaSignatures, { inputs: ['column'], result: 'number' }, ...positionSignatures],
        shape: [{ args: [null], result: [] }, { args: [[], []], result: [] }],
        dyadicRanks: [0, 0], scalarCellArrayNoCallback: 'number', numericArrayNoCallback: true,
        selectsNumericCell: true,
        summary: 'Larger of two numbers, or the largest of one collection.' },
    { name: 'min', module: 'core', arities: [1, 2], form: 'Left Right min', result: 'number', axisReduction: true,
        modifiers: ['index', 'indexed'],
        signatures: [...extremaSignatures, ...positionSignatures],
        shape: [{ args: [null], result: [] }, { args: [[], []], result: [] }],
        dyadicRanks: [0, 0], scalarCellArrayNoCallback: 'number', numericArrayNoCallback: true,
        selectsNumericCell: true,
        summary: 'Smaller of two numbers, or the smallest of one collection.' },
    { name: 'nan', module: 'numbers', arities: [], form: 'nan', result: 'real',
        summary: 'The real not-a-number value, for a result or cell with no numeric value.' },
    { name: 'odd', module: 'numbers', arities: [1], form: 'Value odd', result: 'boolean',
        signatures: integerPredicateSignatures,
        scalarNoCallback: 'integer', summary: 'True for an odd integer.' },
    { name: 'powmod', module: 'numbers', arities: [3], form: 'Base Exponent Modulus powmod',
        signatures: [{ inputs: ['integer', 'integer', 'integer'], result: 'integer' }],
        shape: [{ args: [null, null, null], result: [] }],
        result: 'integer', scalarNoCallback: 'integer',
        summary: 'Modular exponentiation by repeated squaring, never building the full power.' },
    { name: 'round', module: 'numbers', arities: [2], form: 'Value Places round', result: 'number',
        signatures: [{ inputs: ['integer', 'integer'], result: 'integer', ranks: [0, 0] },
            { inputs: ['real', 'integer'], result: 'real', ranks: [0, 0] }],
        shape: [{ args: [[{ spread: 's' }], null], result: [{ spread: 's' }] }],
        scalarNoCallback: 'number', numericArrayNoCallback: true, preservesCollectionElements: true,
        dyadicRanks: [0, 0],
        summary: 'Rounds to a signed number of decimal places, halfway values to even.' },
    { name: 'sin', module: 'numbers', arities: [1], form: 'Angle sin', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Sine of an angle in radians.' },
    { name: 'sinh', module: 'numbers', arities: [1], form: 'Value sinh', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Hyperbolic sine.' },
    { name: 'sqrt', module: 'numbers', arities: [1], form: 'Value sqrt', result: 'real',
        signatures: [{ inputs: ['number'], result: 'real', ranks: [0] },
            { inputs: ['missing'], result: 'missing', ranks: [0] }],
        shape: [{ args: [[]], result: [] }],
        monadicRank: 0, summary: 'Real square root of a nonnegative number.' },
    { name: 'sum', module: 'core', arities: [1], form: 'Values sum', result: 'number', axisReduction: true,
        signatures: [{ inputs: [numericReductionInputs], result: 'number' }],
        operandDomains: [['integer', 'real', 'missing']],
        shape: [{ args: [null], result: [] }],
        scalarCellArrayNoCallback: 'number',
        summary: 'Adds every numeric cell of an array, collection or finite sequence.' },
    { name: 'tan', module: 'numbers', arities: [1], form: 'Angle tan', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Tangent of an angle in radians.' },
    { name: 'tanh', module: 'numbers', arities: [1], form: 'Value tanh', result: 'real', mapsScalarCells: true,
        signatures: realMathSignatures,
        summary: 'Hyperbolic tangent.' },

    { name: 'choices', module: 'random', arities: [2], form: 'Values Count choices',
        signatures: [{ inputs: [randomInput, 'integer'], result: genericArray }],
        result: 'array', effects: ['random'],
        summary: 'Draws Count values with replacement, complete cells for a tensor.' },
    { name: 'seed', module: 'random', arities: [1], form: 'Seed seed', result: 'integer',
        signatures: [{ inputs: ['integer'], result: 'integer' }],
        shape: [{ args: [null], result: [] }],
        effects: ['random'],
        summary: 'Restarts the pseudorandom stream of the session and returns the seed.' },
    { name: 'shuffle', module: 'random', arities: [1, 2], form: 'Values shuffle', result: 'array',
        signatures: [{ inputs: [randomInput], result: genericArray },
            { inputs: [randomInput, 'integer'], result: genericArray }],
        effects: ['random'],
        summary: 'New array in random order; a seed makes the order repeatable.' },
    { name: 'uniform', module: 'random', arities: [3], form: 'Shape Low High uniform',
        signatures: [{ inputs: [{ collection: 'array', element: 'integer' }, 'number', 'number'], result: realArray }],
        result: 'array', effects: ['random'],
        summary: 'Real tensor drawn from the half-open interval between the bounds.' },

    { name: 'all', module: 'sequences', arities: [1], form: 'Mask all', result: 'boolean', axisReduction: true,
        signatures: [{ inputs: [booleanCollection], result: 'boolean' }],
        shape: [{ args: [null], result: [] }],
        scalarCellArrayNoCallback: 'boolean',
        summary: 'True when every boolean cell is true; empty collections are true.' },
    { name: 'any', module: 'sequences', arities: [1], form: 'Mask any', result: 'boolean', axisReduction: true,
        signatures: [{ inputs: [booleanCollection], result: 'boolean' }],
        shape: [{ args: [null], result: [] }],
        scalarCellArrayNoCallback: 'boolean',
        summary: 'True when one boolean cell is true; empty collections are false.' },
    { name: 'argsort', module: 'sequences', arities: [1, 2], form: 'Values argsort .descending', result: 'array', sortDirection: true,
        signatures: [{ inputs: [{ union: ['text', { collection: 'array', element: orderedValue }] }], result: integerArray, ranks: [1] },
            { inputs: [{ union: ['text', { collection: 'array', element: orderedValue }] }, sortDirection], result: integerArray }],
        shape: [{ args: [['d']], result: ['d'] }, { args: [['d'], []], result: ['d'] }],
        monadicRank: 1, summary: 'Stable zero-based positions that put the values in order.' },
    { name: 'choose', module: 'core', arities: [2, 3],
        signatures: [{ inputs: [{ union: ['integer', integerArray] }, genericArray], result: { union: [elementVariable, 'array'] } },
            { inputs: [{ union: ['boolean', booleanArray, 'column'] }, { variable: 0 }, { variable: 1 }],
                result: { union: [{ variable: 0 }, { variable: 1 }, 'array', 'column'] } }],
        form: 'Mask choose TrueValues FalseValues', result: 'value', lazy: true,
        summary: 'Selects each cell by a boolean mask; SQLite expressions become CASE.' },
    { name: 'copy', module: 'sequences', arities: [1], form: 'Values copy', result: 'array',
        signatures: [{ inputs: [{ union: ['array', 'bytes', 'sequence'] }], result: 'array' },
            { inputs: ['segment'], result: 'segment' }],
        summary: 'Independent dense copy of an array or finite sequence; equally shaped array or sequence items stack.' },
    { name: 'count', module: 'sequences', arities: [1], form: 'Mask count', result: 'integer', axisReduction: true,
        signatures: [{ inputs: [booleanCollection], result: 'integer' }],
        shape: [{ args: [null], result: [] }],
        scalarCellArrayNoCallback: 'boolean',
        summary: 'Number of true cells, or of source items a lazy mask selects.' },
    { name: 'find', module: 'sequences', arities: [2], form: 'Values Target find', result: 'integer',
        signatures: [{ inputs: [{ union: ['text', 'array'] }, 'unknown'], result: 'integer', ranks: ['all', 0] }],
        shape: [{ args: [null, []], result: [] }],
        dyadicRanks: ['all', 0],
        summary: 'First zero-based position equal to Target in a vector or text; an array of targets finds each.' },
    { name: 'findall', module: 'sequences', arities: [2], form: 'Values Target findall', result: 'array',
        signatures: [{ inputs: [{ union: ['text', 'array'] }, 'unknown'], result: integerArray, ranks: ['all', 0] }],
        dyadicRanks: ['all', 0], arrayCells: true, dataLength: true,
        shape: [{ args: [null, []], result: null }],
        summary: 'Every zero-based position equal to Target in a vector or text; an array of targets needs equal counts.' },
    { name: 'flat', module: 'sequences', arities: [1, 2], form: 'Values flat', result: 'array',
        signatures: [{ inputs: [{ collection: 'array', element: 'record' }], result: { collection: 'array', element: 'record' } },
            { inputs: ['integer', 'record'], result: { collection: 'array', element: 'record' } }],
        summary: 'Copies records into fixed-width storage; Count State flat initializes a compact array.' },
    { name: 'fibonacci', module: 'sequences', arities: [], form: 'fibonacci', result: 'sequence',
        lazy: true, valueElements: 'integer', valueCallbackFree: true,
        summary: 'Unbounded lazy Fibonacci numbers; bound with to, till, from or after.' },
    { name: 'indices', module: 'sequences', arities: [1], form: 'Mask indices', result: 'array',
        signatures: [{ inputs: [booleanArray], result: integerArray }],
        summary: 'Zero-based positions of the true values in a boolean vector.' },
    { name: 'reverse', module: 'sequences', arities: [1], form: 'Values reverse', result: 'value',
        signatures: [
            { inputs: ['text'], result: 'text' },
            { inputs: [{ collection: 'array', element: { variable: 0 } }], result: { collection: 'array', element: { variable: 0 } } },
            { inputs: [{ union: (['queue', 'stack', 'deque', 'sequence'] as const).map(collection => ({
                collection, element: { variable: 0 },
            })) }], result: { collection: 'array', element: { variable: 0 } } },
        ],
        compiledCall: { inputs: ['text'], result: 'text', callbacks: 'none', cost: 'input-dependent' },
        summary: 'Reverses text by code point, an array along its leading axis, or a queue or finite sequence into an array.' },
    { name: 'first', module: 'sequences', arities: [1], form: 'Values first', result: 'element',
        signatures: collectionEnds,
        summary: 'First item of text, an array, a queue or a sequence; missing when empty.' },
    { name: 'last', module: 'sequences', arities: [1], form: 'Values last', result: 'element',
        signatures: collectionEnds,
        summary: 'Last item of text, an array, a queue or a finite sequence; missing when empty.' },
    { name: 'len', module: 'core', arities: [1], form: 'Value len', result: 'integer',
        signatures: [{ inputs: [{ union: ['text', 'bytes', 'array', 'tuple', 'table', 'queue', 'stack', 'deque', 'heap',
            'set', 'counter', 'multiset', 'object', 'graph', 'dsu', 'segment', 'wavelet', 'sequence'] }], result: 'integer' }],
        compiledCall: { inputs: ['text-or-array'], result: 'integer', callbacks: 'none', cost: 'input-dependent' },
        arrayHeaderNoCallback: true,
        summary: 'Code points of text, leading axis of an array, or size of a collection.' },
    { name: 'present', module: 'core', arities: [1], form: 'Values present', result: 'boolean',
        signatures: [{ inputs: ['unknown'], result: { union: ['boolean', booleanArray, { collection: 'sequence', element: 'boolean' }] } }],
        summary: 'Mask of the cells that have a value: false for `.NA` and for cells that read as `.Missing`.' },
    { name: 'primes', module: 'sequences', arities: [], form: 'primes', result: 'sequence',
        lazy: true, valueElements: 'integer', valueCallbackFree: true,
        summary: 'Unbounded ascending primes, with planned membership and positional seeking.' },
    { name: 'reshape', module: 'sequences', arities: [1], form: 'Values reshape Dims... | Values reshape unpack Shape',
        formOnly: true,
        result: 'array',
        summary: 'Dense array in row-major order; unpack a shape vector or matrix of shape rows when needed.' },
    { name: 'shape', module: 'sequences', arities: [1], form: 'Value shape', result: 'array',
        signatures: [{ inputs: [{ union: ['text', 'array', 'bytes', 'queue', 'stack', 'deque', 'multiset', 'segment', 'wavelet', 'sequence'] }], result: integerArray }],
        arrayHeaderNoCallback: true,
        summary: 'Axis lengths as a rank-1 array.' },
    { name: 'merge', module: 'sequences', arities: [1, 2], form: 'Streams merge .descending', result: 'sequence', sortDirection: true,
        signatures: [{ inputs: [genericArray], result: { collection: 'sequence', element: elementVariable } },
            { inputs: [genericArray, genericArray], result: { collection: 'sequence', element: elementVariable } },
            { inputs: [{ collection: 'sequence', element: elementVariable },
                { collection: 'sequence', element: elementVariable }],
            result: { collection: 'sequence', element: elementVariable } },
            { inputs: [genericArray, { collection: 'sequence', element: elementVariable }],
                result: { collection: 'sequence', element: elementVariable } },
            { inputs: [{ collection: 'sequence', element: elementVariable }, genericArray],
                result: { collection: 'sequence', element: elementVariable } }],
        lazy: true,
        summary: 'Lazily merges sorted streams or matrix rows, ascending by default.' },
    { name: 'sort', module: 'sequences', arities: [1, 2], form: 'Values sort .descending', result: 'array', sortDirection: true,
        signatures: [{ inputs: ['text'], result: 'text', ranks: [1] },
            { inputs: [{ collection: 'array', element: orderedValue }], result: { collection: 'array', element: orderedValue }, ranks: [1] },
            { inputs: ['text', sortDirection], result: 'text' },
            { inputs: [{ collection: 'array', element: orderedValue }, sortDirection], result: { collection: 'array', element: orderedValue } }],
        shape: [{ args: [['d']], result: ['d'] }, { args: [['d'], []], result: ['d'] }],
        monadicRank: 1, summary: 'Stable sort into a new rank-1 array, ascending by default.' },
    { name: 'transpose', module: 'sequences', arities: [1], form: 'Matrix transpose',
        signatures: [{ inputs: [genericArray], result: genericArray }],
        result: 'array', numericArrayNoCallback: true,
        summary: 'Reverses the axes of an array.' },
    { name: 'unique', module: 'sequences', arities: [1], form: 'Values unique', result: 'array',
        signatures: [{ inputs: ['text'], result: 'text' }, { inputs: [genericArray], result: genericArray },
            ...(['queue', 'stack', 'deque'] as const).map(collection => ({ inputs: [{ collection, element: elementVariable }],
                result: { collection: 'queue' as const, element: elementVariable } })),
            ...(['sequence', 'set'] as const).map(collection => ({ inputs: [{ collection, element: elementVariable }],
                result: { collection, element: elementVariable } })), { inputs: ['view'], result: 'view' }],
        shape: [{ args: [['d']], result: [{ exists: 'k' }] }],
        monadicRank: 1, summary: 'Distinct values in first-appearance order.' },
    { name: 'window', module: 'sequences', arities: [2], form: 'Values window Width',
        signatures: [{ inputs: ['text', { union: ['integer', integerArray] }], result: { collection: 'sequence', element: 'text' } },
            { inputs: [{ union: (['array', 'queue', 'stack', 'deque'] as const).map(collection => ({
                collection, element: elementVariable })) }, { union: ['integer', integerArray] }], result: genericArray },
            { inputs: [{ collection: 'sequence', element: elementVariable }, { union: ['integer', integerArray] }],
                result: { union: [genericArray, { collection: 'sequence', element: genericArray }] } }],
        result: 'array', lazy: true,
        summary: 'Overlapping complete cells of that size, with optional stride, padding and padding value.' },
    { name: 'shift', module: 'sequences', arities: [2], form: 'Values Count shift',
        signatures: [{ inputs: [genericArray, 'integer'], result: { collection: 'array', element: { union: [elementVariable, 'integer'] } } }],
        result: 'array', lazy: true,
        summary: 'Moves items along an axis, keeping the shape; vacated positions read zero or a with value.' },

    { name: 'correlation', module: 'stats', arities: [1], form: 'Features correlation',
        signatures: [{ inputs: [numericArray], result: realArray }],
        result: 'array', lazy: true,
        summary: 'Pearson correlation matrix over feature and observation axes.' },
    { name: 'corr', module: 'stats', arities: [1], form: 'Features corr',
        signatures: [{ inputs: [numericArray], result: realArray }],
        result: 'array', lazy: true,
        summary: 'Alias for correlation.' },
    { name: 'covariance', module: 'stats', arities: [1], form: 'Features covariance',
        signatures: [{ inputs: [numericArray], result: realArray }],
        result: 'array', lazy: true,
        summary: 'Sample covariance matrix over feature and observation axes.' },
    { name: 'mae', module: 'stats', arities: [2], form: 'Pred Target mae', result: 'real',
        signatures: metricSignatures,
        summary: 'Mean absolute error between two broadcast numeric values.' },
    { name: 'mean', module: 'stats', arities: [1], form: 'Values mean', result: 'real', axisReduction: true,
        signatures: statisticalSignatures,
        summary: 'Arithmetic mean, missing table cells skipped.' },
    { name: 'median', module: 'stats', arities: [1], form: 'Values median', result: 'real', axisReduction: true,
        signatures: statisticalSignatures,
        summary: 'Middle value of a sorted copy, averaging the two middle values when even.' },
    { name: 'mode', module: 'stats', arities: [1], form: 'Values mode', result: 'value', axisReduction: true,
        signatures: [{ inputs: [{ union: [{ collection: 'array', element: { variable: 0 } },
            { collection: 'sequence', element: { variable: 0 } }] }], result: { variable: 0 } },
            { inputs: ['unknown'], result: 'unknown' }],
        summary: 'Most frequent value in a collection or array.' },
    { name: 'mse', module: 'stats', arities: [2], form: 'Pred Target mse', result: 'real',
        signatures: metricSignatures,
        summary: 'Mean squared error between two broadcast numeric values.' },
    { name: 'percentile', module: 'stats', arities: [1, 2], form: 'Values P percentile', result: 'value', dyadicRanks: [1, 0],
        signatures: quantileSignatures,
        shape: [{ args: [null], result: [] }, { args: [[null], []], result: [] }],
        summary: 'Percentile P in 0..100.' },
    { name: 'quantile', module: 'stats', arities: [1, 2], form: 'Values Q quantile', result: 'value', dyadicRanks: [1, 0],
        signatures: quantileSignatures,
        shape: [{ args: [null], result: [] }, { args: [[null], []], result: [] }],
        summary: 'Linear interpolation quantile Q in 0..1.' },
    { name: 'skew', module: 'stats', arities: [1], form: 'Values skew', result: 'real', axisReduction: true,
        signatures: statisticalSignatures,
        summary: 'Alias for skewness.' },
    { name: 'skewness', module: 'stats', arities: [1], form: 'Values skewness', result: 'real', axisReduction: true,
        signatures: statisticalSignatures,
        summary: 'Sample skewness of numeric values.' },
    { name: 'std', module: 'stats', arities: [1], form: 'Values std', result: 'real', axisReduction: true,
        signatures: statisticalSignatures,
        summary: 'Population standard deviation, dividing by N.' },
    { name: 'var', module: 'stats', arities: [1], form: 'Values var', result: 'real', axisReduction: true,
        signatures: statisticalSignatures,
        summary: 'Alias for variance.' },
    { name: 'variance', module: 'stats', arities: [1], form: 'Values variance', result: 'real', axisReduction: true,
        signatures: statisticalSignatures,
        summary: 'Population variance of numeric values.' },


    { name: 'csv', module: 'tables', arities: [1, 2], form: 'Path csv', result: 'table',
        signatures: [{ inputs: ['text'], result: 'table' },
            { inputs: [genericArray, 'text'], result: genericArray },
            { inputs: ['table', 'text'], result: 'table' }, { inputs: ['view', 'text'], result: 'view' }],
        effects: ['io'],
        summary: 'Reads a CSV file into a rank-1 table, or writes a table to a path.' },
    { name: 'explain', module: 'tables', arities: [1], form: 'Query explain', result: 'table',
        signatures: [{ inputs: ['view'], result: { collection: 'array', element: 'object' } }],
        effects: ['io'], summary: 'SQLite query plan rows for a prepared query view.' },
    { name: 'labels', module: 'tables', arities: [1], form: 'Table labels', result: 'array',
        signatures: [{ inputs: [{ union: ['table', { collection: 'array', element: 'object' }] }],
            result: { collection: 'array', element: 'symbol' } }],
        summary: 'Ordered column labels of a rank-1 table.' },
    { name: 'table', module: 'tables', arities: [1], form: 'Rows table', result: 'table',
        signatures: [{ inputs: [{ union: ['table', { collection: 'array', element: { union: ['object', 'record'] } }] }], result: 'table' }],
        summary: 'Builds a column table from a rank-1 array of objects.' },
    { name: 'lookup', module: 'tables', arities: [3],
        signatures: [{ inputs: ['column', 'column', 'column'], result: 'column' },
            { inputs: ['unknown', { union: [{ collection: 'array', element: 'unknown' }, { collection: 'sequence', element: 'unknown' }] },
                { union: [genericArray, { collection: 'sequence', element: elementVariable }] }],
                result: { union: [elementVariable, genericArray] } }],
        form: 'Ids Keys Values lookup', result: 'value', lazy: true,
        summary: 'First keyed match; SQLite expressions become a correlated subquery.' },
    { name: 'sql', module: 'tables', arities: [1], form: 'Query sql', result: 'record',
        signatures: [{ inputs: ['view'], result: 'record' }],
        summary: 'Statement text and bound parameters of a query view.' },
    { name: 'sqlite', module: 'tables', arities: [1], form: 'Path sqlite', result: 'database',
        signatures: [{ inputs: ['text'], result: 'database' }],
        effects: ['io'], summary: 'Opens an existing SQLite database; reads are lazy, writes explicit.' },
    { name: 'sqlquery', module: 'tables', arities: [3], form: 'Db Text Parameters sqlquery',
        signatures: [{ inputs: ['database', 'text', { union: ['tuple', { collection: 'array',
            element: { union: ['number', 'boolean', 'text', 'date', 'datetime', 'bytes'] } }] }], result: 'view' }],
        result: 'table', effects: ['io'],
        summary: 'Read-only SELECT view with bound positional parameters.' },

    { name: 'character', module: 'text', arities: [1], form: 'Code character', result: 'text',
        signatures: [{ inputs: ['integer'], result: 'text' }],
        compiledCall: { inputs: ['integer'], result: 'text', callbacks: 'none', cost: 'input-dependent' },
        summary: 'One-character text for a Unicode code point.' },
    { name: 'codepoint', module: 'text', arities: [1], form: 'Character codepoint',
        signatures: [{ inputs: ['text'], result: 'integer' }],
        compiledCall: { inputs: ['text'], result: 'integer', callbacks: 'none', cost: 'input-dependent' },
        shape: [{ args: [null], result: [] }],
        result: 'integer',
        summary: 'Integer code point of exactly one character.' },
    { name: 'hex', module: 'text', arities: [1], form: 'Bytes hex', result: 'text',
        signatures: [{ inputs: ['bytes'], result: 'text' }],
        summary: 'Lowercase hexadecimal text for bytes, without a prefix.' },
    { name: 'bytes', module: 'core', arities: [1], form: 'Value bytes', result: 'bytes',
        signatures: [{ inputs: [{ union: ['text', 'bytes', { collection: 'array', element: 'integer' }] }], result: 'bytes' }],
        compiledCall: { inputs: ['text-or-bytes'], result: 'bytes', callbacks: 'none', cost: 'input-dependent' },
        summary: 'Converts UTF-8 text or a rank-1 array of integers in 0..255 to compact bytes.' },
    { name: 'integer', module: 'core', arities: [1], form: 'Value integer', result: 'integer',
        signatures: [{ inputs: [{ union: ['integer', 'real', 'text'] }], result: 'integer', ranks: [1] }],
        shape: [{ args: [null], result: [] }],
        monadicRank: 1, summary: 'Truncates a finite real toward zero, preserves an integer, or parses signed decimal integer text.' },
    { name: 'real', module: 'core', arities: [1], form: 'Value real', result: 'real',
        signatures: [{ inputs: [{ union: ['integer', 'real', 'text'] }], result: 'real', ranks: [1] }],
        shape: [{ args: [null], result: [] }],
        monadicRank: 1, summary: 'Converts an integer or decimal text to a real, or preserves a real.' },
    { name: 'join', module: 'text', arities: [2], form: 'Values Separator join', result: 'text',
        signatures: [{ inputs: [{ union: (['array', 'sequence', 'queue', 'stack', 'deque'] as const).map(collection => ({
            collection, element: printableScalar })) }, 'text'], result: 'text', ranks: [1, 0] }],
        compiledCall: { inputs: ['text-array', 'text'], result: 'text', callbacks: 'read-cells', cost: 'input-dependent' },
        shape: [{ args: [[null], []], result: null }],
        dyadicRanks: [1, 0],
        summary: 'Joins scalar elements of a finite collection into one text; a matrix joins each row.' },
    { name: 'parse', module: 'text', arities: [2], form: 'Text Pattern parse', result: 'value',
        signatures: [{ inputs: ['text', 'text'], result: { union: ['array', 'tuple'] } }],
        summary: 'Captures /integer, /real, /word and /text from a complete pattern match.' },
    { name: 'split', module: 'text', arities: [2], form: 'Text Separator split', result: 'array',
        signatures: [{ inputs: ['text', { union: ['text', { collection: 'array', element: 'text' }] }],
            result: { collection: 'array', element: 'text' } }],
        shape: [{ args: [null, null], result: [{ exists: 'k' }] }],
        denseElements: ['text'],
        summary: 'Splits at every exact occurrence of a separator, keeping empty parts.' },
    { name: 'startswith', module: 'text', arities: [2], form: 'Value Prefix startswith',
        signatures: [...textArgumentSignatures(['text', 'text'], 'boolean', true),
            ...textArgumentSignatures(['bytes', 'bytes'], 'boolean', true)],
        compiledCall: { inputs: ['text-or-bytes', 'same'], result: 'boolean', callbacks: 'none', cost: 'input-dependent' },
        result: 'boolean',
        summary: 'Exact text or byte prefix test; ordinary arrays broadcast elementwise.' },
    { name: 'lower', module: 'text', arities: [1], form: 'Text lower', result: 'text',
        signatures: [{ inputs: ['text'], result: 'text' },
            { inputs: [{ collection: 'array', element: 'text' }], result: { collection: 'array', element: 'text' } },
            { inputs: ['column'], result: 'column' }],
        compiledCall: { inputs: ['text'], result: 'text', callbacks: 'none', cost: 'input-dependent' },
        operandDomains: [['text']],
        summary: 'Converts Unicode text to lowercase.' },
    { name: 'lpad', module: 'text', arities: [3], form: 'Text Width Fill lpad', result: 'text',
        signatures: textArgumentSignatures(['text', 'integer', 'text'], 'text'),
        summary: 'Pads text on the left without truncating longer values.' },
    { name: 'translate', module: 'text', arities: [3], form: 'Text Chars Replacement translate', result: 'text',
        signatures: textArgumentSignatures(['text', 'text', 'text'], 'text'),
        summary: 'Replaces listed characters, deleting those with no replacement.' },
    { name: 'text', module: 'core', arities: [1], form: 'Value text', result: 'text',
        signatures: [{ inputs: [printableScalar], result: 'text' }],
        compiledCall: { inputs: ['integer'], result: 'text', callbacks: 'none', cost: 'input-dependent' },
        summary: 'Formats one scalar as text; a .Nf literal after it selects fixed decimals.' },
    { name: 'vocab', module: 'text', arities: [2], form: 'Texts Limit vocab', result: 'array',
        signatures: [{ inputs: [{ collection: 'array', element: 'text' }, 'integer'],
            result: { collection: 'array', element: 'text' } }],
        summary: 'Most frequent words, at most Limit of them, ties by code point.' },
    { name: 'words', module: 'text', arities: [1], form: 'Text words', result: 'array', dataLength: true,
        signatures: [{ inputs: ['text'], result: { collection: 'array', element: 'text' } }],
        summary: 'Lowercase Unicode letter and number runs.' },

    { name: 'xml', module: 'xml', arities: [1, 2], form: 'Text xml', result: 'value', modifiers: ['flat'],
        signatures: [{ inputs: ['text'], result: 'object' },
            { inputs: ['text', { label: 'flat' }], result: { collection: 'array', element: 'object' } }],
        summary: 'Decodes a complete XML document into a tree of element nodes.' },
];

export const moduleForms: readonly ModuleForm[] = [
    { module: 'sequences', form: 'stack A B ... axis N', example: 'X = array 1 2\nY = array 3 4\nPairs = stack X Y',
        summary: 'Lazily inserts an axis (default 0) between equally shaped arrays or exact-size sequences.' },
    { module: 'sequences', form: 'concat A B ... axis N', example: 'X = array 1 2\nY = array 3 4\nJoined = concat X Y',
        summary: 'Lazily joins arrays along an existing axis (default 0); rank-one sequences remain sequences.' },
    { module: 'cli', form: 'option Name Type = Default', example: 'option N integer = 3',
        summary: 'Declares a named command-line input.' },
    { module: 'cli', form: 'argument Name Type', example: 'argument N integer = 3',
        summary: 'Declares a positional command-line input.' },
    { module: 'cli', form: 'flag Name', example: 'flag Verbose',
        summary: 'Declares a boolean command-line flag.' },
    { module: 'cli', form: 'args Values', example: 'args "--limit" "10"',
        summary: 'Sets arguments for the next run.' },
    { module: 'algo', form: 'new queue', example: 'Q = new queue',
        summary: 'Empty container: queue, stack, deque, heap, set, counter, multiset or index.' },
    { module: 'algo', form: 'new heap Priorities Values .descending',
        example: 'H = new heap (array 2 9 1) (array "a" "b" "c") .descending',
        summary: 'Builds a heap from parallel priority and value arrays; descending pops the largest priority first.' },
    { module: 'algo', form: 'Q push Value', example: 'Q = new queue\nQ push 1',
        summary: 'Receiver-first mutation on a container.' },
    { module: 'algo', form: 'Seen add Value', example: 'S = new set\nS add 1',
        summary: 'Adds a value to a set, counter or multiset.' },
    { module: 'graph', form: 'new graph Nodes .undirected',
        example: 'G = new graph (array 1 2) .undirected',
        summary: 'Closed graph over a finite vertex domain; direction is always explicit.' },
    { module: 'graph', form: 'new graph .directed', example: 'G = new graph .directed',
        summary: 'Open graph that registers endpoints as edges arrive.' },
    { module: 'graph', form: 'new dsu', example: 'D = new dsu',
        summary: 'Disjoint-set structure, open when no collection is given.' },
    { module: 'graph', form: 'Dsu merge A B', example: 'D = new dsu (array 1 2)\nD merge 1 2',
        summary: 'Unions two disjoint-set components and returns whether they differed; Dsu A B merge also works.' },
    { module: 'graph', form: 'Graph add From To',
        example: 'G = new graph .undirected\nG add 1 2',
        summary: 'Adds an edge, a weighted edge, or a bulk M by 2 or M by 3 array.' },
    { module: 'graph', form: 'Graph edges Vertex',
        example: 'G = new graph .undirected\nG add 1 2\nfor E in G edges 1\n  N = E\nend',
        summary: 'Lazy outgoing entries of a vertex as array Next Cost pairs.' },
    { module: 'json', form: 'Text json .flat', example: 'Nodes = "[1, 2]" json .flat',
        summary: 'Rank-1 table of nodes in document order: .depth .parent .kind .name .value.' },
    { module: 'xml', form: 'Text xml .flat', example: 'Nodes = "<a b=\\"1\\"/>" xml .flat',
        summary: 'Rank-1 table of nodes in document order, with .attributes for elements.' },
    { module: 'io', form: 'stdin .integer', example: 'N = stdin .integer',
        summary: 'Reads one token of standard input; a count makes it a lazy sequence.' },
    { module: 'core', form: 'Values mod N', example: 'R = 12 mod 5',
        summary: 'Floored remainder; with equal 0 it tests divisibility, elementwise on arrays. Written mod= to update in place.' },
    { module: 'core', form: 'Left Right max', example: 'M = 3 5 max',
        summary: 'The larger of two numbers; min gives the smaller.' },
    { module: 'core', form: 'Low to High', example: 'R = 1 to 5',
        summary: 'Counting range with an inclusive upper bound; after values, keeps those at most High.' },
    { module: 'core', form: 'Low till High', example: 'R = 1 till 5',
        summary: 'Counting range with an exclusive upper bound; after values, keeps those below High.' },
    { module: 'sequences', form: 'Values sort by .field',
        example: 'Rows = array (record\n  .x = 1\nend)\nS = Rows sort by .x',
        summary: 'Stable sort by record fields or by one key function.' },
    { module: 'sequences', form: 'Values argsort by .field',
        example: 'Rows = array (record\n  .x = 1\nend)\nS = Rows argsort by .x',
        summary: 'Source positions of that same order.' },
    { module: 'tables', form: 'Rows group by .field',
        example: 'use json\nRows = "[{\\"x\\": 1}]" json\nG = Rows group by .x',
        summary: 'Grouped view summarized by a named select block.' },
    { module: 'tables', form: 'Rows rollup by .first .second',
        example: 'use json\nRows = "[{\\"x\\":1,\\"y\\":2,\\"value\\":3}]" json\nG = Rows rollup by .x .y',
        summary: 'Grouped view with detail rows, prefix subtotals and a grand total.' },
    { module: 'tables', form: 'Rows Width rolling by .date',
        example: 'use json\nRows = "[{\\"date\\":\\"2012-08-01\\",\\"x\\":2}]" json\nW = Rows 15 rolling by .date',
        summary: 'One trailing row window per ordered row, summarized by select.' },
    { module: 'tables', form: 'Edges Starts reach by .source .target',
        example: 'use json\nE = "[{\\"source\\":1,\\"target\\":2}]" json\nR = E 1 reach by .source .target',
        summary: 'Reachable endpoint pairs from one or more starts; SQLite stays lazy.' },
    { module: 'tables', form: 'Rows filter .field greater Limit',
        example: 'use json\nRows = "[{\\"x\\":1}]" json\nOut = Rows filter .x greater 0',
        summary: 'Filters a table with implicit input columns; condition lines in a block use AND.' },
    { module: 'tables', form: 'Rows select .first .second',
        example: 'use json\nRows = "[{\\"x\\":1}]" json\nOut = Rows select .x',
        summary: 'Selects named columns into a rank-1 table, including a single column.' },
    { module: 'tables', form: 'Rows select ... end',
        example: 'use json\nRows = "[{\\"x\\":1}]" json\nOut = Rows select\n  N = .x + 1\n  .next = N\nend',
        summary: 'Computes named columns with block-local calculations and an implicit input table.' },
    { module: 'tables', form: 'Rows select Cols',
        example: 'use json\nRows = "[{\\"x\\":1}]" json\nCols = record\n  .x = Rows .x\nend\nOut = Rows select Cols',
        summary: 'Selects columns from an ordered record of expressions.' },
    { module: 'core', form: 'Index choose Choices',
        example: 'Picked = (array 1 0) choose (array (array 1 2) (array 3 4))',
        summary: 'Selects each cell from the choice its integer index names; choices are leading cells.' },
    { module: 'sequences', form: 'Values sort .descending',
        example: 'Sorted = (array 1 3 2) sort .descending',
        summary: 'Sorts in descending order; argsort and per-key sort directions preserve ties.' },
    { module: 'sequences', form: 'Streams merge by .field',
        example: 'Sorted = (array 1 3) (array 2 4) merge by text',
        summary: 'Merges sorted records lazily by one field or unary key function; A B merge by Key also works.' },
    { module: 'core', form: 'Values max .index',
        example: 'Row = (array 3 9 2 9) max .index',
        summary: 'Position of the first largest value; min .index gives the smallest, .indexed a value and position pair.' },
    { module: 'sequences', form: 'Values sort .indexes',
        example: 'Order = (array 3 9 2) sort .indexes',
        summary: 'Positions that order the values, as argsort does; .indexed gives the sorted values and positions as a pair.' },
    { module: 'tables', form: 'Left Right leftjoin by .id',
        example: 'use json\nRows = "[{\\"x\\": 1}]" json\nJ = Rows Rows leftjoin by .x',
        summary: 'Join on shared fields after by, or on field pairs after on.' },
    { module: 'tables', form: 'Db .members alias .m',
        example: 'use json\nData = "[{\\"id\\":1}]" json\nM = Data alias .m',
        summary: 'Name one side of a join so matching column names remain distinct.' },
    { module: 'tables', form: 'Table .column',
        example: 'use json\nRows = "[{\\"x\\": 1}]" json\nC = Rows .x',
        summary: 'Projects one column of a table.' },
    { module: 'testing', form: 'test "name" ... end',
        example: 'test "adds"\n  1 + 1 equal 2\nend',
        summary: 'A test block the runner collects.' },
];

const operationIndex = new Map(operations.map(operation => [operation.name, operation]));

/** The catalogue entry for a name, whatever module it comes from. */
export function findOperation(name: string): Operation | undefined {
    return operationIndex.get(name);
}

/** Operand counts include the two core functions that need no `use`. */
export function operationArities(name: string): readonly number[] | undefined {
    if (name === 'type' || name === 'raise') return [1];
    return findOperation(name)?.arities;
}

/** Every name one module exports, in catalogue order. */
export function moduleOperations(module: string): readonly Operation[] {
    return operations.filter(operation => operation.module === module);
}
