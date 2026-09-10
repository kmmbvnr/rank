import type { RankBytes, RankValue } from './value.js';

// Keep binary data compact until an operation requests Rank integer atoms.
export class ByteArray implements RankBytes {
    readonly kind = 'bytes';
    readonly shape: readonly number[];
    private materialized: RankValue[] | undefined;

    constructor(readonly data: Uint8Array) {
        this.shape = [data.length];
    }

    itemAt(index: number): RankValue {
        return this.materialized?.[index] ?? BigInt(this.data[index]);
    }

    get items(): RankValue[] {
        this.materialized ??= Array.from(this.data, byte => BigInt(byte));
        return this.materialized;
    }
}
