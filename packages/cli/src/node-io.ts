import * as fs from 'node:fs';
import type { RankFileHandle, RankFileMode, RankIo } from 'rank-interpreter';

export const nodeIo: RankIo = {
    read: path => fs.readFileSync(path),
    readRange(path, offset, count) {
        const descriptor = fs.openSync(path, 'r');
        try {
            const data = new Uint8Array(count);
            const read = fs.readSync(descriptor, data, 0, count, offset);
            return data.slice(0, read);
        } finally {
            fs.closeSync(descriptor);
        }
    },
    write(path, data, append) {
        if (append) fs.appendFileSync(path, data);
        else fs.writeFileSync(path, data);
    },
    open: (path, mode) => new NodeFile(path, mode),
};

class NodeFile implements RankFileHandle {
    private readonly descriptor: number;
    private cursor: number;
    private closed = false;

    constructor(readonly name: string, private readonly mode: RankFileMode) {
        this.descriptor = fs.openSync(name, flags(mode));
        this.cursor = mode === 'append' ? this.size() : 0;
    }

    read(count: number): Uint8Array {
        this.ensureOpen();
        const data = new Uint8Array(count);
        const read = fs.readSync(this.descriptor, data, 0, count, this.cursor);
        this.cursor += read;
        return data.slice(0, read);
    }

    write(data: Uint8Array): void {
        this.ensureOpen();
        if (this.mode === 'read') throw new Error('file is read-only');
        const position = this.mode === 'append' ? null : this.cursor;
        const written = fs.writeSync(this.descriptor, data, 0, data.length, position);
        this.cursor = this.mode === 'append' ? this.size() : this.cursor + written;
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
        return fs.fstatSync(this.descriptor).size;
    }

    flush(): void {
        this.ensureOpen();
        fs.fsyncSync(this.descriptor);
    }

    close(): void {
        if (this.closed) return;
        fs.closeSync(this.descriptor);
        this.closed = true;
    }

    private ensureOpen(): void {
        if (this.closed) throw new Error('file is closed');
    }
}

function flags(mode: RankFileMode): string {
    switch (mode) {
        case 'read': return 'r';
        case 'write': return 'w+';
        case 'update': return 'r+';
        case 'append': return 'a+';
    }
}
