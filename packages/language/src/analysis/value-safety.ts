import {
    isApplicationExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral, isLabelLiteral,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isStringLiteral, isUnaryExpression,
    type Expression,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { findOperation } from '../operations.js';
import { expressionFacts, isAtom, type ValueFacts } from './value-facts.js';

// Proofs used before retaining value facts across reads, writes and iterations.
// An unproved expression stays unknown; these checks never execute Rank code.
export const directValue = (node: Expression): boolean => isNameExpression(node) || isNumberLiteral(node)
    || isStringLiteral(node) || isBooleanLiteral(node) || isLabelLiteral(node)
    || isParenthesizedExpression(node) && directValue(node.value);
export const safeCollectionValue = (node: Expression, env: ReadonlyMap<string, ValueFacts>): boolean =>
    directValue(node) || isArrayExpression(node)
        && node.dimensions.every(item => directValue(item.value))
        && (!node.fill || directValue(node.fill))
        && [...node.items, ...node.rows.flatMap(row => row.items)].every(item => directValue(item.value))
        && expressionFacts(node, name => env.get(name)).eagerScalarCells === true;
export const safeIndexDefault = (node: Expression, env: ReadonlyMap<string, ValueFacts>): boolean => {
    if (!isBinaryExpression(node) || node.operator !== 'default' || !isApplicationExpression(node.left)
        || !directValue(node.right)) return false;
    const parts = flattenApplication(node.left);
    const source = parts[0];
    if (!isNameExpression(source) || env.get(source.name)?.types.join() !== 'index'
        || parts.length < 2 || !parts.slice(1).every(part => {
            const key = expressionFacts(part, name => env.get(name));
            return directValue(part) && key.types.length > 0
                && key.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
        })) return false;
    const value = expressionFacts(node, name => env.get(name));
    return isAtom(value) && value.types.length > 0
        && value.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type));
};
export const scalarArithmetic = (node: Expression, env: ReadonlyMap<string, ValueFacts>): boolean => {
    if (isParenthesizedExpression(node)) return scalarArithmetic(node.value, env);
    if (isNumberLiteral(node)) return true;
    if (isNameExpression(node)) {
        const fact = env.get(node.name);
        return fact?.rank === 0 && fact.types.length > 0
            && fact.types.every(type => type === 'integer' || type === 'real');
    }
    if (isUnaryExpression(node) && ['+', '-'].includes(node.operator))
        return scalarArithmetic(node.operand, env);
    return isBinaryExpression(node) && ['+', '-', '*', '/', '//', '%', '**'].includes(node.operator)
        && scalarArithmetic(node.left, env) && scalarArithmetic(node.right, env);
};
export const scalarBitwise = (node: Expression, env: ReadonlyMap<string, ValueFacts>): boolean => {
    if (isParenthesizedExpression(node)) return scalarBitwise(node.value, env);
    if (!isApplicationExpression(node)) return false;
    const parts = flattenApplication(node);
    const target = parts.at(-1);
    const operation = target && isNameExpression(target) && !env.has(target.name)
        ? findOperation(target.name) : undefined;
    return operation?.scalarNoCallback === 'integer' && operation.arities.includes(parts.length - 1)
        && parts.slice(0, -1).every(part => directValue(part)
            && expressionFacts(part, name => env.get(name)).types.join() === 'integer');
};
export const safeRead = (fact: ValueFacts | undefined): boolean => fact?.eagerScalarCells === true
    || fact?.callbackFreeScalarCells === true || fact?.types.join() === 'text'
    || fact?.types.join() === 'index';
export function safeIndexedIteration(collection: ValueFacts): boolean {
    const kind = collection.types.join();
    return kind === 'text' || kind === 'queue'
        || collection.rank !== undefined && collection.rank > 0 && ['array', 'sequence'].includes(kind)
            && (collection.eagerScalarCells === true || collection.callbackFreeScalarCells === true);
}

export function safeIndexedSource(source: Expression): boolean {
    if (directValue(source)) return true;
    if (isBinaryExpression(source) && ['to', 'until'].includes(source.operator)) {
        return directValue(source.left) && directValue(source.right)
            && (!source.step || directValue(source.step));
    }
    if (!isApplicationExpression(source)) return false;
    const parts = flattenApplication(source);
    return parts.length === 3 && isNameExpression(parts[2]) && parts[2].name === 'window'
        && directValue(parts[0]) && directValue(parts[1]);
}

export function safeEmptyArrayIteration(source: Expression | undefined, collection: ValueFacts): boolean {
    return !!source && collection.types.join() === 'array' && collection.rank !== undefined
        && collection.rank > 0 && collection.shape?.[0] === 0 && safeIndexedSource(source);
}
