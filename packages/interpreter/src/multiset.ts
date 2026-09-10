import { MissingValueError, RankError } from './errors.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from './ordered.js';
import {
    isRankArray,
    isRankMultiset,
    isRankQueue,
    isRankSequence,
    isRankSet,
    type RankValue,
} from './value.js';

interface Node {
    value: RankValue;
    count: number;
    readonly priority: number;
    left?: Node;
    right?: Node;
}

/** A duplicate-preserving ordered collection backed by a treap. */
export class RankMultiset {
    readonly kind = 'multiset' as const;
    private root?: Node;
    private valueKind?: OrderedKind;
    private total = 0;
    private priorityState = 0x9e3779b9;

    get size(): number {
        return this.total;
    }

    add(value: RankValue): this {
        const kind = orderedKind(value);
        if (this.valueKind !== undefined && kind !== this.valueKind) {
            throw new RankError('multiset values must have one comparable type');
        }
        this.valueKind ??= kind;
        this.root = this.insert(this.root, value);
        this.total += 1;
        return this;
    }

    remove(value: RankValue): this {
        if (!this.root) {
            throw new MissingValueError('multiset does not contain the value');
        }
        this.assertComparable(value);
        const [root, removed] = this.delete(this.root, value);
        if (!removed) throw new MissingValueError('multiset does not contain the value');
        this.root = root;
        this.total -= 1;
        if (this.total === 0) this.valueKind = undefined;
        return this;
    }

    has(value: RankValue): boolean {
        if (!this.root || this.comparable(value) === undefined) return false;
        let node: Node | undefined = this.root;
        while (node) {
            const comparison = this.compare(value, node.value);
            if (comparison === 0) return true;
            node = comparison < 0 ? node.left : node.right;
        }
        return false;
    }

    floor(value: RankValue): RankValue {
        return this.bound(value, 'floor');
    }

    ceiling(value: RankValue): RankValue {
        return this.bound(value, 'ceiling');
    }

    min(): RankValue | undefined {
        let node = this.root;
        while (node?.left) node = node.left;
        return node?.value;
    }

    max(): RankValue | undefined {
        let node = this.root;
        while (node?.right) node = node.right;
        return node?.value;
    }

    *values(): IterableIterator<RankValue> {
        const stack: Node[] = [];
        let node = this.root;
        while (node || stack.length > 0) {
            while (node) {
                stack.push(node);
                node = node.left;
            }
            node = stack.pop()!;
            for (let count = 0; count < node.count; count += 1) yield node.value;
            node = node.right;
        }
    }

    private bound(value: RankValue, direction: 'floor' | 'ceiling'): RankValue {
        if (!this.root) {
            throw new MissingValueError(`multiset has no ${direction} value`);
        }
        this.assertComparable(value);
        let node: Node | undefined = this.root;
        let result: RankValue | undefined;
        while (node) {
            const comparison = this.compare(value, node.value);
            if (comparison === 0) return node.value;
            if (comparison < 0) {
                if (direction === 'ceiling') result = node.value;
                node = node.left;
            } else {
                if (direction === 'floor') result = node.value;
                node = node.right;
            }
        }
        if (result === undefined) throw new MissingValueError(`multiset has no ${direction} value`);
        return result;
    }

    private comparable(value: RankValue): OrderedKind | undefined {
        try {
            const kind = orderedKind(value);
            return kind === this.valueKind ? kind : undefined;
        } catch {
            return undefined;
        }
    }

    private assertComparable(value: RankValue): void {
        if (orderedKind(value) !== this.valueKind) {
            throw new RankError('multiset values must have one comparable type');
        }
    }

    private compare(left: RankValue, right: RankValue): number {
        return compareOrderedValues(left, right, this.valueKind!);
    }

    private insert(node: Node | undefined, value: RankValue): Node {
        if (!node) return { value, count: 1, priority: this.nextPriority() };
        const comparison = this.compare(value, node.value);
        if (comparison === 0) {
            node.count += 1;
            return node;
        }
        if (comparison < 0) {
            node.left = this.insert(node.left, value);
            if (node.left.priority > node.priority) node = rotateRight(node);
        } else {
            node.right = this.insert(node.right, value);
            if (node.right.priority > node.priority) node = rotateLeft(node);
        }
        return node;
    }

    private delete(node: Node | undefined, value: RankValue): [Node | undefined, boolean] {
        if (!node) return [undefined, false];
        const comparison = this.compare(value, node.value);
        if (comparison < 0) {
            const [child, removed] = this.delete(node.left, value);
            node.left = child;
            return [node, removed];
        }
        if (comparison > 0) {
            const [child, removed] = this.delete(node.right, value);
            node.right = child;
            return [node, removed];
        }
        if (node.count > 1) {
            node.count -= 1;
            return [node, true];
        }
        return [merge(node.left, node.right), true];
    }

    private nextPriority(): number {
        let value = this.priorityState;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        this.priorityState = value >>> 0;
        return this.priorityState;
    }
}

/** Materialize a finite collection into an ordered multiset. */
export function multisetValue(value: RankValue): RankMultiset {
    const result = new RankMultiset();
    for (const item of finiteValues(value)) result.add(item);
    return result;
}

export function expectMultiset(value: RankValue): RankMultiset {
    if (!isRankMultiset(value)) throw new RankError('operation expects a multiset');
    return value;
}

function finiteValues(value: RankValue): Iterable<RankValue> {
    if (typeof value === 'string') return [...value];
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError('multiset expects a rank-1 collection');
        return value.items;
    }
    if (isRankQueue(value)) return value.items;
    if (isRankSet(value)) return value.entries.values();
    if (isRankMultiset(value)) return value.values();
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError('multiset requires a finite sequence');
        }
        return { [Symbol.iterator]: () => value.plan.iterate() };
    }
    throw new RankError('multiset expects a finite collection');
}

function rotateLeft(node: Node): Node {
    const root = node.right!;
    node.right = root.left;
    root.left = node;
    return root;
}

function rotateRight(node: Node): Node {
    const root = node.left!;
    node.left = root.right;
    root.right = node;
    return root;
}

function merge(left: Node | undefined, right: Node | undefined): Node | undefined {
    if (!left) return right;
    if (!right) return left;
    if (left.priority > right.priority) {
        left.right = merge(left.right, right);
        return left;
    }
    right.left = merge(left, right.left);
    return right;
}
