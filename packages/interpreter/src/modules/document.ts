/**
 * The flat form shared by `json .flat` and `xml .flat`: one record per node in
 * document order, so a parent precedes its children. Every row has the same
 * fields in both formats — `.depth`, `.parent`, `.kind`, `.name`, `.value` —
 * and XML rows add `.attributes`. `.kind` is text rather than a label, because
 * a label inside a table condition names a column.
 */

import { ownedArray, ownedObject } from '../array-storage.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { isRankLabel, type RankArray, type RankValue } from '../value.js';

export function documentForm(name: string, modifier: RankValue | undefined): 'tree' | 'flat' {
    if (modifier === undefined) return 'tree';
    if (isRankLabel(modifier) && modifier.name === 'flat') return 'flat';
    throw new RankError(`${name} accepts only the .flat modifier`, 'TypeError');
}

/** Rows are objects, the row form tables already read, so `filter .name` works on them. */
export function nodeObject(fields: Record<string, RankValue>): RankValue {
    return ownedObject(Object.entries(fields));
}

/** Rows built by a preorder walk; `visit` returns the children to walk next. */
export function nodeTable<T>(
    root: T,
    row: (node: T, depth: number, parent: number) => Record<string, RankValue>,
    children: (node: T) => Iterable<T>,
): RankArray {
    const rows: RankValue[] = [];
    const walk = (node: T, depth: number, parent: number): void => {
        checkpoint('flattening document');
        const index = rows.length;
        rows.push(nodeObject({ depth: BigInt(depth), parent: BigInt(parent), ...row(node, depth, parent) }));
        for (const child of children(node)) walk(child, depth + 1, index);
    };
    walk(root, 0, -1);
    return ownedArray(rows);
}
