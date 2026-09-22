import { hash } from 'node:crypto';

/** Hash text directly in Node, without an intermediate UTF-8 buffer. */
export function nodeMd5(value: string | Uint8Array): Uint8Array {
    return hash('md5', value, 'buffer');
}
