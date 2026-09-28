import type { Types } from './types.js';

/** Serializable facts only: inspecting these never evaluates user code.
 * Accepted binding fields remain here for compatibility with the current pass.
 */
export interface ValueFacts {
    /** Catalogue identity retained by a proven builtin function alias. */
    readonly builtinOperation?: string;
    /** Internal recursion seed: no returning path has been observed yet. */
    readonly bottom?: true;
    readonly types: Types;
    readonly acceptedTypes?: Types;
    readonly acceptedArrayRank?: number;
    /** Possible array/sequence cells or values stored in an index. */
    readonly elements?: Types;
    /** Rank fixed by the first insertion of an array into a mutable collection. */
    readonly elementRank?: number;
    /** Cell types of array elements stored in a mutable collection. */
    readonly elementCells?: Types;
    /** Identity of a locally constructed collection; dropped when effects are unknown. */
    readonly collectionId?: number;
    /** Element types by position for a fixed rank-1 array. */
    readonly positions?: readonly Types[];
    /** Complete cell facts for a fixed rank-1 array whose cells may themselves be arrays. */
    readonly positionFacts?: readonly ValueFacts[];
    /** Proven eager cells; reading one cannot run a lazy callback. */
    readonly eagerScalarCells?: true;
    /** Derived scalar cells may be lazy, but cannot call Rank code when read. */
    readonly callbackFreeScalarCells?: true;
    readonly rank?: number;
    readonly shape?: readonly (number | null)[];
    readonly boolean?: boolean;
    readonly integer?: string;
    readonly integers?: readonly (number | null)[];
    readonly textLiteral?: string;
    /** Whether a functional graph carries edge weights; `upto` has a different result in each mode. */
    readonly functionalWeighted?: boolean;
    /** Built-in numeric combine proved at construction; user callbacks never get this marker. */
    readonly segmentOperation?: '+' | 'min' | 'max' | 'maxsum' | 'band' | 'bor' | 'bxor';
    /** Known fields of a record; absent fields remain unknown. */
    readonly fields?: Readonly<Record<string, ValueFacts>>;
    /** All field names are known, rather than just an intersection of branch facts. */
    readonly closedRecord?: true;
}

export const UNKNOWN_VALUE: ValueFacts = { types: [] };
export const BOTTOM_VALUE: ValueFacts = { types: [], bottom: true };

/** Stop only the current abstract execution path while a recursive seed is absent. */
export class UnobservedReturn extends Error {}

export function joinTypes(values: readonly Types[]): Types {
    return values.length && values.every(types => types.length)
        ? [...new Set(values.flatMap(types => types))] : [];
}

/** The recursive contract forgets data and read-safety proofs, keeping type and rank. */
export function widenValueFacts(value: ValueFacts): ValueFacts {
    if (value.bottom) return BOTTOM_VALUE;
    if (value.types.join() === 'record') return stableRecordField(value);
    const ranks = value.types.map(type => ['array', 'bytes'].includes(type) ? undefined
        : ['text', 'sequence', 'queue', 'stack', 'deque'].includes(type) ? 1 : 0);
    const rank = value.rank ?? (ranks.length && ranks.every(rank => rank === ranks[0]) ? ranks[0] : undefined);
    return { types: value.types, ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}),
        ...(value.elements ? { elements: value.elements } : {}) };
}

export type FactLookup = ((name: string) => ValueFacts | undefined) & {
    invoke?: (name: string, arguments_: readonly ValueFacts[]) => ValueFacts;
    arity?: (name: string) => number | undefined;
};

export function stableRecordField(value: ValueFacts, construction = false): ValueFacts {
    const { types } = value;
    return { types,
        ...(types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol',
            'date', 'datetime', 'duration'].includes(type)) ? { rank: 0, shape: [] }
            : types.join() === 'text' ? { rank: 1, shape: [null] }
                : types.join() === 'array' || types.join() === 'bytes'
                    ? { rank: value.rank, shape: value.rank === undefined ? undefined : Array(value.rank).fill(null),
                        elements: !construction || value.shape?.every(size => size !== null && size > 0)
                            ? value.elements : undefined }
                    : types.join() === 'record' ? { rank: 0, shape: [],
                        ...(value.fields ? { fields: Object.fromEntries(Object.entries(value.fields)
                            .map(([name, field]) => [name, stableRecordField(field)])) } : {}),
                        ...(value.closedRecord ? { closedRecord: true as const } : {}) } : {}) };
}

export function broadcastShape(left: readonly (number | null)[], right: readonly (number | null)[]): (number | null)[] {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
        const offset = Math.max(left.length, right.length) - index;
        const a = offset > left.length ? 1 : left.at(-offset);
        const b = offset > right.length ? 1 : right.at(-offset);
        return a == null || b == null ? null : a === 1 ? b : a;
    });
}

/** Unknown axes are not mismatches. Singleton axes follow runtime broadcasting. */
export function incompatibleShapes(left: ValueFacts, right: ValueFacts): boolean {
    // Text participates in scalar operations; its code-point length is not a broadcast axis.
    if (isAtom(left) || isAtom(right) || left.types.includes('text') || right.types.includes('text')) return false;
    if (!left.shape || !right.shape) return false;
    for (let offset = 1; offset <= Math.min(left.shape.length, right.shape.length); offset++) {
        const a = left.shape.at(-offset);
        const b = right.shape.at(-offset);
        if (a != null && b != null && a !== b && a !== 1 && b !== 1) return true;
    }
    return false;
}

export function isAtom(facts: ValueFacts): boolean {
    return facts.rank === 0 || facts.types.length === 1 && facts.types[0] === 'text';
}

/** Facts shared by every reachable path, with a union of possible runtime types. */
export function joinValueFacts(values: readonly ValueFacts[]): ValueFacts {
    if (!values.length) return UNKNOWN_VALUE;
    values = values.filter(value => !value.bottom);
    if (!values.length) return BOTTOM_VALUE;
    const first = values[0];
    const types = joinTypes(values.map(value => value.types));
    const scalar = types.length > 0 && types.every(type =>
        ['integer', 'real', 'boolean', 'symbol', 'date', 'datetime', 'duration'].includes(type));
    const rank = scalar ? 0 : values.every(value => value.rank === first.rank) ? first.rank : undefined;
    const shape = rank !== undefined && values.every(value => value.shape?.length === rank)
        ? first.shape!.map((dimension, axis) => values.every(value => value.shape![axis] === dimension) ? dimension : null)
        : scalar ? [] : undefined;
    const elements = values.every(value => value.elements !== undefined
        && (value.elements.length > 0 || types.join() === 'index'))
        ? [...new Set(values.flatMap(value => value.elements!))] : undefined;
    const elementRank = elements?.join() === 'array' && values.every(value => value.elementRank === first.elementRank)
        ? first.elementRank : undefined;
    const positions = first.positions && values.every(value => value.positions?.length === first.positions!.length)
        ? first.positions.map((_, index) => values.every(value => value.positions![index].length)
            ? [...new Set(values.flatMap(value => value.positions![index]))] : []) : undefined;
    const fields = types.join() === 'record' && first.fields
        ? Object.fromEntries(Object.keys(first.fields).filter(name => values.every(value => value.fields?.[name]))
            .map(name => [name, joinValueFacts(values.map(value => value.fields![name]))])) : undefined;
    return { types, ...(rank !== undefined ? { rank } : {}), ...(shape ? { shape } : {}),
        ...(first.builtinOperation && values.every(value => value.builtinOperation === first.builtinOperation)
            ? { builtinOperation: first.builtinOperation } : {}),
        ...(types.join() === 'boolean' && first.boolean !== undefined
            && values.every(value => value.boolean === first.boolean) ? { boolean: first.boolean } : {}),
        ...(first.functionalWeighted !== undefined
            && values.every(value => value.functionalWeighted === first.functionalWeighted)
            ? { functionalWeighted: first.functionalWeighted } : {}),
        ...(first.segmentOperation && values.every(value => value.segmentOperation === first.segmentOperation)
            ? { segmentOperation: first.segmentOperation } : {}),
        ...(elements ? { elements } : {}),
        ...(elementRank !== undefined ? { elementRank } : {}),
        ...(values.every(value => value.elementCells?.length)
            ? { elementCells: joinTypes(values.map(value => value.elementCells!)) } : {}),
        ...(first.collectionId !== undefined && values.every(value => value.collectionId === first.collectionId)
            ? { collectionId: first.collectionId } : {}),
        ...(positions ? { positions } : {}),
        ...(fields ? { fields } : {}),
        ...(fields && values.every(value => value.closedRecord && value.fields
            && Object.keys(value.fields).length === Object.keys(fields).length) ? { closedRecord: true as const } : {}),
        ...(first.textLiteral !== undefined && values.every(value => value.textLiteral === first.textLiteral)
            ? { textLiteral: first.textLiteral } : {}),
        ...(values.every(value => value.eagerScalarCells) ? { eagerScalarCells: true as const }
            : values.every(value => value.eagerScalarCells || value.callbackFreeScalarCells)
                ? { callbackFreeScalarCells: true as const } : {}) };
}
