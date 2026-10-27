import { ResourceMap } from './resource-summary.js';
import type { RankValue } from './value.js';

/** Maintain the integer-domain proof on every public Map mutation. Compiled
 * readers can enter repeatedly without rescanning the entire collection. */
export class IntegerEntries<K = string> extends ResourceMap<RankValue, K> {
    private nonIntegers = 0;

    constructor(valueOfEntry = (value: RankValue) => value) { super(valueOfEntry); }

    get integers(): boolean { return this.nonIntegers === 0; }

    override set(key: K, value: RankValue): this {
        // The common homogeneous case needs no extra Map lookup. Update the
        // proof only after the resource-aware store succeeds.
        if (this.integers && typeof value === 'bigint') return super.set(key, value);
        const previous = this.has(key) && typeof this.get(key) !== 'bigint';
        super.set(key, value);
        this.nonIntegers += Number(typeof value !== 'bigint') - Number(previous);
        return this;
    }

    override delete(key: K): boolean {
        if (this.has(key) && typeof this.get(key) !== 'bigint') this.nonIntegers--;
        return super.delete(key);
    }

    override clear(): void {
        super.clear();
        this.nonIntegers = 0;
    }
}


const valuesMethod = Map.prototype.values;
const integerGetter = Object.getOwnPropertyDescriptor(IntegerEntries.prototype, 'integers')!.get;

/** A host iterator override must not inherit the stored cells' integer proof. */
export function hasIntegerIteration<K>(entries: Map<K, RankValue>): entries is IntegerEntries<K> {
    if (Object.getPrototypeOf(entries) !== IntegerEntries.prototype
        || Map.prototype.values !== valuesMethod
        || Object.getOwnPropertyDescriptor(IntegerEntries.prototype, 'integers')?.get !== integerGetter
        || Object.prototype.hasOwnProperty.call(entries, 'integers')) return false;
    for (const object of [entries, IntegerEntries.prototype, ResourceMap.prototype]) {
        if (Object.prototype.hasOwnProperty.call(object, 'values')) return false;
    }
    return (entries as IntegerEntries<K>).integers;
}
