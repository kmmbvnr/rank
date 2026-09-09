import { RankError } from '../errors.js';
import type { RankFileMode, RankIo } from '../io.js';
import {
    formatValue,
    isRankBytes,
    isRankFile,
    isRankLabel,
    type RankBytes,
    type RankFile,
    type RankValue,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const encoder = new TextEncoder();

export const ioModule: RuntimeModule = {
    print: context => native('print', 1, arguments_ => {
        context.output(formatValue(arguments_[0]));
        return arguments_[0];
    }),
    read: context => native('read', 1, arguments_ => {
        const path = expectPath(arguments_[0]);
        return decodeUtf8(ioCall(path, () => host(context.io).read(path)));
    }),
    readlines: context => native('readlines', 1, arguments_ => {
        const path = expectPath(arguments_[0]);
        return lines(decodeUtf8(ioCall(path, () => host(context.io).read(path))));
    }),
    write: context => native('write', 2, arguments_ => {
        const text = expectText(arguments_[0], 'write');
        const path = expectPath(arguments_[1]);
        ioCall(path, () => host(context.io).write(path, encoder.encode(text), false));
        return arguments_[0];
    }),
    append: context => native('append', 2, arguments_ => {
        const text = expectText(arguments_[0], 'append');
        const path = expectPath(arguments_[1]);
        ioCall(path, () => host(context.io).write(path, encoder.encode(text), true));
        return arguments_[0];
    }),
    open: context => native('open', [1, 2], arguments_ => {
        const path = expectPath(arguments_[0]);
        const mode = arguments_.length === 1 ? 'read' : openMode(arguments_[1]);
        const file: RankFile = {
            kind: 'file',
            handle: ioCall(path, () => host(context.io).open(path, mode)),
            closed: false,
        };
        context.ownFile(file);
        return file;
    }),
    readbytes: context => native('readbytes', [2, 3], arguments_ => {
        if (arguments_.length === 3) {
            const path = expectPath(arguments_[0]);
            const offset = byteCount(arguments_[1], 'offset');
            const count = byteCount(arguments_[2], 'count');
            return bytes(ioCall(path, () => host(context.io).readRange(path, offset, count)));
        }
        const file = openFile(arguments_[0]);
        const count = byteCount(arguments_[1], 'count');
        return bytes(ioCall(file.handle.name, () => file.handle.read(count)));
    }),
    writebytes: () => native('writebytes', 2, arguments_ => {
        const file = openFile(arguments_[0]);
        const value = arguments_[1];
        if (!isRankBytes(value)) throw new RankError('writebytes expects a file and bytes');
        ioCall(file.handle.name, () => file.handle.write(value.data));
        return file;
    }),
    seek: () => native('seek', 2, arguments_ => {
        const file = openFile(arguments_[0]);
        const offset = byteCount(arguments_[1], 'offset');
        ioCall(file.handle.name, () => file.handle.seek(offset));
        return file;
    }),
    position: () => native('position', 1, arguments_ => {
        const file = openFile(arguments_[0]);
        return BigInt(ioCall(file.handle.name, () => file.handle.position()));
    }),
    size: () => native('size', 1, arguments_ => {
        const file = openFile(arguments_[0]);
        return BigInt(ioCall(file.handle.name, () => file.handle.size()));
    }),
    eof: () => native('eof', 1, arguments_ => {
        const file = openFile(arguments_[0]);
        return ioCall(file.handle.name, () => file.handle.position() >= file.handle.size());
    }),
    flush: () => native('flush', 1, arguments_ => {
        const file = openFile(arguments_[0]);
        ioCall(file.handle.name, () => file.handle.flush());
        return file;
    }),
    close: () => native('close', 1, arguments_ => {
        const file = expectFile(arguments_[0]);
        closeFile(file);
        return file;
    }),
};

export function closeFile(file: RankFile): void {
    if (file.closed) return;
    ioCall(file.handle.name, () => file.handle.close());
    file.closed = true;
}

function host(io: RankIo | undefined): RankIo {
    if (!io) throw new RankError('filesystem access is unavailable in this host', 'IO');
    return io;
}

function expectPath(value: RankValue): string {
    if (typeof value !== 'string') throw new RankError('file path must be text');
    return value;
}

function expectText(value: RankValue, operation: string): string {
    if (typeof value !== 'string') throw new RankError(`${operation} expects text and a path`);
    return value;
}

function expectFile(value: RankValue): RankFile {
    if (!isRankFile(value)) throw new RankError('expected a file');
    return value;
}

function openFile(value: RankValue): RankFile {
    const file = expectFile(value);
    if (file.closed) throw new RankError(`file is closed: ${file.handle.name}`, 'IO');
    return file;
}

function openMode(value: RankValue): RankFileMode {
    if (!isRankLabel(value) || !['write', 'update', 'append'].includes(value.name)) {
        throw new RankError('open mode must be .write, .update or .append');
    }
    return value.name as RankFileMode;
}

function byteCount(value: RankValue, name: string): number {
    if (typeof value !== 'bigint' || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`${name} must be a nonnegative safe integer`);
    }
    return Number(value);
}

function decodeUtf8(data: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
        throw new RankError('file is not valid UTF-8', 'InvalidEncoding');
    }
}

function lines(text: string): RankValue {
    if (text.length === 0) return { kind: 'array', items: [], shape: [0] };
    const items = text.split(/\r\n|\n|\r/);
    if (/\r\n$|[\n\r]$/.test(text)) items.pop();
    return { kind: 'array', items, shape: [items.length] };
}

function bytes(data: Uint8Array): RankBytes {
    return {
        kind: 'bytes',
        data,
        items: [...data].map(BigInt),
        shape: [data.length],
    };
}

function ioCall<T>(path: string, operation: () => T): T {
    try {
        return operation();
    } catch (error) {
        if (error instanceof RankError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new RankError(`${path}: ${detail}`, 'IO', path);
    }
}
