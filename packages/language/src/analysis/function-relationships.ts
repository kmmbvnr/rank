import { binaryOperandFacts } from './binary-facts.js';
import { findCompiledOperator, type CompiledOperator } from '../compiled-operators.js';
import { parameterFacts } from './control-flow.js';
import {
    isApplicationExpression, isBinaryExpression, isBooleanLiteral, isLabelLiteral, isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isReturnStatement, isStringLiteral, isTupleExpression,
    type Expression, type FunctionStatement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { expressionFacts } from './value-facts.js';
import { BOTTOM_VALUE, UNKNOWN_VALUE, incompatibleShapes, type ValueFacts } from './value-domain.js';

/** A proven result relationship, separate from requirements on unknown inputs. */
export type TypeRelationship =
    | { readonly kind: 'parameter'; readonly index: number }
    | { readonly kind: 'constant'; readonly value: ValueFacts }
    | { readonly kind: 'tuple'; readonly items: readonly TypeRelationship[] }
    | { readonly kind: 'field'; readonly source: TypeRelationship; readonly name: string }
    | { readonly kind: 'binary'; readonly operation: CompiledOperator; readonly left: TypeRelationship; readonly right: TypeRelationship }
    | { readonly kind: 'call'; readonly callee: FunctionRelationship; readonly arguments: readonly TypeRelationship[] };

export interface RelationshipDependency {
    readonly name: string;
    readonly definition: FunctionStatement;
    readonly binding: ValueFacts;
}
export interface ResolvedRelationship extends RelationshipDependency {
    readonly relationship: FunctionRelationship;
}
export interface FunctionRelationship {
    readonly dependencies: readonly RelationshipDependency[];
    readonly result: TypeRelationship;
    /** Source expressions retain their own facts for inspection at each instantiation. */
    readonly expressions: ReadonlyMap<Expression, TypeRelationship>;
}

/** Structural returns may compose through proved callees. Every callable dependency
 * remains explicit; the caller validates its binding before using the summary. */
export function functionRelationship(definition: FunctionStatement,
    resolve?: (name: string) => ResolvedRelationship | undefined): FunctionRelationship | undefined {
    if (definition.ranks.length || definition.statements.length !== 1) return undefined;
    const statement = definition.statements[0];
    if (!isReturnStatement(statement) || !statement.value) return undefined;
    const expressions = new Map<Expression, TypeRelationship>();
    const dependencies = new Map<string, RelationshipDependency>();
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
        } else if (isBinaryExpression(node) && !node.step) {
            const operation = findCompiledOperator(node.operator);
            const left = visit(node.left), right = visit(node.right);
            if (operation && left && right) term = { kind: 'binary', operation, left, right };
        } else if (isApplicationExpression(node)) {
            const parts = flattenApplication(node);
            if (parts.length === 2 && isLabelLiteral(parts[1])) {
                const source = visit(parts[0]);
                visit(parts[1]);
                if (source) term = { kind: 'field', source, name: parts[1].name };
            } else {
                const last = parts.at(-1);
                const target = last && isNameExpression(last) && !definition.parameters.includes(last.name)
                    ? resolve?.(last.name) : undefined;
                if (target && target.definition.parameters.length === parts.length - 1) {
                    const arguments_ = parts.slice(0, -1).map(visit);
                    if (arguments_.every(argument => argument !== undefined)) {
                        for (const dependency of [target, ...target.relationship.dependencies]) {
                            const previous = dependencies.get(dependency.name);
                            if (previous && (previous.binding !== dependency.binding || previous.definition !== dependency.definition)) return undefined;
                            dependencies.set(dependency.name, { name: dependency.name,
                                definition: dependency.definition, binding: dependency.binding });
                        }
                        expressions.set(last!, { kind: 'constant', value: target.binding });
                        term = { kind: 'call', callee: target.relationship, arguments: arguments_ };
                    }
                }
            }
        }
        if (term) expressions.set(node, term);
        return term;
    };
    const result = visit(statement.value);
    return result && { result, expressions, dependencies: [...dependencies.values()] };
}

/** Instantiate from supplied facts, never from a solved input requirement.
 * Undefined asks the caller to use ordinary analysis for an unsupported domain. */
export function instantiateRelationship(summary: FunctionRelationship, arguments_: readonly ValueFacts[],
    expressions?: Map<Expression, ValueFacts>, budget = { remaining: 1000 }): ValueFacts | undefined {
    const values = new Map<TypeRelationship, ValueFacts | undefined>();
    const read = (term: TypeRelationship): ValueFacts | undefined => {
        if (values.has(term)) return values.get(term);
        if (budget.remaining-- <= 0) return undefined;
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
            case 'binary': {
                const left = read(term.left), right = read(term.right);
                if (left?.bottom || right?.bottom) value = BOTTOM_VALUE;
                else if (left && right && supportedOperands(term.operation, left, right)) {
                    value = binaryOperandFacts(term.operation.name, left, right);
                }
                break;
            }
            case 'call': {
                const inputs = term.arguments.map(read);
                if (inputs.some(input => input?.bottom)) value = BOTTOM_VALUE;
                else if (inputs.every(input => input !== undefined)) {
                    value = instantiateRelationship(term.callee, inputs.map(parameterFacts), expressions, budget);
                }
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


/** Use the shared operator signatures to select supported scalar or lifted domains.
 * A declined domain retains ordinary analysis, including its diagnostics/effects. */
function supportedOperands(operation: CompiledOperator, left: ValueFacts, right: ValueFacts): boolean {
    if (incompatibleShapes(left, right)) return false;
    // A scalar boolean on the left makes and/or guards, not lifted masks.
    if ((operation.binary === '&&' || operation.binary === '||')
        && left.types.join() === 'boolean' && right.types.join() !== 'boolean') return false;
    const cells = (value: ValueFacts): readonly string[] | undefined => {
        if (value.rank === 0 || value.types.join() === 'text') return value.types;
        if (['array', 'sequence'].includes(value.types.join())
            && (value.eagerScalarCells || value.callbackFreeScalarCells)) return value.elements;
        return undefined;
    };
    const a = cells(left), b = cells(right);
    const signatures = [...operation.scalarFunction, ...operation.tensor ?? []];
    return !!a?.length && !!b?.length && a.every(first => b.every(second => signatures.some(signature =>
        signature.inputs.length === 2 && signature.inputs[0] === first && signature.inputs[1] === second)));
}
