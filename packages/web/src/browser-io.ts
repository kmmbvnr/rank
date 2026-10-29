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

let nativeFiles = false;
export function configureNativeFiles(enabled: boolean): void { nativeFiles = enabled; }

export class BrowserIo implements RankIo {
    private readonly files = new Map<string, Uint8Array>();

    constructor(files: readonly BrowserFile[]) {
        this.setFiles(files);
    }

    setFiles(files: readonly BrowserFile[]): void {
        this.files.clear();
        for (const file of files) this.files.set(file.name, new Uint8Array(file.data));
    }

    read(path: string): Uint8Array {
        if (nativeFiles && (path.startsWith('models/') || path.startsWith('inputs/'))) {
            const file = path.startsWith('models/') ? new NativeModelFile(path) : new NativeInputFile(path);
            try { return file.read(file.size()); } finally { file.close(); }
        }
        return this.file(path).slice();
    }

    readRange(path: string, offset: number, count: number): Uint8Array {
        if (nativeFiles && (path.startsWith('models/') || path.startsWith('inputs/'))) {
            const file = path.startsWith('models/') ? new NativeModelFile(path) : new NativeInputFile(path);
            try { file.seek(offset); return file.read(count); } finally { file.close(); }
        }
        return this.file(path).slice(offset, offset + count);
    }

    write(path: string, data: Uint8Array, append: boolean): void {
        if (nativeFiles && (path.startsWith('models/') || path.startsWith('inputs/'))) throw new Error('Selected files are read-only');
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
        if (nativeFiles && (path.startsWith('models/') || path.startsWith('inputs/'))) {
            if (mode !== 'read') throw new Error('Model files are read-only');
            return path.startsWith('models/') ? new NativeModelFile(path) : new NativeInputFile(path);
        }
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

/** Only bounded byte ranges cross the WebView boundary; files remain in app storage. */
class NativeInputFile implements RankFileHandle {
    private cursor = 0;
    protected closed = false;
    private readonly url: string;
    constructor(readonly name: string) {
        const model = name.startsWith('models/');
        this.url = (model ? '/__rank_model_file?name=' : '/__rank_input_file?name=')
            + encodeURIComponent(name.slice(model ? 'models/'.length : 'inputs/'.length));
        this.size();
    }
    protected request(query: string, binary = false): XMLHttpRequest {
        if (this.closed) throw new Error('file is closed');
        const request = new XMLHttpRequest();
        request.open('GET', this.url + query, false);
        if (binary) request.responseType = 'arraybuffer';
        request.send();
        if (request.status !== 200) throw new Error('Cannot read model file: ' + this.name);
        return request;
    }
    read(count: number): Uint8Array {
        if (this.closed) throw new Error('file is closed');
        if (!Number.isSafeInteger(count) || count < 0 || count > 16 * 1024 * 1024)
            throw new Error('Model file reads are limited to 16 MiB; use ranges');
        const result = new Uint8Array(count); let done = 0;
        while (done < count) {
            const data = new Uint8Array(this.request('&offset=' + this.cursor + '&count=' + Math.min(65536, count - done), true).response);
            result.set(data, done); done += data.length; this.cursor += data.length;
            if (!data.length) break;
        }
        return result.subarray(0, done);
    }
    seek(offset: number): void {
        if (this.closed || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid file offset');
        this.cursor = offset;
    }
    position(): number { return this.cursor; }
    stat(): { size: number; revision: string } { return JSON.parse(this.request('&action=stat').responseText); }
    size(): number { return this.stat().size; }
    revision(): string { return this.stat().revision; }
    write(): void { throw new Error('Model files are read-only'); }
    flush(): void { if (this.closed) throw new Error('file is closed'); }
    close(): void { this.closed = true; }
}

class NativeModelFile extends NativeInputFile {
    sha256(): string { return JSON.parse(this.request('&action=sha256').responseText).sha256; }
    nativePath(): string { if (this.closed) throw new Error('file is closed'); return this.name.slice('models/'.length); }
}
