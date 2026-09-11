import { MissingValueError, RankError } from './errors.js';
import { ResourceSummary } from './resource-summary.js';
import type { RankRecord, RankValue } from './value.js';

type Combine = (left: RankValue, right: RankValue) => RankValue;
type Numeric = bigint | number;

export interface RankSegmentValue {
    readonly kind: 'segment';
    readonly size: number;
    readonly operation: string;
    at(index: bigint): RankValue;
    set(index: bigint, value: RankValue): void;
    query(left: bigint, right: bigint): RankValue;
    firstAtLeast(target: Numeric): bigint;
    values(): IterableIterator<RankValue>;
}

/** A point-update segment tree for one associative operation. */
export class RankSegment implements RankSegmentValue {
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

    /** Find the first prefix whose aggregate is at least the target. */
    firstAtLeast(target: bigint | number): bigint {
        if (this.size === 0 || !this.atLeast(this.nodes[1], target)) return -1n;

        let index = 1;
        let before: RankValue | undefined;
        while (index < this.base) {
            const left = index * 2;
            const candidate = this.append(before, this.nodes[left]);
            if (this.atLeast(candidate, target)) {
                index = left;
            } else {
                before = candidate;
                index = left + 1;
            }
        }
        const position = index - this.base;
        return position < this.size ? BigInt(position) : -1n;
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

    private atLeast(value: RankValue | undefined, target: bigint | number): boolean {
        if (value === undefined) return false;
        if (typeof value !== 'bigint' && typeof value !== 'number') {
            throw new RankError('firstatleast expects numeric segment aggregates');
        }
        return value >= target;
    }

    private update(index: number): void {
        const value = this.append(this.nodes[index * 2], this.nodes[index * 2 + 1]);
        if (value !== undefined) this.resources.include(value);
        this.nodes[index] = value;
    }
}

interface SumNode {
    readonly sum: Numeric;
    readonly left?: SumNode;
    readonly right?: SumNode;
    readonly addition?: Numeric;
    readonly assignment?: Numeric;
}

/** A mutable sum tree with lazy range assignment and addition. */
export class RankRangeSumSegment implements RankSegmentValue {
    private readonly resources = new ResourceSummary();
    private nodes: Numeric[];
    private additions: Array<Numeric | undefined>;
    private assignments: Array<Numeric | undefined>;
    readonly kind = 'segment' as const;
    readonly operation = '+';
    readonly size: number;

    constructor(values: readonly RankValue[]) {
        this.size = values.length;
        const capacity = Math.max(1, this.size) * 4;
        this.nodes = Array<Numeric>(capacity).fill(0n);
        this.additions = Array<Numeric | undefined>(capacity);
        this.assignments = Array<Numeric | undefined>(capacity);
        if (this.size > 0) this.buildArray(1, 0, this.size - 1, values);
        this.resources.track(this);
    }

    copy(): RankPersistentSumSegment {
        const root = this.size > 0
            ? this.materialize(1, 0, this.size - 1)
            : undefined;
        const result = new RankPersistentSumSegment(this.size, root);
        this.nodes = [];
        this.additions = [];
        this.assignments = [];
        RankPersistentSumSegment.adopt(this, root);
        return result;
    }

    at(index: bigint): Numeric {
        const position = this.position(index);
        return this.queryArray(1, 0, this.size - 1, position, position);
    }

    set(index: bigint, value: RankValue): void {
        this.setRange(index, index, value);
    }

    setRange(left: bigint, right: bigint, value: RankValue): void {
        const [low, high] = this.range(left, right);
        const numeric = expectSumNumeric(value);
        this.setArray(1, 0, this.size - 1, low, high, numeric);
    }

    addRange(left: bigint, right: bigint, value: RankValue): void {
        const [low, high] = this.range(left, right);
        const numeric = expectSumNumeric(value);
        this.addArray(1, 0, this.size - 1, low, high, numeric);
    }

    query(left: bigint, right: bigint): Numeric {
        const [low, high] = this.range(left, right);
        return this.queryArray(1, 0, this.size - 1, low, high);
    }

    firstAtLeast(target: Numeric): bigint {
        if (this.size === 0 || this.nodes[1] < target) return -1n;
        let index = 1;
        let low = 0;
        let high = this.size - 1;
        let remaining = target;
        while (low < high) {
            this.pushArray(index, low, high);
            const middle = Math.floor((low + high) / 2);
            const left = index * 2;
            if (this.nodes[left] >= remaining) {
                index = left;
                high = middle;
            } else {
                remaining = subtractNumeric(remaining, this.nodes[left]);
                index = left + 1;
                low = middle + 1;
            }
        }
        return BigInt(low);
    }

    private materialize(node: number, low: number, high: number): SumNode {
        if (low === high) return { sum: this.nodes[node] };
        this.pushArray(node, low, high);
        const middle = Math.floor((low + high) / 2);
        const left = this.materialize(node * 2, low, middle);
        const right = this.materialize(node * 2 + 1, middle + 1, high);
        return { sum: this.nodes[node], left, right };
    }

    private buildArray(
        node: number, low: number, high: number,
        values: readonly RankValue[],
    ): void {
        if (low === high) {
            this.nodes[node] = expectSumNumeric(values[low]);
            return;
        }
        const middle = Math.floor((low + high) / 2);
        this.buildArray(node * 2, low, middle, values);
        this.buildArray(node * 2 + 1, middle + 1, high, values);
        this.pullArray(node);
    }

    private setArray(
        node: number, low: number, high: number,
        first: number, last: number, value: Numeric,
    ): void {
        if (first <= low && high <= last) {
            this.applyArraySet(node, high - low + 1, value);
            return;
        }
        this.pushArray(node, low, high);
        const middle = Math.floor((low + high) / 2);
        if (first <= middle) this.setArray(node * 2, low, middle, first, last, value);
        if (last > middle) this.setArray(node * 2 + 1, middle + 1, high, first, last, value);
        this.pullArray(node);
    }

    private addArray(
        node: number, low: number, high: number,
        first: number, last: number, value: Numeric,
    ): void {
        if (first <= low && high <= last) {
            this.applyArrayAdd(node, high - low + 1, value);
            return;
        }
        this.pushArray(node, low, high);
        const middle = Math.floor((low + high) / 2);
        if (first <= middle) this.addArray(node * 2, low, middle, first, last, value);
        if (last > middle) this.addArray(node * 2 + 1, middle + 1, high, first, last, value);
        this.pullArray(node);
    }

    private queryArray(
        node: number, low: number, high: number,
        first: number, last: number,
    ): Numeric {
        if (first <= low && high <= last) return this.nodes[node];
        this.pushArray(node, low, high);
        const middle = Math.floor((low + high) / 2);
        if (last <= middle) return this.queryArray(node * 2, low, middle, first, last);
        if (first > middle) {
            return this.queryArray(node * 2 + 1, middle + 1, high, first, last);
        }
        return addNumeric(
            this.queryArray(node * 2, low, middle, first, last),
            this.queryArray(node * 2 + 1, middle + 1, high, first, last),
        );
    }

    private applyArraySet(node: number, length: number, value: Numeric): void {
        this.nodes[node] = scaleNumeric(value, length);
        this.assignments[node] = value;
        this.additions[node] = undefined;
    }

    private applyArrayAdd(node: number, length: number, value: Numeric): void {
        this.nodes[node] = addNumeric(this.nodes[node], scaleNumeric(value, length));
        if (this.assignments[node] !== undefined) {
            this.assignments[node] = addNumeric(this.assignments[node]!, value);
        } else {
            this.additions[node] = addNumeric(this.additions[node] ?? 0n, value);
        }
    }

    private pushArray(node: number, low: number, high: number): void {
        if (low === high) return;
        const middle = Math.floor((low + high) / 2);
        const leftLength = middle - low + 1;
        const rightLength = high - middle;
        const assignment = this.assignments[node];
        if (assignment !== undefined) {
            this.applyArraySet(node * 2, leftLength, assignment);
            this.applyArraySet(node * 2 + 1, rightLength, assignment);
            this.assignments[node] = undefined;
        }
        const addition = this.additions[node];
        if (addition !== undefined) {
            this.applyArrayAdd(node * 2, leftLength, addition);
            this.applyArrayAdd(node * 2 + 1, rightLength, addition);
            this.additions[node] = undefined;
        }
    }

    private pullArray(node: number): void {
        this.nodes[node] = addNumeric(this.nodes[node * 2], this.nodes[node * 2 + 1]);
    }

    *values(): IterableIterator<RankValue> {}

    private range(left: bigint, right: bigint): [number, number] {
        const low = this.position(left);
        const high = this.position(right);
        if (low > high) throw new RankError('segment query start must not exceed its end');
        return [low, high];
    }

    private position(index: bigint): number {
        if (index < 0n || index >= BigInt(this.size)) {
            throw new MissingValueError(`segment index out of bounds: ${index}`);
        }
        return Number(index);
    }
}

/** A path-copying sum tree created by copying a mutable sum tree. */
export class RankPersistentSumSegment implements RankSegmentValue {
    private readonly resources = new ResourceSummary();
    readonly kind = 'segment' as const;
    readonly operation = '+';

    constructor(readonly size: number, private root?: SumNode) {
        this.resources.track(this);
    }

    static adopt(segment: RankRangeSumSegment, root?: SumNode): void {
        Object.setPrototypeOf(segment, RankPersistentSumSegment.prototype);
        (segment as unknown as RankPersistentSumSegment).root = root;
    }

    copy(): RankPersistentSumSegment {
        return new RankPersistentSumSegment(this.size, this.root);
    }

    at(index: bigint): Numeric {
        const position = this.position(index);
        return querySumNode(this.root!, 0, this.size - 1, position, position);
    }

    set(index: bigint, value: RankValue): void {
        this.setRange(index, index, value);
    }

    setRange(left: bigint, right: bigint, value: RankValue): void {
        const [low, high] = this.range(left, right);
        this.root = updateSumNode(
            this.root!, 0, this.size - 1,
            low, high, expectSumNumeric(value), 'set',
        );
    }

    addRange(left: bigint, right: bigint, value: RankValue): void {
        const [low, high] = this.range(left, right);
        this.root = updateSumNode(
            this.root!, 0, this.size - 1,
            low, high, expectSumNumeric(value), 'add',
        );
    }

    query(left: bigint, right: bigint): Numeric {
        const [low, high] = this.range(left, right);
        return querySumNode(this.root!, 0, this.size - 1, low, high);
    }

    firstAtLeast(target: Numeric): bigint {
        if (!this.root || this.root.sum < target) return -1n;
        let node = this.root;
        let low = 0;
        let high = this.size - 1;
        let remaining = target;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            const [left, right] = sumChildren(node, low, high);
            if (left.sum >= remaining) {
                node = left;
                high = middle;
            } else {
                remaining = subtractNumeric(remaining, left.sum);
                node = right;
                low = middle + 1;
            }
        }
        return BigInt(low);
    }

    *values(): IterableIterator<RankValue> {}

    private range(left: bigint, right: bigint): [number, number] {
        const low = this.position(left);
        const high = this.position(right);
        if (low > high) throw new RankError('segment query start must not exceed its end');
        return [low, high];
    }

    private position(index: bigint): number {
        if (index < 0n || index >= BigInt(this.size)) {
            throw new MissingValueError(`segment index out of bounds: ${index}`);
        }
        return Number(index);
    }
}

function updateSumNode(
    node: SumNode, low: number, high: number,
    first: number, last: number, value: Numeric,
    operation: 'set' | 'add',
): SumNode {
    if (first <= low && high <= last) {
        return operation === 'set'
            ? setSumNode(node, high - low + 1, value)
            : addSumNode(node, high - low + 1, value);
    }
    const middle = Math.floor((low + high) / 2);
    let [left, right] = sumChildren(node, low, high);
    if (first <= middle) {
        left = updateSumNode(left, low, middle, first, last, value, operation);
    }
    if (last > middle) {
        right = updateSumNode(right, middle + 1, high, first, last, value, operation);
    }
    return { sum: addNumeric(left.sum, right.sum), left, right };
}

function querySumNode(
    node: SumNode, low: number, high: number,
    first: number, last: number,
): Numeric {
    if (first <= low && high <= last) return node.sum;
    const middle = Math.floor((low + high) / 2);
    const [left, right] = sumChildren(node, low, high);
    if (last <= middle) return querySumNode(left, low, middle, first, last);
    if (first > middle) return querySumNode(right, middle + 1, high, first, last);
    return addNumeric(
        querySumNode(left, low, middle, first, last),
        querySumNode(right, middle + 1, high, first, last),
    );
}

function sumChildren(
    node: SumNode, low: number, high: number,
): [SumNode, SumNode] {
    const middle = Math.floor((low + high) / 2);
    let left = node.left!;
    let right = node.right!;
    if (node.assignment !== undefined) {
        left = setSumNode(left, middle - low + 1, node.assignment);
        right = setSumNode(right, high - middle, node.assignment);
    }
    if (node.addition !== undefined) {
        left = addSumNode(left, middle - low + 1, node.addition);
        right = addSumNode(right, high - middle, node.addition);
    }
    return [left, right];
}

function setSumNode(node: SumNode, length: number, value: Numeric): SumNode {
    return {
        sum: scaleNumeric(value, length),
        left: node.left,
        right: node.right,
        assignment: value,
    };
}

function addSumNode(node: SumNode, length: number, value: Numeric): SumNode {
    if (node.assignment !== undefined) {
        return {
            ...node,
            sum: addNumeric(node.sum, scaleNumeric(value, length)),
            assignment: addNumeric(node.assignment, value),
        };
    }
    return {
        ...node,
        sum: addNumeric(node.sum, scaleNumeric(value, length)),
        addition: addNumeric(node.addition ?? 0n, value),
    };
}

interface MaxSumSummary {
    readonly sum: Numeric;
    readonly prefix: Numeric;
    readonly suffix: Numeric;
    readonly best: Numeric;
}

/** A numeric segment profile for prefix and subarray maximum queries. */
export class RankMaxSumSegment implements RankSegmentValue {
    private readonly resources = new ResourceSummary();
    private readonly nodes: Array<MaxSumSummary | undefined>;
    private readonly base: number;
    readonly kind = 'segment' as const;
    readonly operation = 'maxsum';
    readonly size: number;

    constructor(values: readonly RankValue[]) {
        this.size = values.length;
        this.resources.track(this);
        this.base = 2 ** Math.ceil(Math.log2(Math.max(1, this.size)));
        this.nodes = Array<MaxSumSummary | undefined>(this.base * 2);
        values.forEach((value, index) => {
            this.nodes[this.base + index] = maxSumLeaf(expectNumeric(value));
        });
        for (let index = this.base - 1; index > 0; index--) this.update(index);
    }

    at(index: bigint): RankValue {
        return this.nodes[this.base + this.position(index)]!.sum;
    }

    set(index: bigint, value: RankValue): void {
        let position = this.base + this.position(index);
        this.nodes[position] = maxSumLeaf(expectNumeric(value));
        while (position > 1) {
            position = Math.floor(position / 2);
            this.update(position);
        }
    }

    query(left: bigint, right: bigint): RankRecord {
        const low = this.position(left);
        const high = this.position(right);
        if (low > high) throw new RankError('segment query start must not exceed its end');

        let first = low + this.base;
        let last = high + this.base + 1;
        let before: MaxSumSummary | undefined;
        let after: MaxSumSummary | undefined;
        while (first < last) {
            if (first % 2 === 1) before = appendMaxSum(before, this.nodes[first++]);
            if (last % 2 === 1) after = appendMaxSum(this.nodes[--last], after);
            first = Math.floor(first / 2);
            last = Math.floor(last / 2);
        }
        return maxSumRecord(appendMaxSum(before, after)!);
    }

    firstAtLeast(_target: Numeric): bigint {
        throw new RankError('firstatleast expects numeric segment aggregates');
    }

    *values(): IterableIterator<RankValue> {}

    private position(index: bigint): number {
        if (index < 0n || index >= BigInt(this.size)) {
            throw new MissingValueError(`segment index out of bounds: ${index}`);
        }
        return Number(index);
    }

    private update(index: number): void {
        this.nodes[index] = appendMaxSum(this.nodes[index * 2], this.nodes[index * 2 + 1]);
    }
}

function expectNumeric(value: RankValue): Numeric {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        throw new RankError('maxsum segment expects numeric values');
    }
    return value;
}

function expectSumNumeric(value: RankValue): Numeric {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        throw new RankError('+ segment expects numeric values');
    }
    return value;
}

function maxSumLeaf(value: Numeric): MaxSumSummary {
    const zero = typeof value === 'bigint' ? 0n : 0;
    const best = value > zero ? value : zero;
    return { sum: value, prefix: best, suffix: best, best };
}

function appendMaxSum(
    left: MaxSumSummary | undefined,
    right: MaxSumSummary | undefined,
): MaxSumSummary | undefined {
    if (left === undefined) return right;
    if (right === undefined) return left;
    const sum = addNumeric(left.sum, right.sum);
    const prefix = maxNumeric(left.prefix, addNumeric(left.sum, right.prefix));
    const suffix = maxNumeric(right.suffix, addNumeric(right.sum, left.suffix));
    const best = maxNumeric(
        maxNumeric(left.best, right.best),
        addNumeric(left.suffix, right.prefix),
    );
    return { sum, prefix, suffix, best };
}

function addNumeric(left: Numeric, right: Numeric): Numeric {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left + right : Number(left) + Number(right);
}

function subtractNumeric(left: Numeric, right: Numeric): Numeric {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left - right : Number(left) - Number(right);
}

function scaleNumeric(value: Numeric, length: number): Numeric {
    return typeof value === 'bigint'
        ? value * BigInt(length) : value * length;
}

function maxNumeric(left: Numeric, right: Numeric): Numeric {
    return left > right ? left : right;
}

function maxSumRecord(summary: MaxSumSummary): RankRecord {
    const type = typeof summary.sum === 'bigint' ? 'integer' : 'real';
    return {
        kind: 'record',
        entries: new Map<string, RankValue>([
            ['sum', summary.sum],
            ['prefix', summary.prefix],
            ['suffix', summary.suffix],
            ['best', summary.best],
        ]),
        types: new Map([
            ['sum', type], ['prefix', type], ['suffix', type], ['best', type],
        ]),
    };
}

export function expectSegment(value: RankValue): RankSegmentValue {
    if (typeof value !== 'object' || value.kind !== 'segment') {
        throw new RankError('operation expects a segment tree');
    }
    return value;
}
