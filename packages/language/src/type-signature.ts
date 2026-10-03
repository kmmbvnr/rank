import type { Operation } from './operations.js';

/** Public language types for display. Compiler eligibility is a separate contract. */
export type SignatureAtom =
    | 'unknown' | 'integer' | 'real' | 'number' | 'boolean' | 'text' | 'symbol' | 'missing'
    | 'date' | 'datetime' | 'duration' | 'bytes' | 'array' | 'sequence' | 'tuple' | 'record'
    | 'table' | 'column' | 'file' | 'database' | 'queue' | 'stack' | 'deque' | 'heap'
    | 'set' | 'counter' | 'multiset' | 'index' | 'graph' | 'dsu' | 'segment' | 'fenwick'
    | 'wavelet' | 'functional';

/** Only an explicit variable can assert that two positions share a type. */
export type SignatureType = SignatureAtom
    | { readonly variable: number }
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

/** Unknown metadata stays unknown; result roles and operand spelling are not type contracts. */
export function operationSignature(operation: Operation, arity?: number): string | undefined {
    const signatures = operation.signatures?.filter(signature => arity === undefined || signature.inputs.length === arity);
    return signatures?.length ? signatures.map(formatTypeSignature).join(' ; ') : undefined;
}
