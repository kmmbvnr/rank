import { hash } from 'node:crypto';
import { pureHostFunction } from '@arrrank/interpreter';

/** Hash text directly in Node, without an intermediate UTF-8 buffer. */
export const nodeMd5 = pureHostFunction((value: string | Uint8Array): Uint8Array => {
    return hash('md5', value, 'buffer');
});
