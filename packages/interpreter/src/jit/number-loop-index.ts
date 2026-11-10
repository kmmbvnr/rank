import type { NumberContainerTransaction } from './number-container-contract.js';
import { MissingValueError } from '../errors.js';
import { currentDiagnostics } from '../diagnostics.js';
import { IndexEntries, hasNativeIndexEntries, type IndexKey } from '../index-storage.js';
import { IntegerEntries } from '../runtime/integer-entries.js';
import { ResourceMap } from '../resource-summary.js';
import { checkValueMutable } from '../runtime/value-protection.js';
import type { RankIndex } from '../value.js';

const get = Map.prototype.get, has = Map.prototype.has, mapSet = Map.prototype.set, clear = Map.prototype.clear;
const mapKeys = Map.prototype.keys, mapEntries = Map.prototype.entries, mapDelete = Map.prototype.delete;
const mapNext = Object.getPrototypeOf(new Map().keys()).next;
const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const set = IndexEntries.prototype.set, resourceSet = ResourceMap.prototype.set;
const integerProof = Object.getOwnPropertyDescriptor(IntegerEntries.prototype, 'integers')!.get;

/** No user Map hooks may observe private stores or interrupt publication. */
export function hasPrivateIndexStorage(value: RankIndex): boolean {
    const property = Object.getOwnPropertyDescriptor(value, 'entries');
    if (!property || !('value' in property)) return false;
    const entries = property.value;
    return hasNativeIndexEntries(entries) && Object.getPrototypeOf(entries) === IndexEntries.prototype
        && !['get', 'has', 'set', 'integers'].some(name => Object.prototype.hasOwnProperty.call(entries, name))
        && !Object.prototype.hasOwnProperty.call(IndexEntries.prototype, 'integers')
        && entries.get === get && entries.has === has && entries.set === set
        && ResourceMap.prototype.set === resourceSet && Map.prototype.set === mapSet
        && Object.getOwnPropertyDescriptor(IntegerEntries.prototype, 'integers')?.get === integerProof
        && (entries as IndexEntries).integers;
}

/** Append-only stores can use native storage without a duplicate Map, even
 * when an index has seeds. Its insertion-order tail is the rollback journal.
 * Existing keys retain an overlay; no original entry changes before publish.
 * Aliases share one transaction and private polling excludes host callbacks. */
export class PrivateIntegerIndex implements NumberContainerTransaction {
    private changes?: Map<IndexKey, number>;
    private readonly initialSize: number;
    private writes = 0;

    constructor(private readonly source: RankIndex, private readonly overflow: object) {
        this.initialSize = size.call(source.entries);
    }

    has(key: IndexKey): boolean { return this.source.entries.has(key); }

    private value(key: IndexKey, missing: string): number | bigint {
        const changed = this.changes?.get(key);
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
        if (this.initialSize === 0 || !this.source.entries.has(key)) this.source.entries.set(key, BigInt(value));
        else (this.changes ??= new Map()).set(key, value);
        this.writes++;
    }

    rollback(): void {
        // Every stored value was a BigInt, so clearing preserves the integer
        // and resource proofs. Bypass host clear hooks on this private rollback.
        if (this.initialSize === 0) clear.call(this.source.entries);
        else {
            // Regions cannot delete keys or invoke observable Map hooks. The
            // first initialSize keys are therefore exactly the original ones.
            const keys = mapKeys.call(this.source.entries);
            for (let i = 0; i < this.initialSize; i++) mapNext.call(keys);
            for (let entry = mapNext.call(keys); !entry.done; entry = mapNext.call(keys)) mapDelete.call(this.source.entries, entry.value);
        }
    }

    publish(): void {
        if (this.changes) {
            const entries = mapEntries.call(this.changes);
            for (let entry = mapNext.call(entries); !entry.done; entry = mapNext.call(entries)) {
                const [key, value] = entry.value;
                this.source.entries.set(key, BigInt(value));
            }
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.indexWrites += this.writes;
    }
}
