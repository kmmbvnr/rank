import { operatorContract } from '../operator-signature.js';
import { intersectSignatureTypes } from '../signature-matching.js';
import { signatureType, type SignatureAtom, type SignatureType, type TypeSignature } from '../type-signature.js';
import type { FunctionAlternative, FunctionContract } from './function-contracts.js';
import type { FunctionRelationship, TypeRelationship } from './function-relationships.js';

type Variable = Extract<SignatureType, { variable: number }>;
type State = Map<number, SignatureType>;
interface Branch { readonly state: State; readonly value: SignatureType }
const variable = (type: SignatureType): type is Variable => typeof type === 'object' && 'variable' in type;
const domain = (type: Variable): SignatureType => type.domain ? { union: type.domain } : 'unknown';
const atomsOf = (type: SignatureType): readonly SignatureAtom[] | undefined => typeof type === 'string'
    ? type === 'unknown' ? undefined : type === 'number' ? ['integer', 'real'] : [type]
    : 'union' in type ? type.union.flatMap(part => atomsOf(part) ?? []) : undefined;

/** Finite scalar aliases only. This cannot infer shapes, callbacks or execution safety. */
function resolve(type: SignatureType, state: State): SignatureType {
    if (variable(type)) {
        const bound = state.get(type.variable);
        return bound && !(variable(bound) && bound.variable === type.variable) ? resolve(bound, state) : bound ?? type;
    }
    if (typeof type === 'object' && 'tuple' in type) return { tuple: type.tuple.map(part => resolve(part, state)) };
    if (typeof type === 'object' && 'collection' in type) return { ...type, element: resolve(type.element, state) };
    return type;
}

function unify(left: SignatureType, right: SignatureType, state: State): boolean {
    left = resolve(left, state); right = resolve(right, state);
    if (left === 'unknown' || right === 'unknown') return true;
    if (variable(left) || variable(right)) {
        const a = variable(left) ? left : undefined, b = variable(right) ? right : undefined;
        const intersection = intersectSignatureTypes(a ? domain(a) : left, b ? domain(b) : right);
        if (!intersection) return false;
        const accepted = atomsOf(intersection);
        if (!accepted?.length) return false;
        if (a && b) {
            const keep = Math.min(a.variable, b.variable), alias = Math.max(a.variable, b.variable);
            if (alias !== keep) state.set(alias, { variable: keep });
            // The lowest ID carries the finite bound; the other ID points to it.
            state.set(keep, accepted.length === 1 ? accepted[0] : { variable: keep, domain: accepted });
            return true;
        }
        const id = (a ?? b)!.variable;
        state.set(id, accepted.length === 1 ? accepted[0] : { variable: id, domain: accepted });
        return true;
    }
    return intersectSignatureTypes(left, right) !== undefined;
}

/** Compose supported scalar overloads, instead of a Cartesian product of parameter domains. */
export function inferSymbolicFunctionContract(summary: FunctionRelationship, arity: number,
    scalarAtoms: readonly SignatureAtom[], limit: number, inheritsFrame: boolean): FunctionContract | undefined {
    let scanBudget = 1000;
    const supported = (term: TypeRelationship, parameters = arity): boolean => {
        if (--scanBudget < 0) return false;
        switch (term.kind) {
            case 'parameter': return term.index >= 0 && term.index < parameters;
            case 'constant': return term.value.types.length === 1 && scalarAtoms.includes(term.value.types[0] as SignatureAtom);
            case 'tuple': return term.items.every(item => supported(item, parameters));
            case 'call': return supported(term.callee.result, term.arguments.length) && term.arguments.every(item => supported(item, parameters));
            case 'binary': return ['+', '-', '*', '/', '//', 'mod', '**', 'less', 'greater',
                'atleast', 'atmost', 'and', 'or', 'xor'].includes(term.operation.name)
                && supported(term.left, parameters) && supported(term.right, parameters);
            default: return false;
        }
    };
    if (!supported(summary.result)) return undefined;
    let remaining = limit, exhausted = false, nextVariable = arity;
    const consume = (): boolean => {
        if (--remaining >= 0) return true;
        exhausted = true; return false;
    };
    const inputs: SignatureType[] = Array.from({ length: arity }, (_, variable) => ({ variable, domain: scalarAtoms }));
    const nonColumns = scalarAtoms.filter(atom => atom !== 'column');
    const rowInstance = (row: TypeSignature): TypeSignature => {
        const names = new Map<number, number>();
        const fresh = (type: SignatureType): SignatureType => {
            if (!variable(type)) return type;
            let id = names.get(type.variable);
            if (id === undefined) names.set(type.variable, id = nextVariable++);
            return { ...type, variable: id };
        };
        return { inputs: row.inputs.map(fresh), result: fresh(row.result) };
    };
    const evaluate = (term: TypeRelationship, state: State, parameters: readonly SignatureType[]): Branch[] => {
        if (!consume()) return [];
        switch (term.kind) {
            case 'parameter': return [{ state, value: parameters[term.index] }];
            case 'constant': return [{ state, value: signatureType(term.value) }];
            case 'call': {
                let branches: { state: State; values: SignatureType[] }[] = [{ state, values: [] }];
                for (const argument of term.arguments) branches = branches.flatMap(branch =>
                    evaluate(argument, branch.state, parameters).map(next => ({ state: next.state, values: [...branch.values, next.value] })));
                return branches.flatMap(branch => evaluate(term.callee.result, branch.state, branch.values));
            }
            case 'tuple': {
                let branches: { state: State; values: SignatureType[] }[] = [{ state, values: [] }];
                for (const item of term.items) branches = branches.flatMap(branch =>
                    evaluate(item, branch.state, parameters).map(next => ({ state: next.state, values: [...branch.values, next.value] })));
                return branches.map(branch => ({ state: branch.state, value: { tuple: branch.values } }));
            }
            case 'binary': {
                const contract = operatorContract(term.operation.name)!;
                return evaluate(term.left, state, parameters).flatMap(left =>
                    evaluate(term.right, left.state, parameters).flatMap(right => {
                        const results: Branch[] = [];
                        for (const [sql, rows] of [[false, contract.cells], [true, contract.columns]] as const) {
                            for (const row of rows) {
                                if (row.inputs.length !== 2 || !consume()) continue;
                                const candidate = new Map(right.state);
                                const instance = rowInstance(row);
                                // SQL dispatch is prior to cells, including missing propagation.
                                if (!sql && (!unify(left.value, { variable: nextVariable++, domain: nonColumns }, candidate)
                                    || !unify(right.value, { variable: nextVariable++, domain: nonColumns }, candidate))) continue;
                                if (unify(instance.inputs[0], left.value, candidate)
                                    && unify(instance.inputs[1], right.value, candidate)) results.push({ state: candidate, value: instance.result });
                            }
                        }
                        return results;
                    }));
            }
            default: return [];
        }
    };
    const publicType = (type: SignatureType, state: State): SignatureType => {
        const resolved = resolve(type, state);
        if (variable(resolved) && resolved.domain?.length === scalarAtoms.length
            && scalarAtoms.every(atom => resolved.domain!.includes(atom))) return { variable: resolved.variable };
        if (typeof resolved === 'object' && 'tuple' in resolved)
            return { tuple: resolved.tuple.map(part => publicType(part, state)) };
        return resolved;
    };
    const alternatives: FunctionAlternative[] = evaluate(summary.result, new Map(), inputs).map(branch => ({
        inputs: inputs.map(type => publicType(type, branch.state)), result: publicType(branch.value, branch.state),
    }));
    // Retain the established one-frame numeric lifting contract. Multiple frames remain conditional.
    if (inheritsFrame) for (const row of [...alternatives]) {
        const numeric = (type: SignatureType): boolean => variable(type)
            ? !!type.domain?.length && type.domain.every(atom => atom === 'integer' || atom === 'real')
            : type === 'integer' || type === 'real';
        if (!numeric(row.result) || !row.inputs.every(type => numeric(type) || variable(type) && !type.domain)) continue;
        row.inputs.forEach((input, index) => {
            if (!numeric(input)) return;
            for (const collection of ['array', 'sequence'] as const) alternatives.push({
                inputs: row.inputs.map((type, at) => at === index ? { collection, element: type } : type),
                result: { collection, element: row.result }, frameParameter: index,
            });
        });
    }
    return { alternatives: [...new Map(alternatives.map(row => [JSON.stringify(row), row])).values()],
        unresolved: true, exhausted, symbolic: true };
}
