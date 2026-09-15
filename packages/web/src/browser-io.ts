import type { RankFileHandle, RankFileMode, RankInput, RankIo } from '@arrrank/interpreter';
import type { BrowserFile } from './protocol.js';

export class BufferedInput implements RankInput {
    private tokens: string[] = [];
    private offset = 0;

    set(text: string): void {
        this.tokens = text.match(/\S+/gu) ?? [];
        this.offset = 0;
    }

    readToken(): string | undefined {
        return this.tokens[this.offset++];
    }
}

export class BrowserIo implements RankIo {
    private readonly files = new Map<string, Uint8Array>();

    constructor(files: readonly BrowserFile[]) {
        for (const file of files) this.files.set(file.name, new Uint8Array(file.data));
    }

    read(path: string): Uint8Array {
        return this.file(path).slice();
    }

    readRange(path: string, offset: number, count: number): Uint8Array {
        return this.file(path).slice(offset, offset + count);
    }

    write(path: string, data: Uint8Array, append: boolean): void {
        const previous = append ? this.files.get(path) : undefined;
        if (!previous) {
            this.files.set(path, data.slice());
            return;
        }
        const next = new Uint8Array(previous.length + data.length);
        next.set(previous);
        next.set(data, previous.length);
        this.files.set(path, next);
    }

    open(path: string, mode: RankFileMode): RankFileHandle {
        if (mode === 'write') this.files.set(path, new Uint8Array());
        else if (!this.files.has(path) && mode !== 'append') this.file(path);
        else if (!this.files.has(path)) this.files.set(path, new Uint8Array());
        return new BrowserFileHandle(path, mode, this.files);
    }

    private file(path: string): Uint8Array {
        const data = this.files.get(path);
        if (!data) throw new Error(`file not found: ${path}`);
        return data;
    }
}

class BrowserFileHandle implements RankFileHandle {
    private cursor: number;
    private closed = false;

    constructor(
        readonly name: string,
        private readonly mode: RankFileMode,
        private readonly files: Map<string, Uint8Array>,
    ) {
        this.cursor = mode === 'append' ? this.data().length : 0;
    }

    read(count: number): Uint8Array {
        this.ensureOpen();
        const result = this.data().slice(this.cursor, this.cursor + count);
        this.cursor += result.length;
        return result;
    }

    write(data: Uint8Array): void {
        this.ensureOpen();
        if (this.mode === 'read') throw new Error('file is read-only');
        const current = this.data();
        const position = this.mode === 'append' ? current.length : this.cursor;
        const length = Math.max(current.length, position + data.length);
        const next = new Uint8Array(length);
        next.set(current);
        next.set(data, position);
        this.files.set(this.name, next);
        this.cursor = position + data.length;
    }

    seek(offset: number): void {
        this.ensureOpen();
        this.cursor = offset;
    }

    position(): number {
        this.ensureOpen();
        return this.cursor;
    }

    size(): number {
        this.ensureOpen();
        return this.data().length;
    }

    flush(): void {
        this.ensureOpen();
    }

    close(): void {
        this.closed = true;
    }

    private data(): Uint8Array {
        const data = this.files.get(this.name);
        if (!data) throw new Error(`file not found: ${this.name}`);
        return data;
    }

    private ensureOpen(): void {
        if (this.closed) throw new Error('file is closed');
    }
}
