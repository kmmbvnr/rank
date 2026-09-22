import type { RankIo } from '../io.js';
import type { RankFile, RankValue } from '../value.js';

export type Output = (text: string) => void;

export interface RuntimeContext {
    readonly output: Output;
    readonly io?: RankIo;
    readonly md5?: (value: string | Uint8Array) => Uint8Array;
    readonly random: () => number;
    readonly seedRandom: (seed: bigint) => void;
    readonly ownFile: (file: RankFile) => void;
}

export type RuntimeModule = Record<string, (context: RuntimeContext) => RankValue>;
