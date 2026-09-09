import { md5 } from '@noble/hashes/legacy.js';
import { RankError } from '../errors.js';
import type { RankBytes } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const encoder = new TextEncoder();

export const cryptoModule: RuntimeModule = {
    md5: () => native('md5', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'string') throw new RankError('md5 expects text');
        return bytes(md5(encoder.encode(value)));
    }),
};

function bytes(data: Uint8Array): RankBytes {
    return {
        kind: 'bytes',
        data,
        items: [...data].map(BigInt),
        shape: [data.length],
    };
}
