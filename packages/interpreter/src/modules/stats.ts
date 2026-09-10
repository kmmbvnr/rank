import { RankError } from '../errors.js';
import { sequenceValues } from '../sequence.js';
import { isRankArray, type RankValue } from '../value.js';
import { expectNumeric, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const statsModule: RuntimeModule = {
    mean: () => native('mean', 1, arguments_ => meanValue(arguments_[0])),
};

function meanValue(value: RankValue): number {
    const items = isRankArray(value) ? value.items : [...sequenceValues(value, 'mean')];
    if (items.length === 0) {
        throw new RankError('mean requires at least one value', 'EmptyReduction');
    }
    let total = 0;
    for (const item of items) total += Number(expectNumeric(item));
    return total / items.length;
}
