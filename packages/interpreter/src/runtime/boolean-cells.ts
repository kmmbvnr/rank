import { bitmapWords, bitmapTailMask } from './bitmap.js';
import { checkpoint } from '../interrupt.js';

/** Boolean values have their own bitmap, independent of missing-value validity. */
export class BooleanCells {
    readonly words: Uint32Array;
    constructor(readonly length: number, words = new Uint32Array(bitmapWords(length))) {
        this.words = words;
        this.trim();
    }
    trim(): void {
        if (this.length % 32) this.words[this.words.length - 1] &= bitmapTailMask(this.length);
    }
    read(index: number): boolean { return (this.words[index >>> 5] >>> (index & 31) & 1) !== 0; }
    write(index: number, value: boolean): void {
        const bit = 1 << (index & 31), word = index >>> 5;
        if (value) this.words[word] |= bit;
        else this.words[word] &= ~bit;
    }
    slice(): BooleanCells { return new BooleanCells(this.length, this.words.slice()); }
    static from(items: readonly boolean[]): BooleanCells {
        const cells = new BooleanCells(items.length);
        for (let i = 0; i < items.length; i++) {
            if ((i & 4095) === 0) checkpoint('packing booleans');
            if (items[i]) cells.words[i >>> 5] |= 1 << (i & 31);
        }
        return cells;
    }
}

/** Compatibility for internal ArrayLike readers; public items remain ordinary
 * tracked arrays. Kernels use words directly, never this per-cell facade. */
export function booleanItems(cells: BooleanCells): ArrayLike<boolean> & Iterable<boolean> {
    return new Proxy({ length: cells.length,
        *[Symbol.iterator]() { for (let i = 0; i < cells.length; i++) yield cells.read(i); },
    }, { get(target, key) {
        if (typeof key === 'string') {
            const index = Number(key);
            if (Number.isInteger(index) && index >= 0 && String(index) === key) {
                return index < cells.length ? cells.read(index) : undefined;
            }
        }
        return Reflect.get(target, key);
    } }) as unknown as ArrayLike<boolean> & Iterable<boolean>;
}
