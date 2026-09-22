import { md5 } from '@noble/hashes/legacy.js';
import { RankError } from '../errors.js';
import { ByteArray } from '../bytes.js';
import { isRankBytes } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const encoder = new TextEncoder();

export const cryptoModule: RuntimeModule = {
    md5: context => native('md5', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'string' && !isRankBytes(value)) throw new RankError('md5 expects text or bytes');
        const input = typeof value === 'string' ? value : value.data;
        return new ByteArray(context.md5 ? context.md5(input)
            : md5(typeof input === 'string' ? encoder.encode(input) : input));
    }),
};
