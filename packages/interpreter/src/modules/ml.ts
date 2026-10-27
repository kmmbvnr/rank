import { scalarNative } from './shared.js';
import { RankError } from '../errors.js';
import type { RuntimeModule } from './types.js';

export const mlModule: RuntimeModule = {
    relu: () => scalarNative('relu', value => {
        if (typeof value !== 'number') throw new RankError('relu expects a real value', 'TypeError');
        return Math.max(0, value);
    }),
};
