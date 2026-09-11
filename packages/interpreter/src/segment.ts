import { MissingValueError, RankError } from './errors.js';
import { ResourceSummary } from './resource-summary.js';
import type { RankValue } from './value.js';

type Combine = (left: RankValue, right: RankValue) => RankValue;

/** A point-update segment tree for one associative operation. */
export class RankSegment {
    private readonly resources = new ResourceSummary();
    private readonly nodes: Array<RankValue | undefined>;
    private readonly base: number;
    readonly kind = 'segment' as const;
    readonly size: number;

    constructor(
        values: readonly RankValue[],
        private readonly combine: Combine,
        readonly operation: string,
        private readonly operationValue?: RankValue,
    ) {
        this.size = values.length;
        this.resources.track(this);
        if (operationValue !== undefined) this.resources.include(operationValue);
        this.base = 2 ** Math.ceil(Math.log2(Math.max(1, this.size)));
        this.nodes = Array<RankValue | undefined>(this.base * 2);
        values.forEach((value, index) => {
            this.resources.include(value);
            this.nodes[this.base + index] = value;
        });
        for (let index = this.base - 1; index > 0; index--) this.update(index);
    }

    at(index: bigint): RankValue {
        return this.nodes[this.base + this.position(index)]!;
    }

    set(index: bigint, value: RankValue): void {
        let position = this.base + this.position(index);
        this.resources.include(value);
        this.nodes[position] = value;
        while (position > 1) {
            position = Math.floor(position / 2);
            this.update(position);
        }
    }

    query(left: bigint, right: bigint): RankValue {
        const low = this.position(left);
        const high = this.position(right);
        if (low > high) throw new RankError('segment query start must not exceed its end');

        let first = low + this.base;
        let last = high + this.base + 1;
        let before: RankValue | undefined;
        let after: RankValue | undefined;
        while (first < last) {
            if (first % 2 === 1) before = this.append(before, this.nodes[first++]);
            if (last % 2 === 1) after = this.append(this.nodes[--last], after);
            first = Math.floor(first / 2);
            last = Math.floor(last / 2);
        }
        return this.append(before, after)!;
    }

    *values(): IterableIterator<RankValue> {
        if (this.operationValue !== undefined) yield this.operationValue;
        for (const value of this.nodes) if (value !== undefined) yield value;
    }

    private position(index: bigint): number {
        if (index < 0n || index >= BigInt(this.size)) {
            throw new MissingValueError(`segment index out of bounds: ${index}`);
        }
        return Number(index);
    }

    private append(left: RankValue | undefined, right: RankValue | undefined): RankValue | undefined {
        if (left === undefined) return right;
        if (right === undefined) return left;
        return this.combine(left, right);
    }

    private update(index: number): void {
        const value = this.append(this.nodes[index * 2], this.nodes[index * 2 + 1]);
        if (value !== undefined) this.resources.include(value);
        this.nodes[index] = value;
    }
}

export function expectSegment(value: RankValue): RankSegment {
    if (!(value instanceof RankSegment)) throw new RankError('operation expects a segment tree');
    return value;
}
