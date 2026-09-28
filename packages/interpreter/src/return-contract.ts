import { arrayRevision, derivedArray, materializedArrayItems, readArrayItem } from './array-storage.js';
import { RankError } from './errors.js';
import { isRankArray, typeName, valueRank, type RankArray, type RankValue } from './value.js';

export function argumentRankSignature(values: readonly RankValue[]): string {
    return JSON.stringify(values.map(value => [typeName(value), valueRank(value)]));
}

export function argumentSignature(values: readonly RankValue[]): string {
    return JSON.stringify(values.map(value => [typeName(value), valueRank(value),
        isRankArray(value) ? elementTypes(value) : null]));
}

const elementTypeCache = new WeakMap<RankArray, { revision: number; types: string[] }>();

function elementTypes(value: RankArray): string[] | undefined {
    if (value.kind === 'bytes') return value.shape.some(size => size === 0) ? [] : ['integer'];
    const revision = arrayRevision(value);
    const cached = elementTypeCache.get(value);
    if (revision !== undefined && cached?.revision === revision) return cached.types;
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
