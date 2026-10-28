import type { RankArray, RankValue } from './value.js';

/** Native file input, independent of JS cell storage. No payload is serialized. */
export interface FileTensorInput {
    path: string; revision: string; fileSize: number; offset: number; length: number;
    dtype: string; shape: readonly number[];
}
const sources = new WeakMap<RankArray, () => FileTensorInput | undefined>();
export function registerFileTensor(value: RankArray, source: () => FileTensorInput | undefined): void { sources.set(value, source); }
export function fileTensorInput(value: RankArray): FileTensorInput | undefined { return sources.get(value)?.(); }
/** A value-preserving binding check inherits the descriptor, never arithmetic.
 * Native F32 inputs reject nonfinite cells; validate the finite real domain at the binding too. */
export function inheritFileTensor(source: RankArray, target: RankArray, validate: (cell: RankValue) => RankValue): void {
    const descriptor = sources.get(source);
    if (descriptor) sources.set(target, () => {
        const result = descriptor();
        if (result?.dtype === 'F32') validate(0);
        return result;
    });
}

/** Preserve only a proved contiguous selection. Re-read the selection's current
 * source so copy-on-write snapshots cannot keep referring to stale file bytes. */
export function inheritFileTensorSlice(source: RankArray, target: RankArray,
    selection: () => { source: RankArray; offset: number } | undefined): void {
    if (!sources.has(source)) return;
    registerFileTensor(target, () => {
        const view = selection();
        const descriptor = view && fileTensorInput(view.source);
        if (!view || !descriptor) return undefined;
        const sourceCount = descriptor.shape.reduce((a, b) => a * b, 1);
        const count = target.shape.reduce((a, b) => a * b, 1);
        if (!sourceCount) return undefined;
        const width = descriptor.length / sourceCount;
        if (!Number.isSafeInteger(view.offset) || view.offset < 0 || view.offset + count > sourceCount)
            throw new Error('File tensor slice exceeds source range');
        return { ...descriptor, offset: descriptor.offset + view.offset * width,
            length: count * width, shape: target.shape };
    });
}
