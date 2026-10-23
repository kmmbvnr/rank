/** Physical word helpers shared by value and validity bitmaps. */
export function bitmapWords(size: number): number { return Math.ceil(size / 32); }
export function bitmapTailMask(size: number): number {
    return size % 32 ? 0xffffffff >>> (32 - size % 32) : 0xffffffff;
}
export function popcountWord(word: number): number {
    word -= (word >>> 1) & 0x55555555;
    word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
    return (((word + (word >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
