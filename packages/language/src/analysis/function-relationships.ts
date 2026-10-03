import {
    isApplicationExpression, isBooleanLiteral, isLabelLiteral, isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isReturnStatement, isStringLiteral, isTupleExpression,
    type Expression, type FunctionStatement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { expressionFacts } from './value-facts.js';
import { BOTTOM_VALUE, UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';

/** A proven result relationship, separate from requirements on unknown inputs. */
export type TypeRelationship =
    | { readonly kind: 'parameter'; readonly index: number }
    | { readonly kind: 'constant'; readonly value: ValueFacts }
    | { readonly kind: 'tuple'; readonly items: readonly TypeRelationship[] }
    | { readonly kind: 'field'; readonly source: TypeRelationship; readonly name: string };

export interface FunctionRelationship {
    readonly result: TypeRelationship;
    /** Source expressions retain their own facts for inspection at each instantiation. */
    readonly expressions: ReadonlyMap<Expression, TypeRelationship>;
}

/** Parameter-only structural returns have no captured bindings or callable dependencies.
 * The caller owns the cache, so reparsing/editing starts a fresh analysis. */
export function functionRelationship(definition: FunctionStatement): FunctionRelationship | undefined {
    if (definition.ranks.length || definition.statements.length !== 1) return undefined;
    const statement = definition.statements[0];
    if (!isReturnStatement(statement) || !statement.value) return undefined;
    const expressions = new Map<Expression, TypeRelationship>();
    const visit = (node: Expression): TypeRelationship | undefined => {
        let term: TypeRelationship | undefined;
        if (isParenthesizedExpression(node)) term = visit(node.value);
        else if (isNameExpression(node)) {
            const index = definition.parameters.indexOf(node.name);
            if (index >= 0) term = { kind: 'parameter', index };
        } else if (isNumberLiteral(node) || isStringLiteral(node) || isBooleanLiteral(node) || isLabelLiteral(node)) {
            term = { kind: 'constant', value: expressionFacts(node, () => undefined) };
        } else if (isTupleExpression(node)) {
            const items = node.items.map(item => visit(item.value));
            if (items.every(item => item !== undefined)) term = { kind: 'tuple', items };
        } else if (isApplicationExpression(node)) {
            const parts = flattenApplication(node);
            if (parts.length === 2 && isLabelLiteral(parts[1])) {
                const source = visit(parts[0]);
                visit(parts[1]);
                if (source) term = { kind: 'field', source, name: parts[1].name };
            }
        }
        if (term) expressions.set(node, term);
        return term;
    };
    const result = visit(statement.value);
    return result && { result, expressions };
}

/** Instantiate from supplied facts, never from a solved input requirement.
 * Undefined asks the caller to use ordinary analysis for an unsupported domain. */
export function instantiateRelationship(summary: FunctionRelationship, arguments_: readonly ValueFacts[],
    expressions?: Map<Expression, ValueFacts>): ValueFacts | undefined {
    const values = new Map<TypeRelationship, ValueFacts | undefined>();
    const read = (term: TypeRelationship): ValueFacts | undefined => {
        if (values.has(term)) return values.get(term);
        let value: ValueFacts | undefined;
        switch (term.kind) {
            case 'parameter': value = arguments_[term.index] ?? UNKNOWN_VALUE; break;
            case 'constant': value = term.value; break;
            case 'tuple': {
                const items = term.items.map(read);
                if (items.some(item => item?.bottom)) value = BOTTOM_VALUE;
                else if (items.every(item => item !== undefined)) value = { types: ['tuple'], rank: 0, shape: [], tupleItems: items };
                break;
            }
            case 'field': {
                const source = read(term.source);
                if (source?.bottom) value = BOTTOM_VALUE;
                else if (source?.types.join() === 'record') value = source.fields?.[term.name] ?? UNKNOWN_VALUE;
                else if (source && !source.types.length) value = UNKNOWN_VALUE;
                break;
            }
        }
        values.set(term, value);
        return value;
    };
    const result = read(summary.result);
    if (result && expressions) for (const [node, term] of summary.expressions) {
        const value = read(term);
        if (value) expressions.set(node, value);
    }
    return result;
}
