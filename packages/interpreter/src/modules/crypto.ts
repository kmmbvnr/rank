import { md5 } from '@noble/hashes/legacy.js';
import { RankError } from '../errors.js';
import { ByteArray } from '../bytes.js';
import { isRankBytes, type RankBytes } from '../value.js';
import { withTypedCalls } from '../typed-native.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const encoder = new TextEncoder();

export const cryptoModule: RuntimeModule = {
    md5: context => {
        const digest = (input: string | Uint8Array) => new ByteArray(context.md5 ? context.md5(input)
            : md5(typeof input === 'string' ? encoder.encode(input) : input));
        return withTypedCalls(native('md5', 1, arguments_ => {
            const value = arguments_[0];
            if (typeof value !== 'string' && !isRankBytes(value)) throw new RankError('md5 expects text or bytes');
            const input = typeof value === 'string' ? value : value.data;
            return digest(input);
        }), {
            text: arguments_ => digest(arguments_[0] as string),
            bytes: arguments_ => digest((arguments_[0] as RankBytes).data),
        });
    },
};
