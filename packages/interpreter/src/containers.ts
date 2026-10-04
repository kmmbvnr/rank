import { MissingValueError, RankError } from './errors.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from './ordered.js';
import { noteArrayBinding } from './array-storage.js';
import { checkCollectionElementType, isRankQueue, type CollectionElementType, type RankValue } from './value.js';
import { ResourceSummary } from './resource-summary.js';

/** Queue-family storage. Removed entries release their references immediately. */
export class RankDeque {
    private readonly resources = new ResourceSummary();
    readonly kind = 'queue' as const;
    private readonly entries = new Map<number, RankValue>();
    private first = 0;
    private last = 0;
    private typeSummary?: { classify: (value: RankValue) => string; types: ReadonlySet<string> };
    private acceptedElementType?: CollectionElementType;

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
        this.acceptedElementType = checkCollectionElementType(this.mode, () => this.acceptedElementType, value);
        this.resources.include(value);
        noteArrayBinding(value);
        this.typeSummary = undefined;
        this.entries.set(this.last++, value);
        return this;
    }
    pushFront(value: RankValue): this {
        this.acceptedElementType = checkCollectionElementType(this.mode, () => this.acceptedElementType, value);
        this.resources.include(value);
        noteArrayBinding(value);
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

/** Stable priority queue; ties retain insertion order. */
export class RankHeap {
    private readonly resources = new ResourceSummary();
    readonly kind = 'heap' as const;
    private readonly entries: HeapEntry[] = [];
    private priorityKind?: OrderedKind;
    private elementType?: CollectionElementType;
    private nextOrder = 0;

    constructor(readonly descending = false) { this.resources.track(this); }

    get size(): number { return this.entries.length; }
    *values(): IterableIterator<RankValue> { for (const entry of this.entries) yield entry.value; }
    private entry(value: RankValue, priority: RankValue): HeapEntry {
        const kind = orderedKind(priority);
        if (typeof priority === 'number' && Number.isNaN(priority)) throw new RankError('heap priority cannot be NaN');
        if (this.priorityKind !== undefined && this.priorityKind !== kind) {
            throw new RankError('heap priorities must have one comparable type');
        }
        const elementType = checkCollectionElementType('heap', () => this.elementType, value);
        this.elementType = elementType;
        this.priorityKind = kind;
        this.resources.include(value);
        noteArrayBinding(value);
        return { value, priority, order: this.nextOrder++ };
    }
    push(value: RankValue, priority: RankValue = value): this {
        const entry = this.entry(value, priority);
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
    fill(priorities: readonly RankValue[], values: readonly RankValue[]): this {
        if (this.size) throw new RankError('heap must be empty before filling it');
        if (priorities.length !== values.length) throw new RankError('heap priorities and values must have the same length', 'DimensionMismatch');
        for (let index = 0; index < values.length; index++) {
            this.entries.push(this.entry(values[index], priorities[index]));
        }
        for (let index = Math.floor(this.size / 2) - 1; index >= 0; index--) {
            this.siftDown(index, this.entries[index]);
        }
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
        this.siftDown(0, last);
        return value;
    }
    private siftDown(start: number, entry: HeapEntry): void {
        let index = start;
        while (index * 2 + 1 < this.size) {
            let child = index * 2 + 1;
            if (child + 1 < this.size && this.before(this.entries[child + 1], this.entries[child])) child++;
            if (!this.before(this.entries[child], entry)) break;
            this.entries[index] = this.entries[child];
            index = child;
        }
        this.entries[index] = entry;
    }
    private before(a: HeapEntry, b: HeapEntry): boolean {
        const order = compareOrderedValues(a.priority, b.priority, this.priorityKind!);
        return (this.descending ? order > 0 : order < 0) || (order === 0 && a.order < b.order);
    }
}

export function pushCollection(receiver: RankValue, value: RankValue): RankValue {
    if (receiver instanceof RankDeque || receiver instanceof RankHeap) return receiver.push(value);
    if (isRankQueue(receiver)) {
        receiver.elementType = checkCollectionElementType('queue', () => {
            let previous = receiver.elementType;
            for (const item of receiver.items) previous = checkCollectionElementType('queue', previous, item);
            return previous;
        }, value);
        receiver.items.push(value);
        return receiver;
    }
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
