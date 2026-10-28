import { findOperation } from '@arrrank/language';
import { keepRamFunction, readRamState, freeRamState } from '../ram-state.js';
import { native } from './shared.js';
import { scalarNative } from './shared.js';
import { RankError } from '../errors.js';
import type { RuntimeModule } from './types.js';

export const mlModule: RuntimeModule = {
    gpukeep: () => ({ ...native('gpukeep', 1, ([value]) => keepRamFunction(value)),
        callSignature: findOperation('gpukeep')!.callSignature }),
    gpuread: () => native('gpuread', 1, ([value]) => readRamState(value)),
    gpufree: () => native('gpufree', 1, ([value]) => freeRamState(value)),
    relu: () => scalarNative('relu', value => {
        if (typeof value !== 'number') throw new RankError('relu expects a real value', 'TypeError');
        return Math.max(0, value);
    }),
};
