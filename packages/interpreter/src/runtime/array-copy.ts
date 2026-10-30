import { arrayDeclaration, declareArray } from './array-declaration.js';
import { float64Cells, integer32Cells, integer64Cells, MAX_HELD_CELLS, sliceStoredArray, typedArray, typedElementKind } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { inheritSemanticArrayType } from './semantic-array-type.js';
import type { RankArray, RankValue } from './value.js';

type NumericCells = Int32Array | BigInt64Array | Float64Array;
interface Block { source: RankArray; offset: number; length: number; target: number }
const copies = new WeakMap<RankArray, { reader: RankArray['itemAt']; shape: readonly number[]; copy(): RankArray | undefined }>();

/** Only native selections and concatenations publish completed-storage copies.
 * Replaced readers, host cells and observable polling keep ordinary traversal. */
export function registerArrayCopy(value: RankArray, copy: () => RankArray | undefined): void {
    copies.set(value, { reader: value.itemAt, shape: [...value.shape], copy });
}

/** Borrowed compiler writers cannot detach storage for snapshots created after entry.
 * They request independent cells instead of a shared slice. */
export function copyArrayStorage(value: RankArray, shareStorage = true): RankArray | undefined {
    if (!privateLoopPolling() || inspectionEnabled() || value.columnNames || value.tableScopes || value.sortKeys) return undefined;
    const plan = copies.get(value);
    // Do not probe a lazy result's shape to discover that it has no storage.
    if (!plan && !prepareStoredScalarView(value, true)) return undefined;
    if (plan && (value.itemAt !== plan.reader || value.shape.length !== plan.shape.length
        || value.shape.some((size, axis) => size !== plan.shape[axis]))) return undefined;
    const size = value.shape.reduce((n, dimension) => n * dimension, 1);
    const result = plan && shareStorage ? plan.copy() : copyStoredArrayBlocks(value.shape, [value], function* () {
        yield { source: value, offset: 0, length: size, target: 0 };
    });
    if (!result) return undefined;
    const declaration = arrayDeclaration(value);
    if (declaration) declareArray(result, declaration);
    return inheritSemanticArrayType(value, result);
}

/** Binding completes native numeric selections without copying their cells.
 * Explicit copy keeps using copyArrayStorage. No lazy callbacks, missing values,
 * per-column checks or arbitrary host readers can establish this proof. */
export function materializeArrayView(value: RankArray): RankArray | undefined {
    if (!privateLoopPolling() || inspectionEnabled() || value.columnNames || value.tableScopes || value.sortKeys) return undefined;
    const view = prepareStoredScalarView(value, true);
    if (!view?.linear || view.linear.stride !== 1 || !view.validateUniform) return undefined;
    const size = value.shape.reduce((n, dimension) => n * dimension, 1);
    if (size) view.validateUniform(view.items[view.linear.offset]);
    const result = sliceStoredArray(view.source, view.linear.offset, value.shape);
    if (!result) return undefined;
    const declaration = arrayDeclaration(value);
    if (declaration) declareArray(result, declaration);
    return inheritSemanticArrayType(value, result);
}

/** Any other native selection of stored Int32 or Float64 cells (strided,
 * reversed, a block over several axes, or an index gather), read through its
 * source positions into packed cells. The same proofs as `materializeArrayView`
 * apply: one uniform physical kind and no per-cell checks. */
export function materializeSelectedView(value: RankArray): RankArray | undefined {
    if (!privateLoopPolling() || inspectionEnabled() || value.columnNames || value.tableScopes || value.sortKeys) return undefined;
    const view = prepareStoredScalarView(value, true);
    if (!view || !view.regular || !view.validateUniform) return undefined;
    const size = value.shape.reduce((n, dimension) => n * dimension, 1);
    const cells = integer32Cells(view.source) ?? integer64Cells(view.source)
        ?? (typedElementKind(view.source) === 'real' ? float64Cells(view.source) : undefined);
    if (!cells || size === 0) return undefined;
    const first = view.position(0);
    if (!(first >= 0 && first < cells.length)) return undefined;
    view.validateUniform(view.items[first]);
    const out = cells instanceof Int32Array ? new Int32Array(size) : cells instanceof BigInt64Array ? new BigInt64Array(size) : new Float64Array(size);
    for (let start = 0; start < size; start += 4096) {
        const end = Math.min(size, start + 4096);
        checkpoint('gathering numeric selection', end - start);
        for (let index = start; index < end; index++) {
            const at = view.position(index);
            if (!(at >= 0 && at < cells.length)) return undefined;
            out[index] = cells[at];
        }
    }
    const result = typedArray(out, [...value.shape]);
    const declaration = arrayDeclaration(value);
    if (declaration) declareArray(result, declaration);
    return inheritSemanticArrayType(value, result);
}

/** Copy homogeneous typed blocks without boxed cells or a recursive binding
 * traversal. Source views must prove contiguous storage and uniform contracts. */
export function copyStoredArrayBlocks(shape: readonly number[], inputs: readonly RankArray[], blocks: () => Iterable<Block>): RankArray | undefined {
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size > MAX_HELD_CELLS || !inputs.length) return undefined;
    const sources = new Map<RankArray, { cells: NumericCells; offset: number; validate?: (cell: RankValue) => void }>();
    const prepared = new Map<RankArray, NonNullable<ReturnType<typeof prepareStoredScalarView>>>();
    let prototype: NumericCells | undefined;
    for (const source of inputs) {
        if (prepared.has(source)) continue;
        const view = prepareStoredScalarView(source, true);
        if (!view?.linear || view.linear.stride !== 1 || !view.validateUniform) return undefined;
        const cells = view.compact ?? view.items;
        if (cells instanceof Int32Array || cells instanceof BigInt64Array || cells instanceof Float64Array) {
            if (prototype && cells.constructor !== prototype.constructor) return undefined;
            prototype = cells;
        } else if (!Array.isArray(cells)) return undefined;
        prepared.set(source, view);
    }
    if (!prototype) return undefined;
    for (const [source, view] of prepared) {
        let cells = view.compact ?? view.items;
        let offset = view.linear!.offset;
        if (Array.isArray(cells)) {
            // Small padding blocks can be boxed while their matrix is packed.
            // Prove the destination range before converting; never truncate an
            // arbitrary-precision integer to make a block copy eligible.
            const integer = prototype instanceof Int32Array || prototype instanceof BigInt64Array;
            if (view.kinds?.join() !== (integer ? 'integer' : 'real')) return undefined;
            const length = source.shape.reduce((n, dimension) => n * dimension, 1);
            if (integer) {
                const low = prototype instanceof Int32Array ? -2147483648n : -(1n << 63n);
                const high = prototype instanceof Int32Array ? 2147483647n : (1n << 63n) - 1n;
                for (let i = 0; i < length; i++) {
                    if ((i & 4095) === 0) checkpoint('checking array block');
                    const cell = cells[offset + i] as bigint;
                    if (cell < low || cell > high) return undefined;
                }
            }
            const converted = prototype instanceof Int32Array ? new Int32Array(length)
                : prototype instanceof BigInt64Array ? new BigInt64Array(length) : new Float64Array(length);
            for (let i = 0; i < length; i++) {
                if ((i & 4095) === 0) checkpoint('preparing array block');
                if (converted instanceof BigInt64Array) converted[i] = cells[offset + i] as bigint;
                else converted[i] = Number(cells[offset + i]);
            }
            cells = converted;
            offset = 0;
        }
        sources.set(source, { cells: cells as NumericCells, offset, validate: view.validateUniform });
    }
    const out: NumericCells = prototype instanceof Int32Array ? new Int32Array(size)
        : prototype instanceof BigInt64Array ? new BigInt64Array(size) : new Float64Array(size);
    for (const block of blocks()) {
        const view = sources.get(block.source)!;
        if (block.length && view.validate) {
            const cell = view.cells[view.offset + block.offset];
            view.validate(view.cells instanceof Int32Array ? BigInt(cell) : cell);
            view.validate = undefined;
        }
        for (let start = 0; start < block.length; start += 65536) {
            const length = Math.min(65536, block.length - start);
            checkpoint('copying array blocks', length);
            const cells = view.cells.subarray(view.offset + block.offset + start, view.offset + block.offset + start + length);
            // Constructors were matched above; TypeScript cannot express the
            // corresponding number/BigInt overloads on a union of typed arrays.
            if (out instanceof BigInt64Array) out.set(cells as BigInt64Array, block.target + start);
            else out.set(cells as Int32Array | Float64Array, block.target + start);
        }
    }
    const kinds = [...prepared.values()].map(view => view.kinds?.length === 1 ? view.kinds[0] : undefined);
    const uniformKind = kinds[0] && kinds.every(kind => kind === kinds[0]) ? kinds[0] : undefined;
    return typedArray(out, shape, undefined, uniformKind);
}
