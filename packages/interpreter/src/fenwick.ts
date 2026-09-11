import { MissingValueError, RankError } from './errors.js';

/** A fixed-size integer array with logarithmic prefix sums. */
export class RankFenwick {
    readonly kind = 'fenwick' as const;
    private readonly values: bigint[];
    private readonly tree: bigint[];

    constructor(size: bigint) {
        if (size < 0n) throw new RankError('fenwick size must be nonnegative');
        if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`fenwick size is too large: ${size}`);
        }
        const length = Number(size);
        this.values = Array<bigint>(length).fill(0n);
        this.tree = Array<bigint>(length + 1).fill(0n);
    }

    get size(): number {
        return this.values.length;
    }

    at(index: bigint): bigint {
        return this.values[this.position(index)];
    }

    set(index: bigint, value: bigint): void {
        const position = this.position(index);
        const delta = value - this.values[position];
        this.values[position] = value;
        this.update(position, delta);
    }

    sum(index: bigint): bigint {
        if (index === -1n) return 0n;
        let position = this.position(index) + 1;
        let total = 0n;
        while (position > 0) {
            total += this.tree[position];
            position -= position & -position;
        }
        return total;
    }

    private position(index: bigint): number {
        if (index < 0n || index >= BigInt(this.values.length)) {
            throw new MissingValueError(`fenwick index out of bounds: ${index}`);
        }
        return Number(index);
    }

    private update(position: number, delta: bigint): void {
        for (let index = position + 1; index < this.tree.length; index += index & -index) {
            this.tree[index] += delta;
        }
    }
}

export function expectFenwick(value: unknown): RankFenwick {
    if (!(value instanceof RankFenwick)) throw new RankError('operation expects a fenwick tree');
    return value;
}
