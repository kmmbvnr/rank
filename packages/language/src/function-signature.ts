import { inferFunctionContract, summarizeFunctionContract } from './analysis/function-contracts.js';
import { inferGeneratorContract } from './analysis/generator-contracts.js';
import { functionYields } from './analysis/function-yields.js';
import type { FunctionStatement } from './generated/ast.js';
import { instantiateRelationship, type FunctionRelationship, type TypeRelationship } from './analysis/function-relationships.js';
import { UNKNOWN_VALUE, type ValueFacts } from './analysis/value-domain.js';
import { formatTypeSignature, signatureType, type SignatureType } from './type-signature.js';

const formatFunctionType = (signature: Parameters<typeof formatTypeSignature>[0]) =>
    formatTypeSignature(signature, { shortNumericNames: true });

export interface FunctionSignatureFacts {
    readonly arguments?: readonly ValueFacts[];
    readonly result?: ValueFacts;
    readonly relationship?: FunctionRelationship;
}

/** Render observed facts and proven relationships without running the function.
 * A shared letter means a proven relationship, not an operand-name convention. */
export function functionSignature(definition: FunctionStatement, facts: FunctionSignatureFacts = {}): string {
    const generator = !definition.ranks.length && functionYields(definition).length > 0;
    if (!facts.arguments && generator) {
        const contract = inferGeneratorContract(definition);
        const inferred = summarizeFunctionContract(contract, formatFunctionType);
        if (inferred) return inferred;
    }
    if (facts.relationship && !facts.arguments && hasBinary(facts.relationship.result)) {
        const contract = inferFunctionContract(facts.relationship, definition.parameters.length);
        const inferred = summarizeFunctionContract(contract, formatFunctionType);
        if (inferred) return inferred;
    }
    let nextVariable = 0;
    const budget = { remaining: 1000 };
    const unknown = (): SignatureType => ({ variable: nextVariable++ });
    const describe = (value: ValueFacts): SignatureType => signatureType(value);
    const arguments_ = definition.parameters.map((_, index) => facts.arguments?.[index] ?? UNKNOWN_VALUE);
    const inputs = arguments_.map(value => !value.types.length && !facts.arguments ? unknown() : describe(value));
    const instantiate = (term: TypeRelationship, values: readonly ValueFacts[]) =>
        instantiateRelationship({ result: term, dependencies: [], expressions: new Map() }, values,
            undefined, budget) ?? UNKNOWN_VALUE;
    const resultType = (term: TypeRelationship, parameters: readonly SignatureType[], values: readonly ValueFacts[]): SignatureType => {
        if (budget.remaining-- <= 0) return 'unknown';
        switch (term.kind) {
            case 'parameter': return parameters[term.index] ?? 'unknown';
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
        : describe(facts.result ?? (generator ? { types: ['sequence'] } : UNKNOWN_VALUE));
    return formatFunctionType({ inputs, result });
}

function hasBinary(term: TypeRelationship, budget = { remaining: 1000 }): boolean {
    if (--budget.remaining < 0) return false;
    switch (term.kind) {
        case 'binary': return true;
        case 'call': return hasBinary(term.callee.result, budget) || term.arguments.some(item => hasBinary(item, budget));
        case 'tuple': return term.items.some(item => hasBinary(item, budget));
        default: return false;
    }
}
