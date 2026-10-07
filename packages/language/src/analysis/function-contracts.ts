import { operatorContract } from '../operator-signature.js';
import { instantiateTypeSignature, signatureType, type SignatureAtom, type SignatureType, type TypeSignature } from '../type-signature.js';
import type { FunctionRelationship, TypeRelationship } from './function-relationships.js';

export interface FunctionAlternative extends TypeSignature {
    /** Conditional shape/bounds relationship for one lifted input; never a known rank. */
    readonly frameParameter?: number;
}

export interface FunctionContract {
    /** Conditional alternatives, never facts about an actual value or execution safety. */
    readonly alternatives: readonly FunctionAlternative[];
    /** Untyped/empty collections and unsupported domains remain possible. */
    readonly unresolved: boolean;
    readonly exhausted: boolean;
}

const atoms: readonly SignatureAtom[] = ['integer', 'real', 'missing', 'column', 'text', 'boolean',
    'symbol', 'date', 'datetime', 'duration', 'record', 'tuple', 'bytes', 'object', 'function'];
const domains: readonly SignatureType[] = [...atoms,
    ...(['array', 'sequence'] as const).flatMap(collection =>
        (['integer', 'real', 'missing'] as const).map(element => ({ collection, element })))];
const collection = (type: SignatureType): type is Extract<SignatureType, { collection: SignatureAtom }> =>
    typeof type === 'object' && 'collection' in type;


/** Enumerate a small, fixed nominal domain, retaining whole input/result rows.
 * Each invocation owns its budget and state. An explicit remainder makes this a
 * partial contract, including empty/lazy cells that cannot establish a domain.
 * No requirements are promoted to ValueFacts or optimizer eligibility. */
export function inferFunctionContract(summary: FunctionRelationship, arity: number,
    limit = 10000): FunctionContract {
    let remaining = limit;
    let exhausted = false;
    const alternatives: FunctionAlternative[] = [];
    const frameBudget = { remaining: 1000 };
    // A scalar argument can construct a fresh collection (for example `to`).
    // Only pure arithmetic composition can inherit an input frame here.
    const preservesFrame = (term: TypeRelationship): boolean => {
        if (--frameBudget.remaining < 0) return false;
        switch (term.kind) {
            case 'parameter': return true;
            case 'constant': return term.value.rank === 0;
            case 'binary': return ['+', '-', '*', '/', '//', 'mod', '**'].includes(term.operation.name)
                && preservesFrame(term.left) && preservesFrame(term.right);
            case 'call': return preservesFrame(term.callee.result) && term.arguments.every(preservesFrame);
            default: return false;
        }
    };
    const inheritsFrame = preservesFrame(summary.result);
    const read = (term: TypeRelationship, inputs: readonly SignatureType[]): SignatureType | undefined => {
        if (--remaining < 0) { exhausted = true; return undefined; }
        switch (term.kind) {
            case 'parameter': return inputs[term.index];
            case 'constant': return signatureType(term.value);
            case 'field': return undefined;
            case 'tuple': {
                const items = term.items.map(item => read(item, inputs));
                return items.every(item => item !== undefined) ? { tuple: items } : undefined;
            }
            case 'call': {
                const arguments_ = term.arguments.map(item => read(item, inputs));
                return arguments_.every(item => item !== undefined) ? read(term.callee.result, arguments_) : undefined;
            }
            case 'binary': {
                const left = read(term.left, inputs), right = read(term.right, inputs);
                if (!left || !right) return undefined;
                const contract = operatorContract(term.operation.name);
                if (!contract) return undefined;
                // SQL dispatch is prior to missing propagation and collection lifting.
                const sql = contract.columns.map(row => instantiateTypeSignature(row, [left, right])).find(row => row !== undefined);
                if (sql) return sql.result;
                const a = collection(left) ? left.element : left;
                const b = collection(right) ? right.element : right;
                const row = contract.cells.map(row => instantiateTypeSignature(row, [a, b])).find(row => row !== undefined);
                if (!row) return undefined;
                if (!collection(left) && !collection(right)) return row.result;
                // Only numeric arithmetic lifting is represented here. Guards,
                // other collections and uncertain cells stay in the remainder.
                if (!['+', '-', '*', '/', '//', 'mod', '**'].includes(term.operation.name)
                    || ![a, b].every(type => type === 'integer' || type === 'real')) return undefined;
                if (collection(left) && collection(right) && left.collection !== right.collection) return undefined;
                const kind = collection(left) && left.collection === 'sequence'
                    || collection(right) && right.collection === 'sequence' ? 'sequence' : 'array';
                return { collection: kind, element: row.result };
            }
        }
    };
    const enumerate = (inputs: readonly SignatureType[]): void => {
        if (exhausted) return;
        if (--remaining < 0) { exhausted = true; return; }
        if (inputs.length === arity) {
            const result = read(summary.result, inputs);
            if (result) {
                const frames = inputs.flatMap((input, index) => collection(input) ? [index] : []);
                alternatives.push({ inputs, result,
                    ...(inheritsFrame && collection(result) && frames.length === 1 ? { frameParameter: frames[0] } : {}) });
            }
        } else for (const domain of domains) {
            enumerate([...inputs, domain]);
            if (exhausted) break;
        }
    };
    enumerate([]);
    return { alternatives, unresolved: true, exhausted };
}

/** A bounded summary; detailed alternatives retain all correlations above.
 * Numeric rows lead the display; the remainder is explicitly non-exhaustive. */
export function summarizeFunctionContract(contract: FunctionContract,
    format: (signature: TypeSignature) => string): string | undefined {
    if (!contract.alternatives.length) return undefined;
    const scalar = contract.alternatives.filter(row => row.inputs.every(input => typeof input === 'string'));
    const rows = scalar.slice(0, 2).map(format);
    if (!rows.length) return undefined;
    if (contract.alternatives.some(row => row.inputs.some(collection))) rows.push('numeric cells lift');
    if (contract.unresolved || scalar.length > 2) rows.push(contract.exhausted ? '… (inference limit)' : '… (other domains)');
    return rows.join(' ; ');
}
