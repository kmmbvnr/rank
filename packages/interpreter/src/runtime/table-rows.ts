import { checkpoint } from '../interrupt.js';
import { RankError } from '../errors.js';
import { setValueKey } from './set.js';
import { isRankArray, isRankObject, isRankLabel, isRankDate, type RankArray, type RankObject, type RankValue } from './value.js';

export function tableRows(value: RankValue, operation: string): RankObject[] {
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError(`${operation} expects a rank-1 table`, 'DimensionMismatch');
    }
    const rows = Array.from({ length: value.shape[0] }, (_, index) =>
        value.itemAt?.(index) ?? value.items[index]);
    if (!rows.every(isRankObject)) {
        throw new RankError(`${operation} expects object rows`, 'TypeError');
    }
    return rows;
}

export function tableColumns(value: RankArray, rows: readonly RankObject[]): string[] {
    const names = new Set(value.columnNames ?? []);
    for (const row of rows) {
        checkpoint('processing table');
        for (const name of row.entries.keys()) {
            checkpoint('processing table');
            names.add(name);
        }
    }
    return [...names];
}

export function tableKey(
    row: RankObject,
    fields: readonly string[],
    keepMissing = false,
): string | undefined {
    const parts: (string | null)[] = [];
    for (const field of fields) {
        checkpoint('processing table');
        const value = row.entries.get(field);
        if (value === undefined) {
            if (!keepMissing) return undefined;
            parts.push(null);
            continue;
        }
        if (!(typeof value === 'bigint' || typeof value === 'number'
            || typeof value === 'boolean' || typeof value === 'string'
            || isRankLabel(value) || isRankDate(value))) {
            throw new RankError(`table key .${field} must be scalar`, 'TypeError');
        }
        if (typeof value === 'number' && Number.isNaN(value)) {
            throw new RankError(`table key .${field} cannot be NaN`, 'DomainError');
        }
        parts.push(setValueKey(value));
    }
    return JSON.stringify(parts);
}
