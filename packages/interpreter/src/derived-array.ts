import { resume, type Evaluation } from './execution.js';
import { checkpoint } from './interrupt.js';
import { MissingValueError } from './errors.js';
import { currentDiagnostics } from './diagnostics.js';
import { isRankArray, typeName, requireHomogeneous, MISSING, type RankArray, type RankValue } from './value.js';
import { derivedRevisions } from './array-storage-state.js';
import { arrayReaderDepth, lazyDepth } from './array-revision.js';
import { collectArrayCells, registerArrayReadPlan, registerArrayCellEvaluation } from './array-read.js';

// Domain checks are type evidence; they retain no computed cell values.
const cellValidators = new WeakMap<RankArray, (cell: RankValue, index: number) => void>();
export function arrayCellValidator(value: RankArray): ((cell: RankValue, index: number) => void) | undefined {
    return cellValidators.get(value);
}

/** A native cell recipe. Each read computes again; ordinary binding owns the
 * completed storage. Dependencies retain ownership/type evidence, not results. */
export function derivedArray(
    shape: readonly number[], dependencies: readonly RankValue[],
    read: (index: number) => RankValue, fileFree = false,
    evaluate?: (index: number) => Evaluation<RankValue>,
    values?: () => IterableIterator<RankValue>,
): RankArray {
    const sources = dependencies.filter(isRankArray);
    const depth = arrayReaderDepth(sources, 1);
    const diagnostics = currentDiagnostics();
    const observedColumns = new Map<number, Map<string, { type: string; rank?: number }>>();
    let lastColumn = -1;
    let lastScalar: string | undefined;
    const checkCell = (cell: RankValue, index: number): void => {
        const column = value.columnNames && shape.length === 2 ? index % shape[1] : 0;
        if (cell === MISSING) return;
        const scalar = typeof cell;
        // Cache scalar domain evidence, including reals, without conflating
        // finite/NaN numbers with the numeric limits accepted by integer arrays.
        const scalarKind = scalar === 'number' && !Number.isFinite(cell) && !Number.isNaN(cell)
            ? 'numeric-limit' : scalar;
        if (column === lastColumn && scalarKind === lastScalar) return;
        let observedKinds = observedColumns.get(column);
        if (!observedKinds) observedColumns.set(column, observedKinds = new Map());
        const type = typeof cell === 'number' && !Number.isFinite(cell) && !Number.isNaN(cell)
            ? 'numeric-limit' : typeName(cell);
        const rank = isRankArray(cell) ? cell.shape.length : undefined;
        const key = `${type}:${rank}`;
        if (!observedKinds.has(key)) {
            const kind = { type, ...(rank === undefined ? {} : { rank }) };
            requireHomogeneous([...observedKinds.values(), kind]);
            observedKinds.set(key, kind);
        }
        lastColumn = column;
        lastScalar = scalar === 'bigint' || scalar === 'boolean' || scalar === 'string' || scalar === 'number'
            ? scalarKind : undefined;
    };
    const finishRead = (index: number, result: RankValue): RankValue => {
        checkCell(result, index);
        if (diagnostics) diagnostics.cellsComputed++;
        return result;
    };
    const itemAt = (index: number): RankValue => finishRead(index, read(index));
    const value: RankArray = {
        kind: 'array', shape, itemAt,
        containsFiles: fileFree ? false : undefined,
        get items() {
            return collectArrayCells(value);
        },
    };
    derivedRevisions.set(value, { values: () => dependencies, epoch: -1, sources });
    lazyDepth.set(value, depth);
    cellValidators.set(value, checkCell);
    if (evaluate) registerArrayCellEvaluation(value, function* (index) {
        checkpoint('reading array');
        return finishRead(index, yield* resume(evaluate(index)));
    });
    if (values) registerArrayReadPlan(value, { *values() {
        let index = 0;
        for (const item of values()) {
            let result: RankValue;
            try { result = finishRead(index++, item); }
            catch (error) {
                if (!(error instanceof MissingValueError) || !error.soft) throw error;
                result = MISSING;
            }
            yield result;
        }
    } });
    return value;
}
