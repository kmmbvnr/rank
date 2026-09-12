import { MissingValueError, RankError } from './errors.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from './ordered.js';
import { isRankQueue, type RankValue } from './value.js';
import { ResourceSummary } from './resource-summary.js';

/** Queue-family storage. Removed entries release their references immediately. */
export class RankDeque {
    private readonly resources = new ResourceSummary();
    readonly kind = 'queue' as const;
    private readonly entries = new Map<number, RankValue>();
    private first = 0;
    private last = 0;
    private typeSummary?: { classify: (value: RankValue) => string; types: ReadonlySet<string> };

    constructor(readonly mode: 'queue' | 'deque' | 'stack' = 'queue') {
        this.resources.track(this);
    }

    get size(): number { return this.last - this.first; }
    get items(): RankValue[] { return [...this.values()]; }
    at(index: number): RankValue | undefined { return this.entries.get(this.first + index); }
    *values(): IterableIterator<RankValue> {
        for (let index = this.first; index < this.last; index++) yield this.entries.get(index)!;
    }
    /** A snapshot: loop declarations may retain this set after mutation. */
    iterationTypes(classify: (value: RankValue) => string): ReadonlySet<string> {
        if (this.typeSummary?.classify !== classify) {
            this.typeSummary = { classify, types: new Set(Array.from(this.values(), classify)) };
        }
        return this.typeSummary.types;
    }
    push(value: RankValue): this {
        this.resources.include(value);
        this.typeSummary = undefined;
        this.entries.set(this.last++, value);
        return this;
    }
    pushFront(value: RankValue): this {
        this.resources.include(value);
        this.typeSummary = undefined;
        this.entries.set(--this.first, value);
        return this;
    }
    peek(back = this.mode === 'stack'): RankValue {
        if (!this.size) throw new MissingValueError(`${this.mode} is empty`);
        return this.entries.get(back ? this.last - 1 : this.first)!;
    }
    pop(back = this.mode === 'stack'): RankValue {
        const value = this.peek(back);
        this.typeSummary = undefined;
        this.entries.delete(back ? --this.last : this.first++);
        if (!this.size) this.first = this.last = 0;
        return value;
    }
}

interface HeapEntry { readonly priority: RankValue; readonly value: RankValue; readonly order: number; }

/** Stable min-priority queue; ties retain insertion order. */
export class RankHeap {
    private readonly resources = new ResourceSummary();
    readonly kind = 'heap' as const;
    private readonly entries: HeapEntry[] = [];
    private priorityKind?: OrderedKind;
    private nextOrder = 0;

    constructor() { this.resources.track(this); }

    get size(): number { return this.entries.length; }
    *values(): IterableIterator<RankValue> { for (const entry of this.entries) yield entry.value; }
    push(value: RankValue, priority: RankValue = value): this {
        const kind = orderedKind(priority);
        if (typeof priority === 'number' && Number.isNaN(priority)) throw new RankError('heap priority cannot be NaN');
        if (this.priorityKind !== undefined && this.priorityKind !== kind) {
            throw new RankError('heap priorities must have one comparable type');
        }
        this.priorityKind = kind;
        this.resources.include(value);
        const entry = { value, priority, order: this.nextOrder++ };
        let index = this.entries.length;
        this.entries.push(entry);
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (!this.before(entry, this.entries[parent])) break;
            this.entries[index] = this.entries[parent];
            index = parent;
        }
        this.entries[index] = entry;
        return this;
    }
    peek(): RankValue {
        if (!this.size) throw new MissingValueError('heap is empty');
        return this.entries[0].value;
    }
    pop(): RankValue {
        const value = this.peek();
        const last = this.entries.pop()!;
        if (!this.size) { this.priorityKind = undefined; this.nextOrder = 0; return value; }
        let index = 0;
        while (index * 2 + 1 < this.size) {
            let child = index * 2 + 1;
            if (child + 1 < this.size && this.before(this.entries[child + 1], this.entries[child])) child++;
            if (!this.before(this.entries[child], last)) break;
            this.entries[index] = this.entries[child];
            index = child;
        }
        this.entries[index] = last;
        return value;
    }
    private before(a: HeapEntry, b: HeapEntry): boolean {
        const order = compareOrderedValues(a.priority, b.priority, this.priorityKind!);
        return order < 0 || (order === 0 && a.order < b.order);
    }
}

export function pushCollection(receiver: RankValue, value: RankValue): RankValue {
    if (receiver instanceof RankDeque || receiver instanceof RankHeap) return receiver.push(value);
    if (isRankQueue(receiver)) { receiver.items.push(value); return receiver; }
    throw new RankError('push expects a queue, deque, stack or heap receiver');
}

export function peekCollection(receiver: RankValue, remove: boolean): RankValue {
    if (receiver instanceof RankDeque || receiver instanceof RankHeap) return remove ? receiver.pop() : receiver.peek();
    if (isRankQueue(receiver)) {
        if (!receiver.items.length) throw new MissingValueError('queue is empty');
        return remove ? receiver.items.shift()! : receiver.items[0];
    }
    throw new RankError('pop/peek expects a queue, deque, stack or heap');
}

export function expectDeque(value: RankValue): RankDeque {
    if (value instanceof RankDeque && value.mode === 'deque') return value;
    throw new RankError('operation expects a deque');
}

export function expectHeap(value: RankValue): RankHeap {
    if (value instanceof RankHeap) return value;
    throw new RankError('enqueue expects a heap');
}
