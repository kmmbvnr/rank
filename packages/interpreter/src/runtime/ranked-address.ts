import { readArrayItem, registerArrayDependencies } from './array-storage.js';
import { RankError } from '../errors.js';
import { framedArray } from './framed-array.js';
import { dyadicCells } from '../rank-application.js';
import { semanticArrayType } from './semantic-array-type.js';
import { ALL_AXIS, scalarArrayWriteOffset, sliceArray, tensorSelection } from '../selectors.js';
import { arrayOffset, coordinatesAt, sameShape } from '../tensor-index.js';
import { broadcastShape } from '../jit/tensor-layout.js';
import { isRankArray, type RankValue } from './value.js';
import { checkpoint } from '../interrupt.js';
import { sequenceArrayOperand } from '../sequence.js';

/** Selector frames are independent of the receiver's axes. Splitting them
 * inspects metadata only; ordinary addressing validates each demanded cell. */
function addressLayout(source: RankValue, selectors: readonly RankValue[], ranks: readonly (number | '#')[]) {
    if (!isRankArray(source)) throw new RankError('ranked addressing expects an array', 'TypeError');
    if (selectors.length > source.shape.length) throw new RankError(`array expects at most ${source.shape.length} selectors`);
    selectors = selectors.map(sequenceArrayOperand);
    const cells = selectors.map((selector, index) => dyadicCells(selector, ranks[index] === '#' ? 'all' : ranks[index] as number));
    const frame = cells.reduce<readonly number[]>((shape, cell) => broadcastShape(shape, cell.frameShape), []);
    const select = (index: number) => {
        const coordinates = coordinatesAt(frame, index);
        return selectors.map((selector, axis) => {
            if (selector === ALL_AXIS) return selector;
            const cell = cells[axis];
            const local = cell.frameShape.map((size, i) => size === 1 ? 0 : coordinates[frame.length - cell.frameShape.length + i]);
            return cell.cellAt(arrayOffset(cell.frameShape, local));
        });
    };
    // Integer selector cells contribute their full shape; scalar cells remove
    // the source axis. Mask result lengths require actual per-cell evidence.
    let known = true;
    const shape = source.shape.flatMap((size, axis) => {
        const selector = selectors[axis];
        if (selector === undefined || selector === ALL_AXIS) return [size];
        const cell = cells[axis];
        if (!cell.cellShape.length) return [];
        const scalar = isRankArray(selector) ? semanticArrayType(selector).scalar : undefined;
        if (scalar === 'boolean') {
            if (cell.cellShape.length !== 1) throw new RankError('axis boolean masks must have rank 1');
            known = false;
            // As for other empty ranked frames, an existential result axis has
            // length zero. No hypothetical mask cell may be evaluated.
            return [0];
        }
        if (scalar !== 'integer') known = false;
        return [...cell.cellShape];
    });
    return { source, frame, select, shape: known || frame.includes(0) ? shape : undefined };
}

export function rankedAddress(source: RankValue, selectors: readonly RankValue[], ranks: readonly (number | '#')[],
    ownFiles: (value: RankValue) => void = () => {}): RankValue {
    const layout = addressLayout(source, selectors, ranks);
    const read = (index: number) => {
        const selected = layout.select(index);
        // Full scalar coordinates need the same checked offset as scalar
        // writes, without allocating a per-axis selection plan for each atom.
        if (selected.length === layout.source.shape.length && selected.every(value => typeof value === 'bigint')) {
            return readArrayItem(layout.source, scalarArrayWriteOffset(layout.source, selected as bigint[]));
        }
        return sliceArray(layout.source, tensorSelection(layout.source, selected));
    };
    if (layout.frame.length === 0) return read(0);
    const result = framedArray(layout.frame, read, {
        shape: layout.shape,
        ownFiles,
        mismatch: (before, after, index) => new RankError(
            `ranked address results must have one shape: ${before.join(' ')} and ${after.join(' ')} (cell ${index})`,
            'DimensionMismatch'),
    });
    return registerArrayDependencies(result, [source, ...selectors]);
}

/** Validate every destination before handing the existing assignment engine
 * a stable offset snapshot. Repeated destinations retain frame-major order. */
export function rankedAddressSelection(source: RankValue, selectors: readonly RankValue[], ranks: readonly (number | '#')[]) {
    const layout = addressLayout(source, selectors, ranks);
    const offsets: number[] = [];
    let shape: readonly number[] | undefined = layout.shape;
    const count = layout.frame.reduce((product, size) => product * size, 1);
    for (let frame = 0; frame < count; frame++) {
        checkpoint('validating ranked address');
        const selection = tensorSelection(layout.source, layout.select(frame));
        if (shape && !sameShape(shape, selection.shape)) throw new RankError('ranked address results must have one shape', 'DimensionMismatch');
        shape ??= selection.shape;
        const size = selection.shape.reduce((product, size) => product * size, 1);
        for (let i = 0; i < size; i++) {
            if ((i & 4095) === 0) checkpoint('preparing ranked destinations', Math.min(4096, size - i));
            offsets.push(selection.offsetAt(i));
        }
    }
    if (!shape) throw new RankError('cannot determine empty ranked address cell shape', 'DimensionMismatch');
    return { shape: [...layout.frame, ...shape], offsetAt: (index: number) => offsets[index], unique: false, linear: undefined };
}
