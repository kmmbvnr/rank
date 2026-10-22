import type { RankSqliteTable, RankValue } from './value.js';

// Replaying a named query constructs a fresh native view. Columns still belong
// to that same query source; neither SQL text nor a retained result identifies it.
const sources = new WeakMap<RankSqliteTable, object>();

export function identifySqliteSource(value: RankValue, source: object): RankValue {
    if (typeof value !== 'object' || value.kind !== 'sqlite-table') return value;
    const result = { ...value };
    sources.set(result, source);
    return result;
}

export function sameSqliteSource(left: RankSqliteTable, right: RankSqliteTable): boolean {
    if (left === right) return true;
    const source = sources.get(left);
    return source !== undefined && source === sources.get(right)
        && left.database.io === right.database.io && left.database.path === right.database.path
        && left.text === right.text && left.params.length === right.params.length
        && left.params.every((value, index) => {
            const other = right.params[index];
            return value === other || value instanceof Uint8Array && other instanceof Uint8Array
                && value.length === other.length && value.every((byte, offset) => byte === other[offset]);
        });
}
