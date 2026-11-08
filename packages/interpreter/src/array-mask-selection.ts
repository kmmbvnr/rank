import { IntegerCells, noteArrayBinding, ownedArray, ownedScalarArray, readArrayItem, typedArray } from './array-storage.js';
import { currentDiagnostics } from './diagnostics.js';
import { RankError } from './errors.js';
import { prepareIntegerView, prepareStoredScalarView } from './integer-view.js';
import { checkpoint, demandBudgetEnabled, inspectionEnabled, privateLoopPolling } from './interrupt.js';
import { arithmeticRange } from './range-plan.js';
import { packedTruePositions } from './packed-booleans.js';
import { tensorMaskPositions, sumTensorPositions, materializeTensorPositions } from './tensor-map.js';
import { sameShape } from './tensor-index.js';
import { MISSING, type RankArray, type RankSequence, type RankValue } from './value.js';

interface Selection { source: RankArray; positions: readonly number[] | Uint32Array; iterate: RankSequence['plan']['iterate'] }
const selections = new WeakMap<RankSequence['plan'], Selection>();

interface RangeSelection {
    range: NonNullable<ReturnType<typeof arithmeticRange>>;
    positions: readonly number[] | Uint32Array;
    iterate: RankSequence['plan']['iterate'];
}
const rangeSelections = new WeakMap<RankSequence['plan'], RangeSelection>();

/** A constructor-owned range and packed mask need no per-element iterator or
 * boxed Boolean array. Observable demands retain the ordinary traversal. */
export function rangeMaskSelection(source: RankSequence, selector: RankArray): RankSequence | undefined {
    if (demandBudgetEnabled() || inspectionEnabled() || !privateLoopPolling()) return undefined;
    const range = arithmeticRange(source.plan, true);
    if (!range || selector.shape.length !== 1) return undefined;
    const positions = packedTruePositions(selector);
    if (!positions) return undefined;
    if (BigInt(selector.shape[0]) !== range.count) {
        throw new RankError(`mask shape [${selector.shape[0]}] does not match sequence size ${range.count}`, 'DimensionMismatch');
    }
    const selected: RankSequence = { kind: 'sequence', plan: {
        name: 'range mask selection', size: { kind: 'exact', value: BigInt(positions.length) },
        *iterate() {
            for (const position of positions) {
                checkpoint('reading range selection');
                yield range.start + BigInt(position) * range.step;
            }
        },
    } };
    rangeSelections.set(selected.plan, { range, positions, iterate: selected.plan.iterate });
    return selected;
}

function materializeRangeSelection(selected: RankSequence): RankArray | undefined {
    if (demandBudgetEnabled() || inspectionEnabled() || !privateLoopPolling()) return undefined;
    const saved = rangeSelections.get(selected.plan);
    if (!saved || selected.plan.iterate !== saved.iterate) return undefined;
    const { range, positions } = saved;
    const last = range.start + (range.count - 1n) * range.step;
    const compact = range.start >= -2147483648n && range.start <= 2147483647n
        && last >= -2147483648n && last <= 2147483647n
        && range.step >= -2147483648n && range.step <= 2147483647n;
    const cells = compact ? new Int32Array(positions.length) : new IntegerCells(positions.length);
    const first = Number(range.start), step = Number(range.step);
    for (let start = 0; start < positions.length; start += 4096) {
        const end = Math.min(start + 4096, positions.length);
        checkpoint('materializing range selection', end - start);
        for (let index = start; index < end; index++) {
            if (cells instanceof Int32Array) cells[index] = first + positions[index] * step;
            else cells.set(index, range.start + BigInt(positions[index]) * range.step);
        }
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.maskMaterializations++; diagnostics.maskMaterializedCells += positions.length; }
    return cells instanceof Int32Array ? typedArray(cells) : cells.array([positions.length]);
}

/** Snapshot mask positions without demanding source cells. */
export function maskSelection(source: RankArray, selector: RankArray): RankSequence {
    const size = selector.shape.reduce((n, axis) => n * axis, 1);
    const native = packedTruePositions(selector) ?? tensorMaskPositions(selector);
    const fallback: number[] = [];
    const positions = native ?? fallback;
    const view = prepareStoredScalarView(selector, true);
    const linear = view?.linear;
    // Completed storage can be scanned directly, but each selection constructs
    // its own positions. Lazy/host masks retain ordinary reads and validation.
    const direct = view?.kinds?.length === 1 && view.kinds[0] === 'boolean'
        && linear && (!view.validate || view.validateUniform);
    if (direct && size) view.validateUniform?.(view.items[linear.offset]);
    if (!native && view) {
        for (let index = 0; index < size; index++) {
            if ((index & 4095) === 0) checkpoint('selecting array positions', Math.min(4096, size - index));
            const item = direct ? view.items[linear.offset + linear.stride * index] : view.read(index);
            if (item === true) fallback.push(index);
            else if (item !== false && item !== MISSING) invalidMaskElement(item);
        }
    } else if (!native) {
        for (let index = 0; index < size; index++) {
            checkpoint('selecting array positions');
            const item = readArrayItem(selector, index);
            if (item === true) fallback.push(index);
            else if (item !== false && item !== MISSING) invalidMaskElement(item);
        }
    }
    // A non-integer array selector is not necessarily a mask. Validate its
    // elements before using its shape to diagnose boolean selection.
    if (!sameShape(source.shape, selector.shape)) {
        throw new RankError(`mask shape mismatch: ${source.shape} and ${selector.shape}`);
    }

    // A retained lazy selection still owns the old source after a Rank write.
    noteArrayBinding(source);
    const selected: RankSequence = { kind: 'sequence', plan: {
        name: 'array mask selection',
        size: { kind: 'exact', value: BigInt(positions.length) },
        *iterate() {
            for (const index of positions) {
                checkpoint('reading array selection');
                yield readArrayItem(source, index);
            }
        },
    } };
    selections.set(selected.plan, { source, positions, iterate: selected.plan.iterate });
    return selected;
}

/** Constructor-owned mask positions; replaced iterators retain ordinary demand. */
export function storedMaskSelection(selected: RankSequence): { source: RankArray; positions: readonly number[] | Uint32Array } | undefined {
    const plan = Object.getOwnPropertyDescriptor(selected, 'plan')?.value as RankSequence['plan'] | undefined;
    const selection = plan && selections.get(plan);
    return selection && Object.getOwnPropertyDescriptor(plan, 'iterate')?.value === selection.iterate ? selection : undefined;
}

export function sumMaskSelection(selected: RankSequence): bigint | undefined {
    const selection = selections.get(selected.plan);
    if (!selection || selected.plan.iterate !== selection.iterate) return undefined;
    return sumTensorPositions(selection.source, selection.positions);
}

function invalidMaskElement(item: RankValue): never {
    if (typeof item === 'number') {
        throw new RankError('index array has real elements; convert with integer or floor', 'TypeError');
    }
    throw new RankError('array selector must be a boolean mask', 'TypeError');
}

/** Explicit materialization can compact stored scalar cells directly. Lazy,
 * missing, nested and host sources keep ordinary iterator/read semantics. */
export function materializeMaskSelection(selected: RankSequence): RankArray | undefined {
    const range = materializeRangeSelection(selected);
    if (range) return range;
    const selection = selections.get(selected.plan);
    if (!selection || selected.plan.iterate !== selection.iterate) return undefined;
    const { source, positions } = selection;
    const view = prepareStoredScalarView(source, true);
    if (!view) {
        const result = materializeTensorPositions(source, positions);
        if (result) {
            const diagnostics = currentDiagnostics();
            if (diagnostics) { diagnostics.maskMaterializations++; diagnostics.maskMaterializedCells += positions.length; }
        }
        return result;
    }
    const linear = view.linear;
    const direct = linear && (!view.validate || view.validateUniform);
    if (direct && positions.length) view.validateUniform?.(view.items[linear.offset + linear.stride * positions[0]]);
    const cells = view.compact ?? view.items;
    let result: RankArray;
    // Stored integer cells can be gathered without boxing every integer and
    // then packing it again. No source cell is read for an empty selection.
    if (positions.length && direct && view.kinds?.length === 1
        && (cells instanceof Int32Array || cells instanceof BigInt64Array)) {
        const out = cells instanceof Int32Array ? new Int32Array(positions.length) : new BigInt64Array(positions.length);
        for (let start = 0; start < positions.length; start += 4096) {
            const end = Math.min(start + 4096, positions.length);
            checkpoint('materializing array selection', end - start);
            for (let index = start; index < end; index++) {
                const at = linear.offset + linear.stride * positions[index];
                if (out instanceof BigInt64Array) out[index] = (cells as BigInt64Array)[at];
                else out[index] = (cells as Int32Array)[at];
            }
        }
        result = typedArray(out, [positions.length], undefined, view.kinds[0]);
    } else {
        const items: RankValue[] = new Array(positions.length);
        for (let start = 0; start < positions.length; start += 4096) {
            const end = Math.min(start + 4096, positions.length);
            checkpoint('materializing array selection', end - start);
            for (let index = start; index < end; index++) {
                items[index] = direct ? view.items[linear.offset + linear.stride * positions[index]] : view.read(positions[index]);
            }
        }
        result = view.kinds?.length === 1 ? ownedScalarArray(items, view.kinds[0]) : ownedArray(items, [items.length], true);
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.maskMaterializations++; diagnostics.maskMaterializedCells += positions.length; }
    return result;
}

/** Borrow only a native integer selection; never inspect arbitrary iterators. */
export function integerMaskSelection(selected: RankSequence): { length: number; read(index: number): bigint; numberAt?: (index: number) => number } | undefined {
    const selection = selections.get(selected.plan);
    if (!selection || selected.plan.iterate !== selection.iterate) return undefined;
    const view = prepareIntegerView(selection.source, true);
    if (!view) return undefined;
    const stored = prepareStoredScalarView(selection.source, true);
    const compact = stored?.compact, linear = stored?.linear;
    const direct = compact && linear && (!stored.validate || stored.validateUniform);
    if (direct && selection.positions.length) stored.validateUniform?.(BigInt(compact[linear.offset + linear.stride * selection.positions[0]]));
    return { length: selection.positions.length, read: index => view.read(selection.positions[index]),
        ...(direct && { numberAt: (index: number) => compact[linear.offset + linear.stride * selection.positions[index]] }) };

}
