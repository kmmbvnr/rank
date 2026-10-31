import { MissingValueError } from '../errors.js';
import { currentDiagnostics } from '../diagnostics.js';
import { IndexEntries, hasNativeIndexEntries, type IndexKey } from '../index-storage.js';
import { IntegerEntries } from '../runtime/integer-entries.js';
import { ResourceMap } from '../resource-summary.js';
import { checkValueMutable } from '../runtime/value-protection.js';
import type { RankIndex } from '../value.js';

const get = Map.prototype.get, has = Map.prototype.has, mapSet = Map.prototype.set;
const set = IndexEntries.prototype.set, resourceSet = ResourceMap.prototype.set;
const integerProof = Object.getOwnPropertyDescriptor(IntegerEntries.prototype, 'integers')!.get;

/** No user Map hooks may observe private stores or interrupt publication. */
export function hasPrivateIndexStorage(value: RankIndex): boolean {
    const entries = value.entries;
    return hasNativeIndexEntries(entries) && Object.getPrototypeOf(entries) === IndexEntries.prototype
        && !['get', 'has', 'set', 'integers'].some(name => Object.prototype.hasOwnProperty.call(entries, name))
        && !Object.prototype.hasOwnProperty.call(IndexEntries.prototype, 'integers')
        && entries.get === get && entries.has === has && entries.set === set
        && ResourceMap.prototype.set === resourceSet && Map.prototype.set === mapSet
        && Object.getOwnPropertyDescriptor(IntegerEntries.prototype, 'integers')?.get === integerProof
        && (entries as IndexEntries).integers;
}

/** A write overlay avoids copying large sparse maps. Aliases of the same entries
 * share one overlay. Real errors publish it; overflow discards it for exact replay.
 * Calls are excluded from these regions, so neither reads nor publication can
 * observe an intermediate mixture of index, array and scalar state. */
export class PrivateIntegerIndex {
    private readonly changes = new Map<IndexKey, number>();
    private writes = 0;

    constructor(private readonly source: RankIndex, private readonly overflow: object) {}

    has(key: IndexKey): boolean { return this.changes.has(key) || this.source.entries.has(key); }

    private value(key: IndexKey, missing: string): number | bigint {
        const changed = this.changes.get(key);
        const value = changed === undefined ? this.source.entries.get(key) : changed;
        const diagnostics = currentDiagnostics();
        if (diagnostics) {
            diagnostics.indexReads++;
            if (value === undefined) diagnostics.indexReadMisses++;
            else diagnostics.indexReadHits++;
        }
        if (value === undefined) throw new MissingValueError(missing);
        return value as number | bigint;
    }

    readWide(key: IndexKey, missing = 'missing keyed value'): bigint {
        return BigInt(this.value(key, missing));
    }

    read(key: IndexKey, missing = 'missing keyed value'): number {
        const number = Number(this.value(key, missing));
        if (!Number.isSafeInteger(number)) throw this.overflow;
        return number;
    }

    checkMutable(): void { checkValueMutable(this.source); }

    set(key: IndexKey, value: number): void {
        if (!Number.isSafeInteger(value)) throw this.overflow;
        this.changes.set(key, value);
        this.writes++;
    }

    publish(): void {
        for (const [key, value] of this.changes) this.source.entries.set(key, BigInt(value));
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.indexWrites += this.writes;
    }
}
