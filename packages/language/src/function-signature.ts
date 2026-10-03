import type { FunctionStatement } from './generated/ast.js';
import { instantiateRelationship, type FunctionRelationship, type TypeRelationship } from './analysis/function-relationships.js';
import { UNKNOWN_VALUE, type ValueFacts } from './analysis/value-domain.js';
import { formatTypeSignature, type SignatureAtom, type SignatureType } from './type-signature.js';

export interface FunctionSignatureFacts {
    readonly arguments?: readonly ValueFacts[];
    readonly result?: ValueFacts;
    readonly relationship?: FunctionRelationship;
}

/** Render observed facts and proven relationships without running the function.
 * A shared letter means a proven relationship, not an operand-name convention. */
export function functionSignature(definition: FunctionStatement, facts: FunctionSignatureFacts = {}): string {
    let nextVariable = 0;
    const budget = { remaining: 1000 };
    const unknown = (): SignatureType => ({ variable: nextVariable++ });
    const describe = (value: ValueFacts): SignatureType => {
        if (!value.types.length) return unknown();
        const members = value.types.map((name): SignatureType => {
            if (name === 'tuple' && value.tupleItems) return { tuple: value.tupleItems.map(describe) };
            if (['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'multiset', 'heap'].includes(name)
                && value.elements?.length) return { collection: name as SignatureAtom,
                element: describe({ types: value.elements }) };
            return name as SignatureAtom;
        });
        return members.length === 1 ? members[0] : { union: members };
    };
    const arguments_ = definition.parameters.map((_, index) => facts.arguments?.[index] ?? UNKNOWN_VALUE);
    const inputs = arguments_.map(describe);
    const instantiate = (term: TypeRelationship, values: readonly ValueFacts[]) =>
        instantiateRelationship({ result: term, dependencies: [], expressions: new Map() }, values,
            undefined, budget) ?? UNKNOWN_VALUE;
    const resultType = (term: TypeRelationship, parameters: readonly SignatureType[], values: readonly ValueFacts[]): SignatureType => {
        if (budget.remaining-- <= 0) return unknown();
        switch (term.kind) {
            case 'parameter': return parameters[term.index] ?? unknown();
            case 'constant': return describe(term.value);
            case 'tuple': return { tuple: term.items.map(item => resultType(item, parameters, values)) };
            case 'call': {
                const inputs = term.arguments.map(item => resultType(item, parameters, values));
                const arguments_ = term.arguments.map(item => instantiate(item, values));
                return resultType(term.callee.result, inputs, arguments_);
            }
            case 'field': case 'binary': {
                const inferred = instantiate(term, values);
                return describe(!inferred.types.length && term === facts.relationship?.result && facts.result
                    ? facts.result : inferred);
            }
        }
    };
    const result = facts.relationship
        ? resultType(facts.relationship.result, inputs, arguments_)
        : describe(facts.result ?? UNKNOWN_VALUE);
    return formatTypeSignature({ inputs, result });
}
