import { arrayRevision } from './array-storage.js';
import { currentDiagnostics } from './diagnostics.js';
import { MissingValueError } from './errors.js';
import { checkpoint, privateLoopPolling } from './interrupt.js';
import { numericCells, numericKey } from './numeric-collections.js';
import { isRankArray, type RankValue } from './value.js';

const missing = (): never => { throw new MissingValueError('find found no matching value'); };

/** A scalar target keeps early-exit linear search; no index or suffix scan. */
export function numericFind(source: RankValue, target: RankValue): bigint | undefined {
    const targetKey = numericKey(target), cells = numericCells(source);
    if (targetKey === undefined || !cells) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numericSearches++;
    for (let index = 0; index < cells.length; index++) {
        if ((index & 4095) === 0) checkpoint('finding indices', 4096);
        const key = numericKey(cells[index]);
        if (key === undefined) return undefined;
        if (key === targetKey || typeof key === 'number' && Number.isNaN(key)
            && typeof targetKey === 'number' && Number.isNaN(targetKey)) return BigInt(index);
    }
    return missing();
}

/** One lazy index per ranked invocation, refreshed on source writes. Returning
 * undefined keeps unsupported cells and contracts on the ordinary find path. */
export function rankedNumericFind(source: RankValue): (target: RankValue) => bigint | undefined {
    let revision: number | undefined;
    let positions: Map<bigint | number | boolean, number> | undefined;
    return target => {
        if (!privateLoopPolling()) return undefined;
        const key = numericKey(target);
        if (key === undefined) return undefined;
        const cells = numericCells(source);
        if (!cells) return undefined;
        if (!isRankArray(source)) return undefined;
        const next = arrayRevision(source);
        if (next === undefined) return undefined;
        if (revision !== next) {
            const index = numericFindPositions(source);
            if (!index) return undefined;
            positions = index;
            revision = next;
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.numericSearches++;
        const result = positions!.get(key);
        return result === undefined ? missing() : BigInt(result);
    };
}

/** Shared by ordinary ranked find and eager find/default queries. */
export function numericFindPositions(source: RankValue): Map<bigint | number | boolean, number> | undefined {
    const cells = numericCells(source);
    if (!cells) return undefined;
    const positions = new Map<bigint | number | boolean, number>();
    for (let position = 0; position < cells.length; position++) {
        if ((position & 4095) === 0) checkpoint('indexing search values', 4096);
        const key = numericKey(cells[position]);
        if (key === undefined) return undefined;
        if (!positions.has(key)) positions.set(key, position);
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numericSearchIndexes++;
    return positions;
}
