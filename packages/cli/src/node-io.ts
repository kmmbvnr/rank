import * as fs from 'node:fs';
import * as pathModule from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type {
    RankFileHandle, RankFileMode, RankInput, RankIo,
    RankSqliteConnection, SqliteScalar,
} from 'rank-interpreter';

interface NativeSqliteStatement {
    readonly readonly: boolean;
    readonly reader: boolean;
    safeIntegers(enabled: boolean): NativeSqliteStatement;
    columns(): readonly { name: string }[];
    all(...parameters: readonly SqliteScalar[]): readonly Record<string, SqliteScalar>[];
    run(...parameters: readonly SqliteScalar[]): { changes: number };
}

interface NativeSqliteDatabase {
    prepare(text: string): NativeSqliteStatement;
    close(): void;
}

const require = createRequire(import.meta.url);
const Sqlite = require('better-sqlite3') as new (
    path: string,
    options: { readonly: boolean; fileMustExist: boolean },
) => NativeSqliteDatabase;

export class NodeInput implements RankInput {
    private readonly buffer = Buffer.allocUnsafe(64 * 1024);
    private offset = 0;
    private length = 0;

    readToken(): string | undefined {
        let byte = this.readByte();
        while (byte !== undefined && byte <= 0x20) byte = this.readByte();
        if (byte === undefined) return undefined;

        const bytes: number[] = [];
        while (byte !== undefined && byte > 0x20) {
            bytes.push(byte);
            byte = this.readByte();
        }
        return Buffer.from(bytes).toString('utf8');
    }

    private readByte(): number | undefined {
        if (this.offset === this.length) {
            this.length = fs.readSync(0, this.buffer, 0, this.buffer.length, null);
            this.offset = 0;
            if (this.length === 0) return undefined;
        }
        return this.buffer[this.offset++];
    }
}

export const nodeIo: RankIo = {
    openSqlite(path): RankSqliteConnection {
        const database = new Sqlite(path, { readonly: true, fileMustExist: true });
        return {
            prepare(text) {
                const statement = database.prepare(text).safeIntegers(true);
                return {
                    readonly: statement.readonly,
                    reader: statement.reader,
                    columns: () => statement.columns().map(column => column.name),
                    all: parameters => statement.all(...parameters),
                };
            },
            close: () => database.close(),
        };
    },
    openSqliteWrite(path): RankSqliteConnection {
        const database = new Sqlite(path, { readonly: false, fileMustExist: true });
        return {
            prepare(text) {
                const statement = database.prepare(text).safeIntegers(true);
                return {
                    readonly: statement.readonly,
                    reader: statement.reader,
                    columns: () => statement.columns().map(column => column.name),
                    all: parameters => statement.all(...parameters),
                    run: parameters => statement.run(...parameters).changes,
                };
            },
            close: () => database.close(),
        };
    },
    listImages(directory) {
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isFile() && /\.(?:jpe?g|png)$/i.test(entry.name))
            .map(entry => ({ name: entry.name, path: pathModule.join(directory, entry.name) }))
            .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    },
    resizeImages(paths, height, width) {
        if (paths.length === 0) return new Uint8Array();
        const worker = fileURLToPath(new URL('./image-worker.js', import.meta.url));
        const expected = paths.length * height * width * 3;
        const result = spawnSync(process.execPath, [worker], {
            input: JSON.stringify({ paths, height, width }),
            maxBuffer: expected + 1024 * 1024,
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            throw new Error(result.stderr.toString('utf8').trim() || 'image decoder failed');
        }
        return result.stdout;
    },
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
