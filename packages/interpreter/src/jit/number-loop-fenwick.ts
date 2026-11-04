import type { NumberContainerTransaction } from './number-container-contract.js';
import { MissingValueError } from '../errors.js';
import { checkValueMutable } from '../value-protection.js';
import type { RankFenwick, FenwickNumberSnapshot } from '../fenwick.js';

/** An invocation-private tree; aliases share this transaction. Only successful
 * stores publish on errors/cancellation. Overflow discards both buffers before
 * exact replay, including any partially updated nodes of the failing store. */
export class PrivateNumberFenwick implements NumberContainerTransaction {
    private dirty = false;
    constructor(private readonly source: RankFenwick, private readonly snapshot: FenwickNumberSnapshot,
        private readonly overflow: object) {}

    checkMutable(): void { checkValueMutable(this.source); }

    private position(index: number | bigint): number {
        const position = Number(index);
        if (!Number.isSafeInteger(position) || position < 0 || position >= this.snapshot.values.length) {
            throw new MissingValueError(`fenwick index out of bounds: ${index}`);
        }
        return position;
    }

    at(index: number | bigint): number | bigint {
        const value = this.snapshot.values[this.position(index)];
        if (!Number.isSafeInteger(value)) throw this.overflow;
        return typeof index === 'bigint' ? BigInt(value) : value;
    }

    sum(index: number | bigint): number | bigint {
        let total = 0;
        if (index !== -1 && index !== -1n) {
            const tree = this.snapshot.tree;
            for (let at = this.position(index) + 1; at > 0; at -= at & -at) {
                total += tree[at];
                if (!Number.isSafeInteger(total)) throw this.overflow;
            }
        }
        return typeof index === 'bigint' ? BigInt(total) : total;
    }

    set(index: number | bigint, value: number | bigint): void {
        this.checkMutable();
        const position = this.position(index), number = Number(value);
        const { values, tree } = this.snapshot;
        const delta = number - values[position];
        if (!Number.isSafeInteger(number) || !Number.isSafeInteger(delta)) throw this.overflow;
        values[position] = number;
        for (let at = position + 1; at < tree.length; at += at & -at) {
            const next = tree[at] + delta;
            if (!Number.isSafeInteger(next)) throw this.overflow;
            tree[at] = next;
        }
        this.dirty = true;
    }

    publish(): void { if (this.dirty) this.snapshot.publish(); }
    rollback(): void { /* The original tree has not been changed. */ }
}
