import { RankError } from '../errors.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const textModule: RuntimeModule = {
    integer: () => native('integer', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'string') throw new RankError('integer expects text');
        if (!/^[+-]?[0-9]+$/.test(value)) {
            throw new RankError(`invalid integer text: ${value}`);
        }
        return BigInt(value);
    }, 1),
};
