import { resume, type Evaluation } from './execution.js';
import { checkpoint, interruptibleCallback } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import { isRankArray, typeName, requireHomogeneous, MISSING, type RankArray, type RankValue } from './value.js';
import {
    derivedRevisions, writeRevision, hostEntry, runtimeActive, enterRuntime, leaveRuntime, type DerivedRecord,
} from './array-storage-state.js';
import { arrayReaderDepth, arrayRevision, lazyDepth } from './array-revision.js';
import {
    STREAM_CELLS, materializeCells, registerArrayCellEvaluation, registerCachedArray,
} from './array-read.js';
// Pure stored-view consumers can retain the same observed element-domain
// checks without entering the lazy cell cache or dependency validation path.
const cellValidators = new WeakMap<RankArray, (cell: RankValue, index: number) => void>();
export function arrayCellValidator(value: RankArray): ((cell: RankValue, index: number) => void) | undefined {
    return cellValidators.get(value);
}

const MAX_CACHED_CELLS = 1 << 24;
/** Cache a pure reader only while all its explicit dependencies have known revisions.
 * Untracked host buffers remain live: retained aliases can mutate outside Rank.
 * Registering the dependency revision also invalidates downstream expressions.
 */
export function derivedArray(
    shape: readonly number[], dependencies: readonly RankValue[],
    read: (index: number) => RankValue, fileFree = false,
    evaluate?: (index: number) => Evaluation<RankValue>,
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
        // The common scalar domain has already been checked for this column.
        // Reals still distinguish finite/NaN values from numeric limits below.
        if (column === lastColumn && scalar === lastScalar) return;
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
        lastScalar = scalar === 'bigint' || scalar === 'boolean' || scalar === 'string' ? scalar : undefined;
    };
    const record: DerivedRecord = { values: () => dependencies, epoch: -1, sources,
        retained: () => materialized ?? cells.values() };
    let seen: number | undefined;
    let validatedEpoch = -1;
    let validatedEntry = -1;
    const cells = new Map<number, RankValue>();
    let materialized: RankValue[] | undefined;
    let compilerCache: RankValue[] | undefined;
    const valid = () => {
        if (diagnostics) diagnostics.validationRequests++;
        // No writes means the previous dependency proof still holds, and a proof
        // outlives a return to the host. A reader that has none holds only for
        // the stretch that filled its cells. Keep this local: tensor kernels
        // read many cells in the same write epoch.
        if (validatedEpoch === writeRevision
            && (seen !== undefined || validatedEntry === hostEntry)) return seen !== undefined;
        if (diagnostics) diagnostics.dependencyValidations++;
        const current = arrayRevision(value);
        validatedEpoch = writeRevision;
        validatedEntry = hostEntry;
        if (current === undefined || current !== seen) {
            if (diagnostics && seen !== undefined) diagnostics.invalidations++;
            cells.clear();
            materialized = undefined;
            compilerCache = undefined;
            seen = current;
        }
        return current !== undefined;
    };
    // Nothing observed since the read began could have changed under it: no
    // write landed, and control never left the runtime.
    const undisturbed = (epoch: number, entry: number) =>
        writeRevision === epoch && hostEntry === entry;
    const itemAt = (index: number): RankValue => {
        if (!runtimeActive()) {
            enterRuntime();
            try { return readCell(index); } finally { leaveRuntime(); }
        }
        return readCell(index);
    };
    const finishRead = (index: number, result: RankValue, tracked: boolean,
        started: number | undefined, startedEpoch: number, startedEntry: number): RankValue => {
        checkCell(result, index);
        if (diagnostics) diagnostics.cellsComputed++;
        // A dependency may have changed during the reader. Never retain that read.
        // A Map cannot hold more than 2^24 entries; larger arrays recompute.
        if (cells.size < MAX_CACHED_CELLS && (undisturbed(startedEpoch, startedEntry)
            || (tracked && arrayRevision(value) === started))) cells.set(index, result);
        return result;
    };
    // Opaque synchronous readers keep the allocation-free cell path. Planned
    // child reads suspend below, sharing the same completion/cache policy.
    const readCell = (index: number): RankValue => {
        const tracked = valid();
        if (cells.has(index)) {
            if (diagnostics) diagnostics.cacheHits++;
            return cells.get(index)!;
        }
        const started = seen;
        const startedEpoch = writeRevision;
        const startedEntry = hostEntry;
        if (diagnostics) diagnostics.cacheMisses++;
        return finishRead(index, read(index), tracked, started, startedEpoch, startedEntry);
    };
    // One pass over a huge array must not fill the cell cache: a cell already held is used, any other
    // is computed and dropped.
    const streamAt = shape.reduce((size, dimension) => size * dimension, 1) < STREAM_CELLS ? undefined : (index: number): RankValue => {
        const run = (): RankValue => {
            valid();
            if (cells.has(index)) return cells.get(index)!;
            const result = read(index);
            checkCell(result, index);
            return result;
        };
        if (!runtimeActive()) {
            enterRuntime();
            try { return run(); } finally { leaveRuntime(); }
        }
        return run();
    };
    const value: RankArray = {
        kind: 'array', shape, itemAt, streamAt,
        containsFiles: fileFree ? false : undefined,
        get items() {
            if (!runtimeActive()) {
                enterRuntime();
                try { return readAll(); } finally { leaveRuntime(); }
            }
            return readAll();
        },
    };
    function readAll(): RankValue[] {
        const tracked = valid();
        if (materialized) return materialized;
        const started = seen;
        const startedEpoch = writeRevision;
        const startedEntry = hostEntry;
        const read = interruptibleCallback((index: number) => itemAt(index), 'materializing array');
        const items = materializeCells(shape.reduce((size, dimension) => size * dimension, 1), read);
        if (undisturbed(startedEpoch, startedEntry)
            || (tracked && arrayRevision(value) === started)) materialized = items;
        return items;
    }
    derivedRevisions.set(value, record);
    lazyDepth.set(value, depth);
    cellValidators.set(value, checkCell);
    if (evaluate) registerArrayCellEvaluation(value, function* (index) {
        const entering = !runtimeActive();
        if (entering) enterRuntime();
        try {
            checkpoint('reading array');
            const tracked = valid();
            if (cells.has(index)) {
                if (diagnostics) diagnostics.cacheHits++;
                return cells.get(index)!;
            }
            const started = seen;
            const startedEpoch = writeRevision;
            const startedEntry = hostEntry;
            if (diagnostics) diagnostics.cacheMisses++;
            const result = yield* resume(evaluate(index));
            return finishRead(index, result, tracked, started, startedEpoch, startedEntry);
        } finally { if (entering) leaveRuntime(); }
    });
    return registerCachedArray(value, () => {
        if (!valid()) return undefined;
        if (compilerCache) return compilerCache;
        const size = shape.reduce((product, dimension) => product * dimension, 1);
        if (cells.size !== size) return undefined;
        for (let index = 0; index < size; index++) if (!cells.has(index)) return undefined;
        return compilerCache = Array.from({ length: size }, (_, index) => cells.get(index)!);
    });
}
