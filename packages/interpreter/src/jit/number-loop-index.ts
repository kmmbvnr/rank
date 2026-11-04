import type { NumberContainerTransaction } from './number-container-contract.js';
import { MissingValueError } from '../errors.js';
import { currentDiagnostics } from '../diagnostics.js';
import { IndexEntries, hasNativeIndexEntries, type IndexKey } from '../index-storage.js';
import { IntegerEntries } from '../runtime/integer-entries.js';
import { ResourceMap } from '../resource-summary.js';
import { checkValueMutable } from '../runtime/value-protection.js';
import type { RankIndex } from '../value.js';

const get = Map.prototype.get, has = Map.prototype.has, mapSet = Map.prototype.set, clear = Map.prototype.clear;
const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
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

/** Nonempty indices use an overlay; initially empty ones need no duplicate Map:
 * guarded in-place stores can be cleared on overflow before exact replay. Aliases
 * share a transaction. Real errors retain preceding writes. Only audited scalar
 * natives can run here; callbacks and observable polling retain the exact path. */
export class PrivateIntegerIndex implements NumberContainerTransaction {
    private readonly changes?: Map<IndexKey, number>;
    private writes = 0;

    constructor(private readonly source: RankIndex, private readonly overflow: object) {
        if (size.call(source.entries) > 0) this.changes = new Map();
    }

    has(key: IndexKey): boolean { return this.changes?.has(key) || this.source.entries.has(key); }

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
        if (this.changes) this.changes.set(key, value);
        else this.source.entries.set(key, BigInt(value));
        this.writes++;
    }

    rollback(): void {
        // Every stored value was a BigInt, so clearing preserves the integer
        // and resource proofs. Bypass host clear hooks on this private rollback.
        if (!this.changes) clear.call(this.source.entries);
    }

    publish(): void {
        for (const [key, value] of this.changes ?? []) this.source.entries.set(key, BigInt(value));
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.indexWrites += this.writes;
    }
}
