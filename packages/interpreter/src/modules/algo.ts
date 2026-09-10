import { RankError } from '../errors.js';
import { sequence } from '../sequence.js';
import {
    isRankArray,
    isRankQueue,
    isRankSequence,
    isRankSet,
    type RankArray,
    type RankValue,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const algoModule: RuntimeModule = {
    permutations: () => native('permutations', 1, arguments_ => {
        const items = finiteItems(arguments_[0]);
        return sequence({
            name: 'permutations',
            size: { kind: 'exact', value: factorial(items.length) },
            *iterate() {
                yield* permute([...items], 0);
            },
        });
    }),
};

function finiteItems(value: RankValue): RankValue[] {
    if (isRankArray(value) || isRankQueue(value)) return [...value.items];
    if (isRankSet(value)) return [...value.entries.values()];
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError('permutations requires a bounded sequence');
        }
        return [...value.plan.iterate()];
    }
    throw new RankError('permutations expects a finite collection');
}

function* permute(items: RankValue[], start: number): IterableIterator<RankArray> {
    if (start === items.length) {
        yield { kind: 'array', items: [...items], shape: [items.length] };
        return;
    }
    for (let index = start; index < items.length; index += 1) {
        [items[start], items[index]] = [items[index], items[start]];
        yield* permute(items, start + 1);
        [items[start], items[index]] = [items[index], items[start]];
    }
}

function factorial(value: number): bigint {
    let result = 1n;
    for (let factor = 2n; factor <= BigInt(value); factor += 1n) result *= factor;
    return result;
}
