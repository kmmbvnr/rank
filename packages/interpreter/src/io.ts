import type { RankFileHandle } from './value.js';

export type RankFileMode = 'read' | 'write' | 'update' | 'append';

export interface RankInput {
    readToken(): string | undefined;
}

export type SqliteScalar = bigint | number | string | Uint8Array | null;

export interface RankSqliteStatement {
    readonly readonly: boolean;
    readonly reader: boolean;
    columns(): readonly string[];
    all(parameters: readonly SqliteScalar[]): readonly Record<string, SqliteScalar>[];
}

export interface RankSqliteConnection {
    prepare(sql: string): RankSqliteStatement;
    close(): void;
}

export interface RankIo {
    read(path: string): Uint8Array;
    readRange(path: string, offset: number, count: number): Uint8Array;
    write(path: string, data: Uint8Array, append: boolean): void;
    open(path: string, mode: RankFileMode): RankFileHandle;
    openSqlite?(path: string): RankSqliteConnection;
    listImages?(path: string): readonly { name: string; path: string }[];
    resizeImages?(paths: readonly string[], height: number, width: number): Uint8Array;
}
