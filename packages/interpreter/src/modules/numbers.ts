import { isRankArray } from '../value.js';
import { expectInteger, mapValue, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const numbersModule: RuntimeModule = {
    sum: () => native('sum', 1, arguments_ => {
        const value = arguments_[0];
        const items = isRankArray(value) ? value.items : [value];
        return items.reduce<bigint>((total, item) => total + expectInteger(item), 0n);
    }),
    odd: () => native('odd', 1, arguments_ =>
        mapValue(arguments_[0], value => expectInteger(value) % 2n !== 0n)),
    even: () => native('even', 1, arguments_ =>
        mapValue(arguments_[0], value => expectInteger(value) % 2n === 0n)),
};
