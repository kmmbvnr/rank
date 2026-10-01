import { arrayRevision, denseScalarItems, derivedArray, materializedArrayItems, readArrayItem, typedElementKind } from './array-storage.js';
import { RankError } from './errors.js';
import { isRankArray, isRankRecord, mergeCollectionElementType, typeName, valueRank,
    type CollectionElementType, type RankArray, type RankValue } from './value.js';
import { recordContract, retainRecordContract } from './record-contract.js';

export function argumentRankSignature(values: readonly RankValue[]): string {
    return JSON.stringify(values.map(value => [typeName(value), valueRank(value),
        isRankRecord(value) ? recordSignature(recordContract(value), false) : null]));
}

/**
 * A cache key per argument specialization: type, rank and element types, with a
 * length-prefixed record contract. Type names are identifiers, so the plain
 * delimiters cannot collide.
 */
export function argumentSignature(values: readonly RankValue[]): string {
    let key = '';
    for (let index = 0; index < values.length; index++) {
        const value = values[index];
        const types = isRankArray(value) ? elementTypes(value) : null;
        key += `${typeName(value)}|${valueRank(value)}|${types === null ? '-' : types === undefined ? '?' : types.join(',')}`;
        if (isRankRecord(value)) {
            const record = JSON.stringify(recordSignature(recordContract(value), true));
            key += `|${record.length}:${record}`;
        }
        key += ';';
    }
    return key;
}

function recordSignature(value: CollectionElementType, elements: boolean): unknown {
    return [value.type, value.rank ?? null,
        elements ? value.elements?.map(cell => recordSignature(cell, elements))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : null,
        value.fields ? [...value.fields].sort(([a], [b]) => a.localeCompare(b))
            .map(([name, field]) => [name, recordSignature(field, elements)]) : null];
}

const elementTypeCache = new WeakMap<RankArray, { revision: number; types: string[] }>();

function elementTypes(value: RankArray): string[] | undefined {
    if (value.kind === 'bytes') return value.shape.some(size => size === 0) ? [] : ['integer'];
    const revision = arrayRevision(value);
    const cached = elementTypeCache.get(value);
    if (revision !== undefined && cached?.revision === revision) return cached.types;
    const typed = typedElementKind(value);
    if (typed) return [typed];
    const dense = denseScalarItems(value);
    if (dense) {
        // Stored scalars cannot hide getters, so no descriptor lookup is needed.
        const types = new Set<string>();
        let last: string | undefined;
        for (let index = 0; index < dense.length; index++) {
            const item = dense[index];
            const type = typeof item === 'bigint' ? 'integer' : typeof item === 'number' ? 'real' : typeName(item);
            if (type !== last) { types.add(type); last = type; }
        }
        const result = [...types].sort();
        if (revision !== undefined) elementTypeCache.set(value, { revision, types: result });
        return result;
    }
    const items = materializedArrayItems(value);
    if (!items) return undefined;
    // Property descriptors avoid invoking getters on host-supplied cells.
    const types = new Set<string>();
    for (let index = 0; index < items.length; index++) {
        const property = Object.getOwnPropertyDescriptor(items, index);
        if (!property || !('value' in property)) return undefined;
        types.add(typeName(property.value));
    }
    const result = [...types].sort();
    if (revision !== undefined) elementTypeCache.set(value, { revision, types: result });
    return result;
}

/** A contract belongs to one closure and one argument specialization. */
export class ReturnContract {
    private type?: string;
    private elements?: Set<string>;
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
        const types = isRankArray(value) ? elementTypes(value) : undefined;
        const elements = types?.length ? new Set(types) : undefined;
        if (elements) this.checkElements(elements);
        if (isRankRecord(value)) {
            const received = recordContract(value);
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
        if (isRankArray(value) && types === undefined) {
            // Keep lazy cells lazy. Check observed cells against a settled type,
            // and settle a new element contract once a whole result is known.
            const seen = new Set<number>();
            const observed = new Set<string>();
            const size = value.shape.reduce((a, b) => a * b, 1);
            const checked = derivedArray(value.shape, [value], index => {
                const item = readArrayItem(value, index);
                const type = typeName(item);
                if (this.elements && !this.elements.has(type)) this.mismatch(new Set([type]));
                seen.add(index);
                observed.add(type);
                if (seen.size === size) this.checkElements(observed);
                return item;
            }, value.containsFiles === false);
            for (const key of ['columnNames', 'tableScopes', 'sortKeys'] as const) {
                if (value[key] !== undefined) Object.defineProperty(checked, key, { value: value[key] });
            }
            return checked;
        }
        return value;
    }

    private mismatch(elements: ReadonlySet<string>): never {
        throw new RankError(`${this.name} returns elements of type ${[...this.elements!].join(' or ')} `
            + `and cannot return ${[...elements].join(' or ')}`, 'ReturnTypeMismatch');
    }

    private checkElements(elements: Set<string>): void {
        if (!elements.size) return;
        if (this.elements && (elements.size !== this.elements.size
            || [...elements].some(type => !this.elements!.has(type)))) this.mismatch(elements);
        this.elements ??= elements;
    }
}
