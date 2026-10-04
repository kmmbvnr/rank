import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement,
    isBinaryExpression, isForStatement, isFunctionStatement,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isPushStatement,
    isStdinExpression, isTryStatement, isUnaryExpression, isUnpackStatement, isYieldStatement,
    type Expression, type FunctionStatement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { loopBinding } from './control-flow.js';
import type { ValueFacts } from './value-domain.js';

export const numericInput = (fact: ValueFacts): boolean => fact.types.length > 0
    && (fact.rank === 0 && fact.types.every(type => type === 'integer' || type === 'real')
        || fact.types.join() === 'array' && fact.rank !== undefined && fact.rank > 0
            && !!(fact.eagerScalarCells || fact.callbackFreeScalarCells)
            && !!fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real'));
export const widenedInput = (fact: ValueFacts): ValueFacts => ({ types: fact.types, rank: fact.rank,
    shape: Array(fact.rank!).fill(null), ...(fact.elements ? { elements: fact.elements } : {}),
    ...(fact.eagerScalarCells ? { eagerScalarCells: true as const } : {}),
    ...(fact.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}) });
export const sameNumericInput = (left: ValueFacts, right: ValueFacts): boolean => numericInput(right)
    && left.types.join() === right.types.join() && left.rank === right.rank
    && left.elements?.join() === right.elements?.join();

export function numericRecursionEligible(
    name: string, definition: FunctionStatement, bindings: ReadonlyMap<string, ValueFacts>,
): boolean {
    if (definition.$container.$type !== 'Program') return false;
    const nodes = [...AstUtils.streamAllContents(definition)];
    if (nodes.some(node => isFunctionStatement(node) || isTryStatement(node) || isYieldStatement(node)
        || isStdinExpression(node) || isArrayAssignmentStatement(node) || isPushStatement(node))) return false;
    const locals = new Set([...definition.parameters, ...nodes.filter(isAssignmentStatement).map(node => node.name),
        ...nodes.filter(isUnpackStatement).flatMap(node => node.names),
        ...nodes.filter(isForStatement).flatMap(node => loopBinding(node.condition)?.names ?? [])]);
    if (locals.has(name)) return false;
    const numericSyntax = (part: Expression): boolean => isNameExpression(part) || isNumberLiteral(part)
        || isParenthesizedExpression(part) && numericSyntax(part.value)
        || isUnaryExpression(part) && ['+', '-'].includes(part.operator) && numericSyntax(part.operand)
        || isBinaryExpression(part) && ['+', '-', '*', '/', '//', '%', '**'].includes(part.operator)
            && numericSyntax(part.left) && numericSyntax(part.right);
    return nodes.filter(isNameExpression).every(node => {
        if (node.name === name) {
            const parent = node.$container;
            if (!isApplicationExpression(parent)) return false;
            let call: AstNode = parent;
            while (isApplicationExpression(call.$container)) call = call.$container;
            if (!isApplicationExpression(call)) return false;
            const parts = flattenApplication(call);
            return parts.at(-1) === node && parts.length === definition.parameters.length + 1
                && parts.slice(0, -1).every(numericSyntax);
        }
        return locals.has(node.name) || ['len', 'min', 'max', 'odd'].includes(node.name)
            && !bindings.has(node.name);
    });
}

