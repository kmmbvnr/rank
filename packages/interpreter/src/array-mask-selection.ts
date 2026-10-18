import { arrayRevision, noteArrayBinding, ownedArray, ownedScalarArray, readArrayItem } from './array-storage.js';
import { currentDiagnostics } from './diagnostics.js';
import { RankError } from './errors.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint } from './interrupt.js';
import { sameShape } from './tensor-index.js';
import { MISSING, type RankArray, type RankSequence, type RankValue } from './value.js';

interface Selection { source: RankArray; positions: readonly number[]; iterate: RankSequence['plan']['iterate'] }
const masks = new WeakMap<RankArray, { revision: number; size: number; positions: readonly number[] }>();
const selections = new WeakMap<RankSequence['plan'], Selection>();

/** Snapshot mask positions without demanding source cells. */
export function maskSelection(source: RankArray, selector: RankArray): RankSequence {
    if (!sameShape(source.shape, selector.shape)) {
        throw new RankError(`mask shape mismatch: ${source.shape} and ${selector.shape}`);
    }
    const size = source.shape.reduce((n, axis) => n * axis, 1);
    let positions: readonly number[];
    const view = prepareStoredScalarView(selector, true);
    const revision = arrayRevision(selector);
    const linear = view?.linear;
    // Only proved stored booleans can reuse positions. Lazy/host masks must
    // retain their ordinary reads; binding checks still run before each use.
    const reusable = view?.kinds?.length === 1 && view.kinds[0] === 'boolean'
        && linear && (!view.validate || view.validateUniform) && revision !== undefined;
    const cached = reusable ? masks.get(selector) : undefined;
    if (reusable && size) view.validateUniform?.(view.items[linear.offset]);
    if (cached && cached.revision === revision && cached.size === size) {
        checkpoint('selecting array positions');
        positions = cached.positions;
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.maskPositionReuses++;
    } else {
        const found: number[] = [];
        if (view) {
            for (let index = 0; index < size; index++) {
                if ((index & 4095) === 0) checkpoint('selecting array positions', Math.min(4096, size - index));
                const item = reusable ? view.items[linear.offset + linear.stride * index] : view.read(index);
                if (item === true) found.push(index);
                else if (item !== false && item !== MISSING) throw new RankError('array selector must be a boolean mask');
            }
        } else if (!selector.items.every((item, index) => {
            checkpoint('selecting array positions');
            if (item === true && index < size) found.push(index);
            return typeof item === 'boolean' || item === MISSING;
        })) throw new RankError('array selector must be a boolean mask');
        positions = found;
        if (reusable) masks.set(selector, { revision, size, positions });
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

/** Explicit materialization can compact stored scalar cells directly. Lazy,
 * missing, nested and host sources keep ordinary iterator/read semantics. */
export function materializeMaskSelection(selected: RankSequence): RankArray | undefined {
    const selection = selections.get(selected.plan);
    if (!selection || selected.plan.iterate !== selection.iterate) return undefined;
    const { source, positions } = selection;
    const view = prepareStoredScalarView(source, true);
    if (!view) return undefined;
    const items: RankValue[] = new Array(positions.length);
    const linear = view.linear;
    const direct = linear && (!view.validate || view.validateUniform);
    if (direct && positions.length) view.validateUniform?.(view.items[linear.offset + linear.stride * positions[0]]);
    for (let start = 0; start < positions.length; start += 4096) {
        const end = Math.min(start + 4096, positions.length);
        checkpoint('materializing array selection', end - start);
        for (let index = start; index < end; index++) {
            items[index] = direct ? view.items[linear.offset + linear.stride * positions[index]] : view.read(positions[index]);
        }
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.maskMaterializations++; diagnostics.maskMaterializedCells += items.length; }
    return view.kinds?.length === 1 ? ownedScalarArray(items, view.kinds[0]) : ownedArray(items, [items.length], true);
}
