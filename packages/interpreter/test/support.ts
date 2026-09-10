import {
    Interpreter,
    formatValue,
    type RankFileHandle,
    type RankFileMode,
    type RankInput,
    type RankIo,
} from '../src/index.js';

export function run(source: string): string | undefined {
    const result = new Interpreter().execute(source);
    return result === undefined ? undefined : formatValue(result);
}

export class TokenInput implements RankInput {
    private offset = 0;

    constructor(private readonly tokens: readonly string[]) {}

    readToken(): string | undefined {
        return this.tokens[this.offset++];
    }

    get reads(): number {
        return this.offset;
    }
}

export class MemoryIo implements RankIo {
    readonly files = new Map<string, Uint8Array>();
    readonly handles: MemoryFile[] = [];

    constructor(files: Record<string, string>) {
        const encoder = new TextEncoder();
        for (const [path, text] of Object.entries(files)) {
            this.files.set(path, encoder.encode(text));
        }
    }

    read(path: string): Uint8Array {
        return this.file(path).slice();
    }

    readRange(path: string, offset: number, count: number): Uint8Array {
        return this.file(path).slice(offset, offset + count);
    }

    write(path: string, data: Uint8Array, append: boolean): void {
        const previous = append ? this.files.get(path) ?? new Uint8Array() : new Uint8Array();
        const result = new Uint8Array(previous.length + data.length);
        result.set(previous);
        result.set(data, previous.length);
        this.files.set(path, result);
    }

    open(path: string, mode: RankFileMode): RankFileHandle {
        if (mode === 'read' || mode === 'update') this.file(path);
        if (mode === 'write') this.files.set(path, new Uint8Array());
        if (mode === 'append' && !this.files.has(path)) this.files.set(path, new Uint8Array());
        const handle = new MemoryFile(this, path, mode);
        this.handles.push(handle);
        return handle;
    }

    file(path: string): Uint8Array {
        const data = this.files.get(path);
        if (!data) throw new Error('file does not exist');
        return data;
    }
}

class MemoryFile implements RankFileHandle {
    positionValue: number;
    closed = false;

    constructor(
        private readonly io: MemoryIo,
        readonly name: string,
        private readonly mode: RankFileMode,
    ) {
        this.positionValue = mode === 'append' ? this.size() : 0;
    }

    read(count: number): Uint8Array {
        this.ensureOpen();
        const data = this.io.file(this.name).slice(this.positionValue, this.positionValue + count);
        this.positionValue += data.length;
        return data;
    }

    write(data: Uint8Array): void {
        this.ensureOpen();
        if (this.mode === 'read') throw new Error('file is read-only');
        if (this.mode === 'append') {
            this.io.write(this.name, data, true);
            this.positionValue = this.size();
            return;
        }
        const previous = this.io.file(this.name);
        const size = Math.max(previous.length, this.positionValue + data.length);
        const result = new Uint8Array(size);
        result.set(previous);
        result.set(data, this.positionValue);
        this.io.files.set(this.name, result);
        this.positionValue += data.length;
    }

    seek(offset: number): void {
        this.ensureOpen();
        this.positionValue = offset;
    }

    position(): number {
        this.ensureOpen();
        return this.positionValue;
    }

    size(): number {
        this.ensureOpen();
        return this.io.file(this.name).length;
    }

    flush(): void {
        this.ensureOpen();
    }

    close(): void {
        this.closed = true;
    }

    private ensureOpen(): void {
        if (this.closed) throw new Error('file is closed');
    }
}

