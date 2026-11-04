import { checkpoint } from '../interrupt.js';
import { checkValueMutable } from './value-protection.js';
import { MissingValueError, RankError } from '../errors.js';

export interface FenwickNumberSnapshot {
    values: Float64Array;
    tree: Float64Array;
    publish(): void;
}

const nativeInstances = new WeakSet<RankFenwick>();

/** A fixed-size integer array with logarithmic prefix sums. */
export class RankFenwick {
    readonly kind = 'fenwick' as const;
    #values: Float64Array | bigint[];
    #tree: Float64Array | bigint[];

    constructor(size: bigint) {
        if (size < 0n) throw new RankError('fenwick size must be nonnegative');
        if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`fenwick size is too large: ${size}`);
        }
        const length = Number(size);
        this.#values = new Float64Array(length);
        this.#tree = new Float64Array(length + 1);
        nativeInstances.add(this);
    }

    get size(): number {
        return this.#values.length;
    }

    /** Internal transaction snapshot. Native identity is checked before entry;
     * budgets/custom polling keep the publishing backend instead. */
    numberSnapshot(): FenwickNumberSnapshot | undefined {
        if (!(this.#values instanceof Float64Array) || !(this.#tree instanceof Float64Array)) return undefined;
        const values = new Float64Array(this.#values.length), tree = new Float64Array(this.#tree.length);
        for (const [source, copy] of [[this.#values, values], [this.#tree, tree]]) {
            for (let first = 0; first < source.length; first += 4096) {
                const end = Math.min(first + 4096, source.length);
                checkpoint('preparing fenwick tree', end - first);
                copy.set(source.subarray(first, end), first);
            }
        }
        return { values, tree, publish: () => { this.#values = values; this.#tree = tree; } };
    }

    at(index: bigint): bigint {
        return BigInt(this.#values[this.#position(index)]);
    }

    set(index: bigint, value: bigint): void {
        checkValueMutable(this);
        const position = this.#position(index);
        const values = this.#values;
        const delta = value - BigInt(values[position]);
        if (values instanceof Float64Array) {
            const number = Number(value);
            if (Number.isSafeInteger(number)) values[position] = number;
            else {
                const wide = Array.from(values,BigInt);
                wide[position] = value;
                this.#values = wide;
            }
        } else values[position] = value;
        this.#update(position, delta);
    }

    sum(index: bigint): bigint {
        if (index === -1n) return 0n;
        let position = this.#position(index) + 1;
        const tree = this.#tree;
        if (tree instanceof Float64Array) {
            let total = 0;
            for (let at = position; at > 0; at -= at & -at) {
                total += tree[at];
                if (!Number.isSafeInteger(total)) return this.#sumExact(position);
            }
            return BigInt(total);
        }
        return this.#sumExact(position);
    }

    #sumExact(position: number): bigint {
        const tree = this.#tree;
        let total = 0n;
        while (position > 0) {
            total += BigInt(tree[position]);
            position -= position & -position;
        }
        return total;
    }

    #position(index: bigint): number {
        if (index < 0n || index >= BigInt(this.#values.length)) {
            throw new MissingValueError(`fenwick index out of bounds: ${index}`);
        }
        return Number(index);
    }

    #update(position: number, delta: bigint): void {
        let index = position + 1;
        let tree = this.#tree;
        if (tree instanceof Float64Array) {
            const number = Number(delta);
            if (Number.isSafeInteger(number)) {
                for (; index < tree.length; index += index & -index) {
                    const next = tree[index] + number;
                    if (!Number.isSafeInteger(next)) break;
                    tree[index] = next;
                }
                if (index >= tree.length) return;
            }
            // Earlier nodes already contain the update. Widen before this
            // node can round, then finish the remaining exact stores once.
            this.#tree = tree = Array.from(tree,BigInt);
        }
        for (; index < tree.length; index += index & -index) {
            tree[index] += delta;
        }
    }
}

export function expectFenwick(value: unknown): RankFenwick {
    if (!(value instanceof RankFenwick)) throw new RankError('operation expects a fenwick tree');
    return value;
}

const nativeMethods = Object.entries(Object.getOwnPropertyDescriptors(RankFenwick.prototype));

/** Region entry must exclude replacement methods and observable fields. */
export function hasNativeFenwick(value: unknown): value is RankFenwick {
    if (!value || typeof value !== 'object' || !nativeInstances.has(value as RankFenwick)
        || Object.getPrototypeOf(value) !== RankFenwick.prototype) return false;
    if (Object.getOwnPropertyDescriptor(value,'kind')?.value !== 'fenwick') return false;
    return nativeMethods.every(([name, descriptor]) => {
        const current = Object.getOwnPropertyDescriptor(RankFenwick.prototype, name);
        return !Object.prototype.hasOwnProperty.call(value, name)
            && current?.value === descriptor.value && current?.get === descriptor.get && current?.set === descriptor.set;
    });
}
