import { checkedFile, checkedFileStatus } from './file-integrity.js';
import { registerFileTensor } from './file-tensor.js';
import { derivedArray, ownedArray, ownedObject } from './array-storage.js';
import { RankError } from './errors.js';
import { type RankFile, type RankValue } from './value.js';

const widths: Record<string, number> = { BOOL: 1, U8: 1, I8: 1, I16: 2, U16: 2, F16: 2, BF16: 2,
    F32: 4, F64: 8, I32: 4, U32: 4, I64: 8, U64: 8 };
interface Tensor { name: string; dtype: string; shape: number[]; offset: number; length: number }
interface Index { file: RankFile; size: number; revision?: string; tensors: Tensor[] }
const indices = new WeakMap<RankFile, Index>();
const invalid = (message: string): never => { throw new RankError('Safetensors: ' + message, 'IO'); };
function file(value: RankValue): RankFile { return checkedFile(value); }
/** Positional access preserves the user's cursor. Offsets never use 32-bit arithmetic. */
function read(value: RankFile, offset: number, count: number): Uint8Array {
    file(value);
    const position = value.handle.position();
    try {
        value.handle.seek(offset);
        const result = value.handle.read(count);
        if (result.length !== count) invalid('truncated file');
        return result;
    } finally { value.handle.seek(position); }
}
export function parseSafetensorsJson(text: string): Record<string, unknown> {
    // JSON.parse silently overwrites duplicates; reject them, including escaped keys.
    const stack: (Set<string> | null)[] = [];
    for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:]/g)) {
        const t = token[0];
        if (t === '{') stack.push(new Set());
        else if (t === '[') stack.push(null);
        else if (t === '}' || t === ']') stack.pop();
        else if (t.startsWith('"') && /^\s*:/.test(text.slice(token.index! + t.length))) {
            const keys = stack.at(-1), key = JSON.parse(t) as string;
            if (keys?.has(key)) invalid('duplicate header key: ' + key);
            keys?.add(key);
        }
    }
    return JSON.parse(text);
}
function index(input: RankValue): Index {
    const { file: value, size, revision } = checkedFileStatus(input), cached = indices.get(value);
    if (!Number.isSafeInteger(size) || size < 8) return invalid('invalid file size');
    if (cached) {
        if (size !== cached.size || revision !== cached.revision) invalid('file changed; reopen the checkpoint');
        return cached;
    }
    const prefix = read(value, 0, 8);
    const length64 = new DataView(prefix.buffer, prefix.byteOffset, 8).getBigUint64(0, true);
    if (length64 > 16n * 1024n * 1024n || length64 < 2n || length64 > BigInt(size - 8))
        return invalid('invalid header size (maximum 16 MiB)');
    const length = Number(length64), start = 8 + length;
    const bytes = read(value, 8, length);
    if (bytes[0] !== 123) return invalid('header must begin with an object');
    const header = parseSafetensorsJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const tensors: Tensor[] = [];
    for (const [name, raw] of Object.entries(header)) {
        if (name === '__metadata__') {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.values(raw).some(v => typeof v !== 'string'))
                invalid('invalid metadata');
            continue;
        }
        const entry = raw as { dtype: string; shape: number[]; data_offsets: number[] };
        if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(widths, entry.dtype)
            || !Array.isArray(entry.shape) || entry.shape.some(n => !Number.isSafeInteger(n) || n < 0)
            || !Array.isArray(entry.data_offsets) || entry.data_offsets.length !== 2
            || entry.data_offsets.some(n => !Number.isSafeInteger(n) || n < 0)) return invalid('invalid tensor: ' + name);
        const [begin, end] = entry.data_offsets, count = entry.shape.reduce((a, b) => a * b, 1);
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(count * widths[entry.dtype])
            || end - begin !== count * widths[entry.dtype] || end > size - start)
            return invalid('invalid data range: ' + name);
        tensors.push({ name, dtype: entry.dtype, shape: entry.shape, offset: start + begin, length: end - begin });
    }
    let end = start;
    for (const tensor of [...tensors].sort((a, b) => a.offset - b.offset || a.length - b.length)) {
        if (tensor.offset !== end) invalid('overlapping tensors or unindexed bytes');
        end += tensor.length;
    }
    if (end !== size) invalid('unindexed trailing bytes');
    const after = checkedFileStatus(value);
    if (after.size !== size || after.revision !== revision) invalid('file changed while reading the index');
    const result = { file: value, size, tensors, revision }; indices.set(value, result); return result;
}
export function safetensorIndex(value: RankValue): RankValue {
    return ownedArray(index(value).tensors.map(t => ownedObject([
        ['name', t.name], ['dtype', t.dtype], ['shape', ownedArray(t.shape.map(BigInt))],
        ['bytes', BigInt(t.length)],
    ])));
}
function half(bits: number): number {
    const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >> 10) & 31, mantissa = bits & 1023;
    return exponent === 31 ? mantissa ? NaN : sign * Infinity
        : sign * (exponent ? 1 + mantissa / 1024 : mantissa / 1024) * 2 ** (exponent ? exponent - 15 : -14);
}
export function safetensor(value: RankValue, name: RankValue): RankValue {
    const metadata = index(value), source = metadata.file;
    if (typeof name !== 'string') return invalid('tensor name must be text');
    const tensor = metadata.tensors.find(t => t.name === name);
    if (!tensor) return invalid('unknown tensor: ' + name);
    const width = widths[tensor.dtype], count = tensor.length / width;
    let block = -1, data: DataView;
    const readCell = (i: number): RankValue => {
        const status = checkedFileStatus(source);
        if (status.size !== metadata.size || status.revision !== metadata.revision) return invalid('file changed; reopen the checkpoint');
        if (!Number.isSafeInteger(i) || i < 0 || i >= count) return invalid('tensor index out of bounds');
        const byte = i * width, next = Math.floor(byte / 65536) * 65536;
        if (next !== block) {
            const bytes = read(source, tensor.offset + next, Math.min(65536, tensor.length - next));
            data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); block = next;
        }
        const at = byte - block;
        switch (tensor.dtype) {
            case 'F32': return data.getFloat32(at, true);
            case 'F64': return data.getFloat64(at, true);
            case 'F16': return half(data.getUint16(at, true));
            case 'BF16': { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, data.getUint16(at, true) * 65536, true); return b.getFloat32(0, true); }
            case 'BOOL': return data.getUint8(at) !== 0;
            case 'I8': return BigInt(data.getInt8(at));
            case 'U8': return BigInt(data.getUint8(at));
            case 'I16': return BigInt(data.getInt16(at, true));
            case 'U16': return BigInt(data.getUint16(at, true));
            case 'I32': return BigInt(data.getInt32(at, true));
            case 'U32': return BigInt(data.getUint32(at, true));
            case 'I64': return data.getBigInt64(at, true);
            case 'U64': return data.getBigUint64(at, true);
            default: return invalid('unsupported dtype');
        }
    };
    if (!tensor.shape.length) return readCell(0);
    const view = derivedArray(tensor.shape, [source], readCell);
    registerFileTensor(view, () => {
        const { size, revision } = checkedFileStatus(source), path = source.handle.nativePath?.();
        if (revision === undefined || path === undefined) return invalid('native file tensor transfer is unavailable on this host');
        if (size !== metadata.size || revision !== metadata.revision) return invalid('file changed; reopen the checkpoint');
        return { path, revision, fileSize: metadata.size, offset: tensor.offset, length: tensor.length,
            dtype: tensor.dtype, shape: tensor.shape };
    });
    return view;
}
