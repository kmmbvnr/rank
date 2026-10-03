import type { ValueFacts } from './analysis/value-domain.js';
import type { Operation } from './operations.js';

/** Public language types for display. Compiler eligibility is a separate contract. */
export type SignatureAtom =
    | 'unknown' | 'integer' | 'real' | 'number' | 'boolean' | 'text' | 'symbol' | 'missing'
    | 'date' | 'datetime' | 'duration' | 'bytes' | 'array' | 'sequence' | 'tuple' | 'record'
    | 'table' | 'view' | 'column' | 'object' | 'function' | 'file' | 'database' | 'queue' | 'stack' | 'deque' | 'heap'
    | 'set' | 'counter' | 'multiset' | 'index' | 'graph' | 'dsu' | 'segment' | 'fenwick'
    | 'wavelet' | 'functional';

/** Only an explicit variable can assert that two positions share a type. */
export type SignatureType = SignatureAtom
    | { readonly variable: number }
    | { readonly label: string }
    | { readonly union: readonly SignatureType[] }
    | { readonly collection: SignatureAtom; readonly element: SignatureType }
    | { readonly tuple: readonly SignatureType[] }
    | { readonly callback: TypeSignature };

export interface TypeSignature {
    readonly inputs: readonly SignatureType[];
    readonly result: SignatureType;
    /** Cell ranks, when these are cell signatures lifted over collection frames. */
    readonly ranks?: readonly (number | 'all')[];
}

/** Convert proven facts to display types; callers choose how unknown variables are named. */
export function signatureType(value: ValueFacts, unknown: () => SignatureType = () => 'unknown'): SignatureType {
    if (!value.types.length) return unknown();
    const members = value.types.map((name): SignatureType => {
        if (name === 'tuple' && value.tupleItems) return { tuple: value.tupleItems.map(item => signatureType(item, unknown)) };
        if (['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'multiset', 'heap'].includes(name)
            && value.elements?.length) return { collection: name as SignatureAtom,
            element: signatureType({ types: value.elements }, unknown) };
        return name === 'sqlite-expression' ? 'column' : name === 'sqlite-table' ? 'view'
            : name === 'sqlite-database' ? 'database' : name as SignatureAtom;
    });
    return members.length === 1 ? members[0] : { union: members };
}

/** Format facts supplied by the catalogue or analyzer; never infer them from operand names. */
export function formatTypeSignature(signature: TypeSignature): string {
    const variables = new Map<number, string>();
    let next = 0;
    const fresh = () => {
        const index = next++;
        return index < 26 ? String.fromCharCode(97 + index) : `t${index + 1}`;
    };
    const type = (value: SignatureType, operand = false): string => {
        if (typeof value === 'string') return value === 'unknown' ? fresh() : value;
        if ('label' in value) return `.${value.label}`;
        if ('variable' in value) {
            let name = variables.get(value.variable);
            if (!name) variables.set(value.variable, name = fresh());
            return name;
        }
        if ('union' in value) {
            const text = value.union.map(item => type(item)).join(' | ');
            return operand && value.union.length > 1 ? `(${text})` : text;
        }
        if ('collection' in value) return `${value.collection}<${type(value.element)}>`;
        if ('tuple' in value) return `tuple(${value.tuple.map(item => type(item)).join(', ')})`;
        return `(${body(value.callback)})`;
    };
    const body = (value: TypeSignature): string => {
        const inputs = value.inputs.map(input => type(input, true)).join(' ');
        const result = type(value.result);
        const ranks = value.ranks ? ` [rank ${value.ranks.join(' ')}]` : '';
        return `${inputs ? inputs + ' ' : ''}→ ${result}${ranks}`;
    };
    return body(signature);
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
        if ('variable' in pattern) return true;
        if ('union' in pattern) return pattern.union.some(part => matches(part, value));
        if ('collection' in pattern) return matches(pattern.collection, value)
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
            element: narrow(pattern.element, { types: value.elements }) };
        return pattern;
    };
    const candidates = arity.filter(signature => signature.inputs.every((pattern, index) => matches(pattern, cell(signature, index))));
    return candidates.length ? candidates.map(signature => ({ ...signature,
        inputs: signature.inputs.map((pattern, index) => narrow(pattern, cell(signature, index))) })) : arity;
}

/** Unknown metadata stays unknown; result roles and operand spelling are not type contracts. */
export function operationSignature(operation: Operation, inputs?: number | readonly ValueFacts[]): string | undefined {
    const signatures = typeof inputs === 'number'
        ? operation.signatures?.filter(signature => signature.inputs.length === inputs)
        : inputs ? matchingSignatures(operation.signatures ?? [], inputs) : operation.signatures;
    return signatures?.length ? [...new Set(signatures.map(formatTypeSignature))].join(' ; ') : undefined;
}
