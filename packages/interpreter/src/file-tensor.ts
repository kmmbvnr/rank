import type { RankArray, RankValue } from './value.js';

/** Native file input, independent of JS cell storage. No payload is serialized. */
export interface FileTensorInput {
    path: string; revision: string; fileSize: number; offset: number; length: number;
    dtype: string; shape: readonly number[];
}
const sources = new WeakMap<RankArray, () => FileTensorInput>();
export function registerFileTensor(value: RankArray, source: () => FileTensorInput): void { sources.set(value, source); }
export function fileTensorInput(value: RankArray): FileTensorInput | undefined { return sources.get(value)?.(); }
/** Only a value-preserving binding check inherits the descriptor, never arithmetic or selection.
 * Native F32 inputs reject nonfinite cells; validate the finite real domain at the binding too. */
export function inheritFileTensor(source: RankArray, target: RankArray, validate: (cell: RankValue) => RankValue): void {
    const descriptor = sources.get(source);
    if (descriptor) sources.set(target, () => {
        const result = descriptor();
        if (result.dtype === 'F32') validate(0);
        return result;
    });
}
