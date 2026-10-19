import { numericFindPositions } from './numeric-search.js';
import { numericKey } from './numeric-collections.js';
import { denseScalarItems, ownedArray } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { setValueKey } from './set.js';
import { isRankArray, isRankMultiset, MISSING, type RankValue } from './value.js';

/** Eligible eager queries under default. Unsupported inputs keep the general path. */
export function queryDefault(operation: 'find' | 'floor' | 'choose', left: RankValue, right: RankValue): RankValue | undefined {
    const queries = operation === 'choose' ? left : right;
    if (!isRankArray(queries)) return undefined;
    const items = denseScalarItems(queries);
    if (!items) return undefined;
    let probe: (query: RankValue) => RankValue;
    if (operation === 'find') {
        const source = typeof left === 'string' ? Array.from(left)
            : isRankArray(left) && left.shape.length === 1 ? denseScalarItems(left) : undefined;
        if (!source) return undefined;
        let numeric = numericFindPositions(left);
        for (let i = 0; numeric && i < items.length; i++) {
            if (numericKey(items[i]) === undefined) numeric = undefined;
        }
        if (numeric) {
            const positions = numeric;
            probe = value => {
                const position = positions.get(numericKey(value)!);
                return position === undefined ? MISSING : BigInt(position);
            };
        } else {
            const positions = new Map<string, bigint>();
            for (let i = 0; i < source.length; i++) {
                if (i % 4096 === 0) checkpoint('indexing queries');
                const key = setValueKey(source[i]);
                if (!positions.has(key)) positions.set(key, BigInt(i));
            }
            probe = value => positions.get(setValueKey(value)) ?? MISSING;
        }
    } else if (operation === 'floor') {
        if (!isRankMultiset(left)) return undefined;
        probe = value => left.probeBound(value, 'floor') ?? MISSING;
    } else {
        if (!isRankArray(right) || right.shape.length !== 1) return undefined;
        const choices = denseScalarItems(right);
        if (!choices) return undefined;
        for (let i = 0; i < items.length; i++) if (typeof items[i] !== 'bigint') return undefined;
        probe = value => {
            const index = value as bigint;
            return index < 0n || index >= BigInt(choices.length) ? MISSING : choices[Number(index)];
        };
    }
    const result: RankValue[] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
        if (i % 4096 === 0) checkpoint('answering queries');
        result[i] = probe(items[i]);
    }
    return ownedArray(result, queries.shape);
}
