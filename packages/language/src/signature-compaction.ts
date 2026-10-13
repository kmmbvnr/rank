import type { SignatureContainer, SignatureType, TypeSignature } from './type-signature.js';
import { containerVariableDomains, typeVariableDomains } from './signature-matching.js';

const key = (value: unknown): string => JSON.stringify(value);
const collectionKinds = new Set<string>(['array', 'sequence', 'queue', 'stack', 'deque', 'heap', 'set', 'counter', 'multiset']);

/** Display-only factoring. Merge one input at a time: merging two would invent cross-products. */
export function compactSignatures(signatures: readonly TypeSignature[]): readonly TypeSignature[] {
    const rows = [...new Map(signatures.map(row => [key(row), row])).values()];
    for (let left = 0; left < rows.length; left++) {
        for (let right = left + 1; right < rows.length; right++) {
            const a = rows[left], b = rows[right];
            if (a.inputs.length !== b.inputs.length || key(a.result) !== key(b.result) || key(a.ranks) !== key(b.ranks)) continue;
            // Bounds are scoped to an overload. A union must not intersect two different scopes.
            if (key([...typeVariableDomains(a) ?? []]) !== key([...typeVariableDomains(b) ?? []])
                || key([...containerVariableDomains(a)]) !== key([...containerVariableDomains(b)])) continue;
            const differences = a.inputs.flatMap((input, index) => key(input) === key(b.inputs[index]) ? [] : [index]);
            if (differences.length > 1) continue;
            if (differences.length) {
                const index = differences[0];
                rows[left] = { ...a, inputs: a.inputs.map((input, axis) => axis === index
                    ? union([input, b.inputs[index]]) : input) };
            }
            rows.splice(right, 1);
            // A larger rectangle may now join an earlier row.
            left = -1;
            break;
        }
    }
    return rows.map(compactCollections);
}

function union(types: readonly SignatureType[]): SignatureType {
    const members = [...new Map(types.flatMap(type => typeof type === 'object' && 'union' in type
        ? type.union : [type]).map(type => [key(type), type])).values()];
    return members.length === 1 ? members[0] : { union: members };
}

/** Only alternatives in the same union share this abbreviation; different positions stay independent. */
function compactCollections(signature: TypeSignature): TypeSignature {
    let next = 0;
    const scan = (type: SignatureType): void => {
        if (typeof type === 'string') return;
        if ('container' in type) next = Math.max(next, type.container + 1);
        if ('element' in type) scan(type.element);
        if ('union' in type) type.union.forEach(scan);
        if ('tuple' in type) type.tuple.forEach(scan);
        if ('callback' in type) { type.callback.inputs.forEach(scan); scan(type.callback.result); }
    };
    signature.inputs.forEach(scan); scan(signature.result);
    const visit = (type: SignatureType): SignatureType => {
        if (typeof type === 'string') return type;
        if ('element' in type) return { ...type, element: visit(type.element) };
        if ('tuple' in type) return { tuple: type.tuple.map(visit) };
        if ('callback' in type) return { callback: { ...type.callback, inputs: type.callback.inputs.map(visit), result: visit(type.callback.result) } };
        if (!('union' in type)) return type;
        const members = type.union.map(visit);
        const groups = new Map<string, { indices: number[]; kinds: SignatureContainer[]; element: SignatureType }>();
        members.forEach((member, index) => {
            if (typeof member !== 'object' || !('collection' in member) || !collectionKinds.has(member.collection)
                || member.rank !== undefined || member.shape || member.dims) return;
            const id = key(member.element);
            const group = groups.get(id) ?? { indices: [], kinds: [], element: member.element };
            group.indices.push(index); group.kinds.push(member.collection as SignatureContainer); groups.set(id, group);
        });
        const replacements = new Map<number, SignatureType>(), removed = new Set<number>();
        for (const group of groups.values()) {
            if (group.indices.length < 2) continue;
            replacements.set(group.indices[0], { container: next++, kinds: [...new Set(group.kinds)], element: group.element });
            group.indices.slice(1).forEach(index => removed.add(index));
        }
        return union(members.flatMap((member, index) => removed.has(index) ? [] : [replacements.get(index) ?? member]));
    };
    return { ...signature, inputs: signature.inputs.map(visit), result: visit(signature.result) };
}
