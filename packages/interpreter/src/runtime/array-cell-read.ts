import type { ArrayCells } from './array-read.js';
import { MissingValueError, RankError } from '../errors.js';
import type { RankValue } from './value.js';

interface Cursor {
    iterator: IterableIterator<RankValue>;
    index: number;
    size: number;
    sequential: boolean;
}

/** Cursor ownership for one observation. Operand branches remain independent
 * even when two operands alias the same source. No computed history is kept. */
export class ArrayCellRead {
    private readonly cursors = new Map<ArrayCells, Cursor>();
    private readonly branches = new Map<object, ArrayCellRead>();

    branch(operand: object): ArrayCellRead {
        let branch = this.branches.get(operand);
        if (!branch) this.branches.set(operand, branch = new ArrayCellRead());
        return branch;
    }

    read(cells: ArrayCells, index: number): RankValue {
        if (!cells.iterate) return cells.read(index);
        let cursor = this.cursors.get(cells);
        if (cursor && index <= cursor.index) {
            this.cursors.delete(cells);
            this.closeCursor(cursor);
            cursor = undefined;
        }
        if (!cursor) {
            cursor = { iterator: cells.iterate(), index: -1,
                size: cells.frameShape.reduce((total, n) => total * n, 1), sequential: true };
            this.cursors.set(cells, cursor);
        }
        if (index !== cursor.index + 1) cursor.sequential = false;
        while (cursor.index < index) {
            const next = cursor.iterator.next();
            if (next.done) throw new MissingValueError('producer frame index out of bounds');
            cursor.index++;
            if (cursor.index === index) return next.value;
        }
        throw new MissingValueError('producer frame index out of bounds');
    }

    close(failed = false): void {
        let error: unknown;
        let cleanupFailed = false;
        const close = (run: () => void) => {
            try { run(); }
            catch (failure) { if (!cleanupFailed) error = failure; cleanupFailed = true; }
        };
        for (const branch of [...this.branches.values()].reverse()) close(() => branch.close(failed || cleanupFailed));
        this.branches.clear();
        for (const cursor of [...this.cursors.values()].reverse()) close(() => this.closeCursor(cursor, !(failed || cleanupFailed)));
        this.cursors.clear();
        if (cleanupFailed && !failed) throw error;
    }

    private closeCursor(cursor: Cursor, finish = true): void {
        let finished = false;
        let failed = false;
        try {
            // Once every cell was consumed in order, resume the last yield so
            // normal completion effects and size validation still take place.
            if (finish && cursor.sequential && cursor.index + 1 === cursor.size) {
                finished = cursor.iterator.next().done === true;
                if (!finished) throw new RankError('producer exceeded its declared frame');
            }
        } catch (error) { failed = true; throw error; }
        finally {
            if (!finished) {
                try { cursor.iterator.return?.(); }
                catch (error) { if (!failed) throw error; }
            }
        }
    }
}
