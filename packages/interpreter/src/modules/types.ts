import type { RankValue } from '../value.js';

export type Output = (text: string) => void;
export type RuntimeModule = Record<string, (output: Output) => RankValue>;
