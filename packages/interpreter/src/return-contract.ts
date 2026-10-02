import { ArrayBindingContract } from './array-binding-contract.js';
import { arrayElementTypes } from './array-element-types.js';
import { arrayRevision } from './array-storage.js';
import { RankError } from './errors.js';
import { isRankArray, isRankRecord, isRankTuple, collectionElementType, mergeCollectionElementType, typeName, valueRank,
    type CollectionElementType, type RankValue } from './value.js';
import { retainRecordContract } from './record-contract.js';

export function argumentRankSignature(values: readonly RankValue[]): string {
    return JSON.stringify(values.map(value => [typeName(value), valueRank(value),
        structuralSignature(value, false)]));
}

// The compile target predates WeakRef; every supported runtime has it, and the memo is skipped otherwise.
declare class WeakRef<T extends object> { constructor(target: T); deref(): T | undefined }
const weakRefs = typeof WeakRef === 'function';

interface SignatureMemo {
    readonly held: readonly unknown[];
    readonly revisions: readonly (number | undefined)[];
    readonly ranks: readonly number[];
    readonly key: string;
}

let signatureMemo: SignatureMemo | undefined;

/**
 * One call asks for the same signature several times (body cache, contract,
 * frame layout). Scalars and revision-tracked arrays cannot change type behind
 * the same identity and revision, so the last key is reused for them; any other
 * value (records, sequences, host arrays) recomputes. Objects are held weakly.
 */
function memoizedSignature(values: readonly RankValue[]): string | undefined {
    const memo = signatureMemo;
    if (!memo || memo.held.length !== values.length) return undefined;
    for (let index = 0; index < values.length; index++) {
        const value = values[index], held = memo.held[index];
        if (typeof value !== 'object') {
            if (held !== value || typeof held === 'object') return undefined;
        } else {
            if (!isRankArray(value) || (held as WeakRef<object>)?.deref?.() !== value) return undefined;
            const revision = arrayRevision(value);
            if (revision === undefined || revision !== memo.revisions[index] || value.shape.length !== memo.ranks[index]) return undefined;
        }
    }
    return memo.key;
}

export function argumentSignature(values: readonly RankValue[]): string {
    const memoized = memoizedSignature(values);
    if (memoized !== undefined) return memoized;
    const key = JSON.stringify(values.map(value => [typeName(value), valueRank(value),
        isRankArray(value) ? arrayElementTypes(value) : null,
        structuralSignature(value, true)]));
    signatureMemo = weakRefs && values.every(value => typeof value !== 'object' || isRankArray(value) && arrayRevision(value) !== undefined)
        ? { held: values.map(value => typeof value === 'object' ? new WeakRef(value) : value),
            revisions: values.map(value => isRankArray(value) ? arrayRevision(value) : undefined),
            ranks: values.map(value => isRankArray(value) ? value.shape.length : 0), key } : undefined;
    return key;
}

function structuralSignature(value: RankValue, elements: boolean): unknown {
    if (isRankTuple(value)) return value.items.map(item => [typeName(item), valueRank(item),
        elements && isRankArray(item) ? arrayElementTypes(item) : null, structuralSignature(item, elements)]);
    return isRankRecord(value) ? recordSignature(collectionElementType(value, new Set(), true), elements) : null;
}

function recordSignature(value: CollectionElementType, elements: boolean): unknown {
    return [value.type, value.rank ?? null, value.positions?.map(cell => recordSignature(cell, elements)),
        elements ? value.elements?.map(cell => recordSignature(cell, elements))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : null,
        value.fields ? [...value.fields].sort(([a], [b]) => a.localeCompare(b))
            .map(([name, field]) => [name, recordSignature(field, elements)]) : null];
}

/** A contract belongs to one closure and one argument specialization. */
export class ReturnContract {
    private type?: string;
    private array?: ArrayBindingContract;
    private record?: CollectionElementType;

    constructor(private readonly name: string, private readonly ranks: { rank?: number } = {}) {}

    check(value: RankValue): RankValue {
        const rank = valueRank(value), type = typeName(value);
        if (this.ranks.rank !== undefined && this.ranks.rank !== rank) {
            throw new RankError(`${this.name} returns rank ${this.ranks.rank} and cannot return rank ${rank}`, 'ReturnRankMismatch');
        }
        if (this.type !== undefined && this.type !== type) {
            throw new RankError(`${this.name} returns ${this.type} and cannot return ${type}`, 'ReturnTypeMismatch');
        }
        if (isRankRecord(value)) {
            const received = collectionElementType(value, new Set(), true);
            let contract: CollectionElementType;
            try {
                contract = mergeCollectionElementType(`${this.name} return`, this.record, received);
            } catch (error) {
                if (!(error instanceof RankError)) throw error;
                throw new RankError(error.message, 'ReturnTypeMismatch');
            }
            retainRecordContract(value, contract);
            this.record = contract;
        }
        this.ranks.rank = rank;
        this.type = type;
        if (isRankArray(value) || isRankTuple(value)) {
            try { return (this.array ??= new ArrayBindingContract(`${this.name} return`, 'ReturnTypeMismatch')).check(value); }
            catch (error) {
                if (!(error instanceof RankError)) throw error;
                throw new RankError(error.message, 'ReturnTypeMismatch');
            }
        }
        return value;
    }
}
