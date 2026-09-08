import { reduceSequence, sequenceMask, sequenceValues } from '../sequence.js';
import { isRankArray, isRankSequence, type RankValue, type SequencePredicate } from '../value.js';
import { expectInteger, mapValue, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const numbersModule: RuntimeModule = {
    sum: () => native('sum', 1, arguments_ => {
        const value = arguments_[0];
        if (isRankSequence(value)) {
            const planned = reduceSequence(value, 'sum');
            if (planned !== undefined) return expectInteger(planned);
        }
        const items = isRankArray(value) ? value.items : sequenceValues(value, 'sum');
        let total = 0n;
        for (const item of items) total += expectInteger(item);
        return total;
    }),
    odd: () => predicateFunction('odd', value => expectInteger(value) % 2n !== 0n),
    even: () => predicateFunction('even', value => expectInteger(value) % 2n === 0n),
};

function predicateFunction(name: string, test: (value: RankValue) => boolean) {
    const predicate: SequencePredicate = { name, optimizationKey: name, test };
    return native(name, 1, arguments_ => {
        const value = arguments_[0];
        return isRankSequence(value)
            ? sequenceMask(value, predicate)
            : mapValue(value, test);
    });
}
