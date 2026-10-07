import { instantiateTypeSignatures, containerVariableDomains, typeVariableDomains } from './signature-matching.js';
export { instantiateTypeSignature, instantiateTypeSignatures, inferSignatureResultTypes } from './signature-matching.js';
import type { ValueFacts } from './analysis/value-domain.js';
import type { Operation } from './operations.js';
import { operationShapeFacts } from './analysis/operation-shape.js';

/** Public language types for display. Compiler eligibility is a separate contract. */
export type SignatureAtom =
    | 'unknown' | 'integer' | 'real' | 'number' | 'boolean' | 'text' | 'symbol' | 'missing'
    | 'date' | 'datetime' | 'duration' | 'bytes' | 'array' | 'sequence' | 'tuple' | 'record'
    | 'table' | 'view' | 'column' | 'object' | 'function' | 'file' | 'database' | 'queue' | 'stack' | 'deque' | 'heap'
    | 'set' | 'counter' | 'multiset' | 'index' | 'graph' | 'dsu' | 'segment' | 'fenwick'
    | 'wavelet' | 'functional';

export type SignatureContainer = 'array' | 'sequence' | 'queue' | 'stack' | 'deque' | 'heap'
    | 'set' | 'counter' | 'multiset';

/** Only an explicit variable can assert that two positions share a type. */
export type SignatureType = SignatureAtom
    | { readonly variable: number; readonly domain?: readonly SignatureAtom[] }
    | { readonly label: string }
    | { readonly union: readonly SignatureType[] }
    /** `rank` counts the axes of an array whose rank is proven, written `array[#, #]<integer>`. */
    | { readonly collection: SignatureAtom; readonly element: SignatureType; readonly rank?: number }
    /** Finite sugar for concrete collection rows; repeated IDs share their kind. */
    | { readonly container: number; readonly kinds: readonly SignatureContainer[]; readonly element: SignatureType }
    | { readonly tuple: readonly SignatureType[] }
    | { readonly callback: TypeSignature };

export interface TypeSignature {
    readonly inputs: readonly SignatureType[];
    readonly result: SignatureType;
    /** Cell ranks, when these are cell signatures lifted over collection frames. */
    readonly ranks?: readonly (number | 'all')[];
}

/** A proven array rank, for display; a sequence is always one lazy axis and needs none. */
function arrayRank(type: string, rank: number | undefined): { rank: number } | undefined {
    return type === 'array' && rank !== undefined && rank >= 1 ? { rank } : undefined;
}

/** Convert proven facts to display types; callers choose how unknown variables are named. */
export function signatureType(value: ValueFacts, unknown: () => SignatureType = () => 'unknown'): SignatureType {
    if (!value.types.length) return unknown();
    const members = value.types.map((name): SignatureType => {
        if (name === 'tuple' && value.tupleItems) return { tuple: value.tupleItems.map(item => signatureType(item, unknown)) };
        if (['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'multiset', 'heap'].includes(name)
            && value.elements?.length) return { collection: name as SignatureAtom,
            element: signatureType({ types: value.elements }, unknown), ...arrayRank(name, value.rank) };
        return name === 'sqlite-expression' ? 'column' : name === 'sqlite-table' ? 'view'
            : name === 'sqlite-database' ? 'database' : name as SignatureAtom;
    });
    return members.length === 1 ? members[0] : { union: members };
}

/** Format facts supplied by the catalogue or analyzer; never infer them from operand names. */
export function formatTypeSignature(signature: TypeSignature): string {
    const variables = new Map<number, string>();
    const constraints = new Map<number, readonly SignatureAtom[]>();
    const kinds = containerVariableDomains(signature);
    const containers = new Map<number, string>();
    let next = 0;
    const fresh = () => {
        let index = next++;
        if (kinds.size && index >= 2) index += 4;
        return index < 26 ? String.fromCharCode(97 + index) : `t${index + 1}`;
    };
    const type = (value: SignatureType, operand = false): string => {
        if (typeof value === 'string') return value === 'unknown' ? '?' : value;
        if ('label' in value) return `.${value.label}`;
        if ('variable' in value) {
            let name = variables.get(value.variable);
            if (!name) variables.set(value.variable, name = fresh());
            if (value.domain) constraints.set(value.variable, value.domain);
            return name;
        }
        if ('union' in value) {
            const members = value.union.map(item => type(item));
            if (members.includes('integer') && members.includes('real')) {
                members.splice(Math.min(members.indexOf('integer'), members.indexOf('real')), 0, 'number');
            }
            const compact = [...new Set(members.filter(item =>
                !members.includes('number') || !['integer', 'real'].includes(item)))];
            const text = compact.join(' | ');
            return operand && compact.length > 1 ? `(${text})` : text;
        }
        if ('collection' in value) {
            // Exact rank: each `#` represents one axis of unknown size.
            if (value.collection === 'array' && value.rank) return `array[${Array(value.rank).fill('#').join(', ')}]<${type(value.element)}>`;
            return `${value.collection}<${type(value.element)}>`;
        }
        if ('container' in value) {
            let name = containers.get(value.container);
            if (!name) containers.set(value.container, name = containers.size < 4
                ? String.fromCharCode(99 + containers.size) : `c${containers.size + 1}`);
            return `${name}<${type(value.element)}>`;
        }
        if ('tuple' in value) return `tuple(${value.tuple.map(item => type(item)).join(', ')})`;
        return `(${body(value.callback)})`;
    };
    const body = (value: TypeSignature): string => {
        const inputs = value.inputs.map(input => type(input, true)).join(' ');
        const result = type(value.result);
        const ranks = value.ranks ? ` [rank ${value.ranks.join(' ')}]` : '';
        return `${inputs ? inputs + ' ' : ''}→ ${result}${ranks}`;
    };
    const formatted = body(signature);
    const domains = typeVariableDomains(signature);
    const bounds = [...constraints].map(([id, domain]) =>
        `${variables.get(id)}: ${type(domains?.get(id) ?? { union: domain })}`);
    bounds.push(...[...containers].map(([id, name]) => `${name}: ${kinds.get(id)!.join(' | ')}`));
    return formatted + (bounds.length ? ` ; ${bounds.join(' ; ')}` : '');
}

/** Filter only proven domain mismatches. An incomplete or invalid call still shows the declared alternatives. */
export function matchingSignatures(signatures: readonly TypeSignature[], inputs: readonly ValueFacts[]): readonly TypeSignature[] {
    const arity = signatures.filter(signature => signature.inputs.length === inputs.length);
    const matches = (pattern: SignatureType, value: ValueFacts): boolean => {
        if (!value.types.length) return true;
        if (typeof pattern === 'string') return pattern === 'unknown' || value.types.some(type =>
            pattern === 'number' ? type === 'integer' || type === 'real'
                : pattern === 'column' ? type === 'sqlite-expression'
                : pattern === 'view' ? type === 'sqlite-table'
                : pattern === 'database' ? type === 'sqlite-database' : type === pattern);
        if ('label' in pattern) return value.types.includes('symbol');
        if ('variable' in pattern) return !pattern.domain || matches({ union: pattern.domain }, value);
        if ('union' in pattern) return pattern.union.some(part => matches(part, value));
        if ('collection' in pattern) return matches(pattern.collection, value)
            && (!value.elements?.length || matches(pattern.element, { types: value.elements }));
        if ('container' in pattern) return pattern.kinds.some(kind => matches(kind, value))
            && (!value.elements?.length || matches(pattern.element, { types: value.elements }));
        if ('tuple' in pattern) return value.types.includes('tuple') && (!value.tupleItems
            || pattern.tuple.length === value.tupleItems.length
                && pattern.tuple.every((part, index) => matches(part, value.tupleItems![index])));
        return value.types.includes('function');
    };
    const cell = (signature: TypeSignature, index: number): ValueFacts => {
        const value = inputs[index];
        return signature.ranks?.[index] === 0 && value.types.length === 1
            && ['array', 'bytes', 'sequence', 'queue', 'stack', 'deque'].includes(value.types[0])
            ? { types: value.types[0] === 'bytes' ? ['integer'] : value.elements ?? [] } : value;
    };
    const narrow = (pattern: SignatureType, value: ValueFacts): SignatureType => {
        if (!value.types.length || typeof pattern === 'string') return pattern;
        if ('union' in pattern) {
            const members = pattern.union.filter(part => matches(part, value)).map(part => narrow(part, value));
            return members.length === 1 ? members[0] : members.length ? { union: members } : pattern;
        }
        if ('collection' in pattern && value.elements?.length) return { ...pattern,
            element: narrow(pattern.element, { types: value.elements }), ...arrayRank(pattern.collection, value.rank) };
        return pattern;
    };
    const candidates = arity.flatMap(signature => {
        const instantiated = instantiateTypeSignatures(signature,
            signature.inputs.map((_, index) => signatureType(cell(signature, index))));
        return instantiated.map(row => ({ ...row, inputs: row.inputs.map((pattern, index) =>
            narrow(pattern, cell(signature, index))) }));
    });
    return candidates.length ? candidates : arity;
}

/** Unknown metadata stays unknown; result roles and operand spelling are not type contracts. */
export function operationSignature(operation: Operation, inputs?: number | readonly ValueFacts[]): string | undefined {
    const signatures = typeof inputs === 'number'
        ? operation.signatures?.filter(signature => signature.inputs.length === inputs)
        : inputs ? matchingSignatures(operation.signatures ?? [], inputs) : operation.signatures;
    // A proven result rank from the operation's shape contract is written on an array result.
    const shaped = typeof inputs === 'object' ? operationShapeFacts(operation, inputs) : undefined;
    const ranked = (signature: TypeSignature): TypeSignature => {
        const result = signature.result;
        return shaped && typeof result === 'object' && 'collection' in result && result.collection === 'array'
            && shaped.types.join() === 'array' && shaped.rank
            ? { ...signature, result: { ...result, rank: shaped.rank } } : signature;
    };
    return signatures?.length ? [...new Set(signatures.map(signature => formatTypeSignature(ranked(signature))))].join(' ; ') : undefined;
}
