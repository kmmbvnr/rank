import { MissingValueError, RankError } from '../errors.js';
import { InterruptedError } from '../interrupt.js';
import { numberOverflow } from './number-arithmetic.js';
import { prepareStoredScalarView, prepareIntegerView } from '../integer-view.js';
import { arrayRevision } from '../array-revision.js';
import { indexGet, indexKey } from '../index-storage.js';
import { RankDeque } from '../containers.js';
import { atArray } from '../selectors.js';
import type { RankArray, RankIndex, RankValue } from '../value.js';

/** Entry proofs guarantee a dense array's full scalar address, an integer
 * index key or a queue position. Bounds/missing checks remain observable;
 * generic selector dispatch and tensor-shape planning are unnecessary here. */
export function scalarSelection(source: RankArray | RankIndex | RankDeque, indices: readonly bigint[]): RankValue {
    if (source instanceof RankDeque) {
        const position = indices[0];
        if (position < 0n) throw new MissingValueError('queue index out of bounds');
        const value = source.at(Number(position));
        if (value === undefined) throw new MissingValueError(`queue index out of bounds: ${position}`);
        return value;
    }
    if (source.kind !== 'index') {
        if (source.kind === 'array' && indices.length === 1 && indices[0] < 0n) {
            throw new MissingValueError('array index out of bounds on axis 0');
        }
        return atArray(source, indices);
    }
    const value = indexGet(source, indexKey(indices));
    if (value === undefined) throw new MissingValueError('missing keyed value');
    return value;
}

export interface CapturedIntegerReader {
    read(indices: readonly bigint[]): bigint;
    read1(index: bigint): bigint;
    read2(row: bigint, column: bigint): bigint;
    borrowNumber(): { read1(index: number): number; read2(row: number, column: number): number };
    current(): boolean;
}

/** Read a captured integer array by its full scalar address. A binding
 * replaced during the call (a COW copy) is proved again before reading.
 * `current` lets a later call reuse the proof of an unchanged binding. */
export function capturedIntegerReader(resolve: () => RankValue | undefined, rank: number):
    CapturedIntegerReader | undefined {
    const prove = (value: RankValue | undefined) => {
        const view = value === undefined ? undefined : prepareIntegerView(value, true);
        return view?.shape.length === rank ? view : undefined;
    };
    let source = resolve(), view = prove(source);
    let revision = view && arrayRevision(source as RankArray);
    if (!view) return undefined;
    const refresh = () => {
        const current = resolve();
        if (current !== source || !view) {
            source = current;
            view = prove(current);
            if (!view) throw new RankError('captured array no longer holds integer cells');
            revision = arrayRevision(current as RankArray);
        }
        return current as RankArray;
    };
    let numericSource: RankArray | undefined, numericRevision: number | undefined;
    let numericRead: ((offset: number) => number) | undefined;
    let borrowed: ReturnType<CapturedIntegerReader['borrowNumber']> | undefined;
    const numberReader = (current: RankArray) => {
        const revision = arrayRevision(current);
        if (revision === undefined) throw numberOverflow;
        if (current !== numericSource || revision !== numericRevision || !numericRead) {
            const stored = prepareStoredScalarView(current, true);
            const cells = stored?.compact ?? (stored?.items instanceof BigInt64Array ? stored.items : undefined);
            // Only completed private typed storage can be read speculatively.
            // Opaque readers, per-cell checks and shared buffers keep exact execution.
            if (!stored?.linear || !cells || !(cells.buffer instanceof ArrayBuffer)
                || stored.validate && !stored.validateUniform || current.columnNames || stored.source.columnNames) throw numberOverflow;
            try {
                if (current.shape.every(size => size > 0)) stored.validateUniform?.(stored.read(0));
            } catch (error) {
                // A speculative entry must not expose validation from a branch
                // the ordinary body may never demand.
                if (error instanceof RankError && !(error instanceof InterruptedError)) throw numberOverflow;
                throw error;
            }
            const { offset: base, stride } = stored.linear;
            numericRead = cells instanceof Int32Array ? at => cells[base + at * stride] : at => {
                const value = Number(cells[base + at * stride]);
                if (!Number.isSafeInteger(value)) throw numberOverflow;
                return value;
            };
            numericSource = current; numericRevision = revision; borrowed = undefined;
        }
        return numericRead;
    };
    return {
        current: () => {
            const value = resolve();
            return value === source && view !== undefined && arrayRevision(value as RankArray) === revision;
        },
        // The numeric caller proves that its body cannot write or call user
        // code. These checked readers live only for that synchronous invocation.
        borrowNumber: () => {
            const current = refresh(), shape = view!.shape, read = numberReader(current);
            if (borrowed) return borrowed;
            return borrowed = {
                read1: index => {
                    if (!Number.isSafeInteger(index)) throw numberOverflow;
                    if (index < 0 || index >= shape[0]) return Number(scalarSelection(current, [BigInt(index)]));
                    return read(index);
                },
                read2: (row, column) => {
                    if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) throw numberOverflow;
                    if (row < 0 || row >= shape[0] || column < 0 || column >= shape[1])
                        return Number(scalarSelection(current, [BigInt(row), BigInt(column)]));
                    return read(row * shape[1] + column);
                },
            };
        },
        // Common scalar addresses avoid allocating an index array per cell.
        // Error paths retain the ordinary selector's bounds and diagnostics.
        read1: index => {
            const current = refresh();
            if (index < 0n || index >= view!.shape[0]) return scalarSelection(current, [index]) as bigint;
            return view!.read(Number(index));
        },
        read2: (row, column) => {
            const current = refresh(), shape = view!.shape;
            if (row < 0n || row >= shape[0] || column < 0n || column >= shape[1])
                return scalarSelection(current, [row, column]) as bigint;
            return view!.read(Number(row) * shape[1] + Number(column));
        },
        read: indices => {
            const current = refresh();
            let offset = 0;
            for (let axis = 0; axis < rank; axis++) {
                const index = indices[axis], size = view!.shape[axis];
                // Out-of-range addresses keep the ordinary selection errors.
                if (index < 0n || index >= size) return scalarSelection(current as RankArray, indices) as bigint;
                offset = offset * size + Number(index);
            }
            return view!.read(offset);
        },
    };
}
