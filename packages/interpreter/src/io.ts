import type { RankFileHandle } from './value.js';

export type RankFileMode = 'read' | 'write' | 'update' | 'append';

export interface RankInput {
    readToken(): string | undefined;
}

export interface RankIo {
    read(path: string): Uint8Array;
    readRange(path: string, offset: number, count: number): Uint8Array;
    write(path: string, data: Uint8Array, append: boolean): void;
    open(path: string, mode: RankFileMode): RankFileHandle;
}
