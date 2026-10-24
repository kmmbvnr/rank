import { arrayDeclaration, inheritArrayDeclaration } from './array-declaration.js';
import { binaryType, type ValueFacts } from '@arrrank/language';
import { isRankPlan } from './plan.js';
import { arrayElementTypes } from './array-element-types.js';
import { arrayRevision } from './array-storage.js';
import { collectionElementType, isRankArray, isRankRecord, isRankTuple, typeName, valueRank,
    type CollectionElementType, type RankArray, type RankValue } from './value.js';

type ArrayElementContract = NonNullable<ValueFacts['declaredArrayContract']>;

/** A type is independent of the storage cache. Unresolved domains stay
 * unresolved across reads/copies; stored cells are not a declaration. */
export interface SemanticArrayType {
    readonly key: string;
    readonly scalar?: string;
}
interface Entry { readonly type: SemanticArrayType; readonly revision?: number }
const types = new WeakMap<RankArray, Entry>();
const UNRESOLVED: SemanticArrayType = Object.freeze({ key: 'unresolved' });

export function setSemanticArrayType<T extends RankArray>(value: T, type: SemanticArrayType): T {
    types.set(value, { type, revision: arrayRevision(value) });
    return value;
}

export function inheritSemanticArrayType<T extends RankArray>(source: RankArray, target: T): T {
    inheritArrayDeclaration(source, target);
    return setSemanticArrayType(target, semanticArrayType(source));
}

/** No itemAt, getters, callbacks, or already materialized lazy caches are read. */
export function semanticArrayType(value: RankArray): SemanticArrayType {
    const declaration = arrayDeclaration(value);
    if (declaration?.elements?.length) return semanticArrayContract(declaration);
    const previous = types.get(value);
    const lazy = 'itemAt' in value || !Object.getOwnPropertyDescriptor(value, 'items')?.value;
    const revision = arrayRevision(value);
    if (previous && (lazy || revision !== undefined && revision === previous.revision)) return previous.type;
    // Preserve existing specialization granularity: direct array element kinds.
    // Recursive validation belongs to the binding/return contract, not a scan
    // of nested values while selecting a call specialization.
    const cells = lazy && value.kind !== 'bytes' ? undefined
        : arrayElementTypes(value, true)?.filter(type => !['missing', 'numeric-limit'].includes(type));
    const type = elementType(cells);
    types.set(value, { type, revision });
    return type;
}

function elementType(cells: readonly string[] | undefined): SemanticArrayType {
    return cells?.length ? { key: JSON.stringify(cells),
        ...(cells.length === 1 && !['array', 'bytes', 'tuple', 'record'].includes(cells[0]) ? { scalar: cells[0] } : {}) }
        : UNRESOLVED;
}

export function semanticArrayContract(contract: CollectionElementType): SemanticArrayType {
    return elementType(contract.elements?.map(cell => cell.type)
        .filter(type => !['missing', 'numeric-limit'].includes(type)).sort());
}

/** Structural types, not values, lengths, or evaluation/storage properties. */
export function semanticValueType(value: RankValue, elements = true): unknown {
    if (isRankPlan(value)) return semanticFactType(value.result, elements);
    if (isRankArray(value)) return [typeName(value), valueRank(value), elements ? semanticArrayType(value).key : null];
    if (isRankTuple(value)) return ['tuple', 0, value.items.map(item => semanticValueType(item, elements))];
    // Records already require eager field validation, independently of calls.
    if (isRankRecord(value)) return ['record', 0, contractType(collectionElementType(value, new Set(), true), elements)];
    return [typeName(value), valueRank(value)];
}

/** Result facts describe a plan without demanding it or observing host cells. */
function semanticFactType(value: ValueFacts | undefined, elements: boolean): unknown {
    const type = value?.types.length === 1 ? value.types[0] : 'unknown';
    const rank = value?.rank ?? (type === 'text' ? 1 : 0);
    if (type === 'array' || type === 'bytes') {
        const contract = factContract(value!);
        return [type, rank, elements ? semanticArrayContract(contract).key : null];
    }
    if (type === 'tuple') return [type, 0, value?.tupleItems?.map(item => semanticFactType(item, elements))];
    if (type === 'record') return [type, 0, contractType(factContract(value!), elements)];
    return [type, rank];
}

function factContract(value: ValueFacts): CollectionElementType {
    const declared = value.acceptedArrayContract ?? value.declaredArrayContract;
    if (declared) return declaredContract(declared);
    const type = value.types.length === 1 ? value.types[0] : 'unknown';
    const array = type === 'array' || type === 'bytes';
    return { type, ...(array ? { rank: value.rank,
        elements: value.elements?.map(type => type === 'record' && value.elementRecord
            ? factContract(value.elementRecord) : { type }) } : {}),
        ...(type === 'tuple' ? { positions: value.tupleItems?.map(factContract) } : {}),
        ...(type === 'record' && value.closedRecord && value.fields ? {
            fields: new Map(Object.entries(value.fields).map(([name, field]) => [name, factContract(field)])),
        } : {}) };
}

function declaredContract(value: ArrayElementContract): CollectionElementType {
    const position = (choices: readonly ArrayElementContract[]): CollectionElementType =>
        choices.length === 1 ? declaredContract(choices[0]) : { type: 'unknown' };
    return { type: value.type, rank: value.rank,
        positions: value.positions?.map(position), elements: value.elements?.map(declaredContract),
        fields: value.fields && new Map(Object.entries(value.fields).map(([name, choices]) => [name, position(choices)])),
    };
}

function contractType(value: CollectionElementType, elements: boolean): unknown {
    return [value.type, value.rank, value.positions?.map(cell => contractType(cell, elements)),
        elements ? value.elements?.filter(cell => !['missing', 'numeric-limit'].includes(cell.type)).map(cell => contractType(cell, elements)) : null,
        value.fields && [...value.fields].sort(([a], [b]) => a.localeCompare(b)).map(([name, field]) => [name, contractType(field, elements)])];
}

/** Reuse the analyzer's scalar operator rules; never run an operator to probe a type. */
export function binaryArrayType(operator: string, left: RankValue, right: RankValue): SemanticArrayType | undefined {
    if (['equal', 'notequal', 'less', 'greater', 'atmost', 'atleast', 'and', 'or', 'xor'].includes(operator)) {
        return { key: '["boolean"]', scalar: 'boolean' };
    }
    const scalar = (value: RankValue) => isRankArray(value) ? semanticArrayType(value).scalar : typeName(value);
    const a = scalar(left), b = scalar(right);
    if (!a || !b) return undefined;
    const result = binaryType(operator, [a], [b]);
    return result.length === 1 && !['array', 'sequence'].includes(result[0])
        ? { key: JSON.stringify(result), scalar: result[0] } : undefined;
}
