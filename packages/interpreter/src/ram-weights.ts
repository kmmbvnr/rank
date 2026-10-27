import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const ramWeightName = /^[a-z][a-z0-9_]*\.rwt$/;
export const ramWeightDigest = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));
const magic = new TextEncoder().encode('RWT1');
/** RWT1: magic, little-endian u32 JSON-header length, UTF-8 header, LE f32 data.
 * The header declares dtype, shape and SHA-256 of the exact payload bytes. */
export function encodeRamWeights(shape: readonly number[], values: readonly number[]): Uint8Array {
    if (!shape.length || shape.length > 4 || shape.some(n => !Number.isSafeInteger(n) || n < 1)
        || shape.reduce((a, b) => a * b, 1) !== values.length || values.length > 1_048_576)
        throw new Error('Invalid RAM weight shape');
    const data = new Uint8Array(values.length * 4), view = new DataView(data.buffer);
    values.forEach((value, i) => {
        if (!Number.isFinite(Math.fround(value))) throw new Error('RAM weights require finite f32 values');
        view.setFloat32(i * 4, value, true);
    });
    const header = new TextEncoder().encode(JSON.stringify({ dtype: 'f32', shape, sha256: ramWeightDigest(data) }));
    const result = new Uint8Array(8 + header.length + data.length);
    result.set(magic); new DataView(result.buffer).setUint32(4, header.length, true);
    result.set(header, 8); result.set(data, 8 + header.length); return result;
}
export function decodeRamWeights(bytes: Uint8Array, shape: readonly number[]): number[] {
    if (bytes.length < 8 || !magic.every((b, i) => bytes[i] === b)) throw new Error('Invalid RWT1 weight file');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint32(4, true);
    if (length > 1024 || 8 + length > bytes.length) throw new Error('Invalid RAM weight header size');
    const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8, 8 + length)));
    if (header.dtype !== 'f32') throw new Error('RAM binary weights require f32 dtype');
    if (!Array.isArray(header.shape) || header.shape.length !== shape.length || header.shape.some((n: unknown, i: number) => n !== shape[i]))
        throw new Error('Binary weight shape does not match its option');
    const size = shape.reduce((a, b) => a * b, 1), data = bytes.subarray(8 + length);
    if (size > 1_048_576 || data.length !== size * 4) throw new Error('Invalid RAM weight payload size');
    if (header.sha256 !== ramWeightDigest(data)) throw new Error('RAM weight checksum mismatch');
    return Array.from({ length: size }, (_, i) => {
        const value = view.getFloat32(8 + length + i * 4, true);
        if (!Number.isFinite(value)) throw new Error('RAM weights require finite f32 values');
        return value;
    });
}
