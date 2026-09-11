import { MissingValueError, RankError } from './errors.js';
import { sequenceValues } from './sequence.js';
import { setValueKey } from './set.js';
import {
    isRankArray,
    isRankLabel,
    isRankSequence,
    type RankValue,
} from './value.js';

/** Disjoint-set union with path compression and union by size. */
export class RankDsu {
    readonly kind = 'dsu' as const;
    readonly values = new Map<string, RankValue>();
    private readonly parent = new Map<string, string>();
    private readonly sizes = new Map<string, number>();
    private componentCount = 0;

    constructor(readonly open: boolean) {}

    get size(): number { return this.values.size; }
    get components(): bigint { return BigInt(this.componentCount); }

    add(value: RankValue): void {
        const key = dsuKey(value);
        if (this.values.has(key)) return;
        this.values.set(key, value);
        this.parent.set(key, key);
        this.sizes.set(key, 1);
        this.componentCount += 1;
    }

    find(value: RankValue): RankValue {
        const key = this.require(value);
        return this.values.get(this.root(key))!;
    }

    merge(left: RankValue, right: RankValue): boolean {
        let a = this.root(this.require(left));
        let b = this.root(this.require(right));
        if (a === b) return false;
        if (this.sizes.get(a)! < this.sizes.get(b)!) [a, b] = [b, a];
        this.parent.set(b, a);
        this.sizes.set(a, this.sizes.get(a)! + this.sizes.get(b)!);
        this.componentCount -= 1;
        return true;
    }

    connected(left: RankValue, right: RankValue): boolean {
        return this.root(this.require(left)) === this.root(this.require(right));
    }

    private require(value: RankValue): string {
        const key = dsuKey(value);
        if (!this.values.has(key)) {
            if (!this.open) throw new MissingValueError('dsu does not contain the value');
            this.add(value);
        }
        return key;
    }

    private root(key: string): string {
        let root = key;
        while (this.parent.get(root)! !== root) root = this.parent.get(root)!;
        while (key !== root) {
            const next = this.parent.get(key)!;
            this.parent.set(key, root);
            key = next;
        }
        return root;
    }
}

export function dsuFrom(value?: RankValue): RankDsu {
    const dsu = new RankDsu(value === undefined);
    if (value === undefined) return dsu;
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError('dsu values must have rank 1');
        for (const item of value.items) dsu.add(item);
        return dsu;
    }
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') throw new RankError('dsu requires finite values');
        for (const item of sequenceValues(value, 'new dsu')) dsu.add(item);
        return dsu;
    }
    dsu.add(value);
    return dsu;
}

function dsuKey(value: RankValue): string {
    if (typeof value === 'bigint' || typeof value === 'number'
        || typeof value === 'boolean' || typeof value === 'string'
        || isRankLabel(value)) return setValueKey(value);
    throw new RankError('dsu values must be scalar');
}
