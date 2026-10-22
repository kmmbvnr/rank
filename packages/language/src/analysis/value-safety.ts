import {
    isApplicationExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral, isLabelLiteral,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isRecordExpression, isStringLiteral,
    isUnaryExpression,
    type Expression,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { findOperation } from '../operations.js';
import { expressionFacts } from './value-facts.js';
import { binaryOperandFacts } from './binary-facts.js';
import { binaryType } from './types.js';
import { isAtom, joinValueFacts, type FactLookup, type ValueFacts } from './value-domain.js';

// Proofs used before retaining value facts across reads, writes and iterations.
// An unproved expression stays unknown; these checks never execute Rank code.
export const directValue = (node: Expression): boolean => isNameExpression(node) || isNumberLiteral(node)
    || isStringLiteral(node) || isBooleanLiteral(node) || isLabelLiteral(node)
    || isParenthesizedExpression(node) && directValue(node.value);
export const safeCollectionValue = (node: Expression, env: ReadonlyMap<string, ValueFacts>): boolean =>
    isParenthesizedExpression(node) ? safeCollectionValue(node.value, env) : directValue(node)
        // A record literal runs only its field expressions.
        || isRecordExpression(node) && node.fields.every(field =>
            safeCollectionValue(field.value, env) || scalarArithmetic(field.value, env))
        || isArrayExpression(node)
        && node.dimensions.every(item => directValue(item.value))
        && (!node.fill || directValue(node.fill))
        && (!node.range || isBinaryExpression(node.range) && directValue(node.range.left) && directValue(node.range.right) && (!node.range.step || directValue(node.range.step)))
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
/** A callback-free scalar result cannot retain the arrays read to compute it.
 * Callable identities and unproved collection readers remain outside this proof.
 */
export function scalarReadEffects(node: Expression, lookup: FactLookup): {
    readonly value: ValueFacts;
    readonly arrays: ReadonlySet<string>;
    readonly values: ReadonlySet<string>;
} | undefined {
    const arrays = new Set<string>();
    const values = new Set<string>();
    const scalar = (value: ValueFacts | undefined): value is ValueFacts => !!value?.types.length
        && value.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
    const visit = (item: Expression): ValueFacts | undefined => {
        if (isParenthesizedExpression(item)) return visit(item.value);
        if (isNameExpression(item)) {
            const value = lookup(item.name);
            if (!scalar(value)) return undefined;
            values.add(item.name);
            return value;
        }
        if (isNumberLiteral(item) || isBooleanLiteral(item) || isStringLiteral(item) || isLabelLiteral(item)) {
            const value = expressionFacts(item, lookup);
            return scalar(value) ? value : undefined;
        }
        if (isUnaryExpression(item)) {
            if (!visit(item.operand)) return undefined;
        } else if (isBinaryExpression(item)) {
            const left = visit(item.left), right = visit(item.right);
            if (item.step || !left || !right) return undefined;
            // A scalar union may include domains where the operator throws.
            // Reuse forward type transfer for every successful domain; a
            // collection or tuple result disqualifies the whole expression.
            const values: ValueFacts[] = [];
            for (const a of left.types) for (const b of right.types) {
                const narrow = (value: ValueFacts, type: typeof a): ValueFacts => ({ ...value, types: [type],
                    rank: type === 'text' ? 1 : 0, shape: type === 'text' ? [null] : [] });
                const first = narrow(left, a), second = narrow(right, b);
                const value = binaryOperandFacts(item.operator, first, second)
                    ?? { types: binaryType(item.operator, first.types, second.types) };
                if (!value.types.length) continue;
                if (!scalar(value)) return undefined;
                values.push(value);
            }
            return values.length ? joinValueFacts(values) : undefined;
        } else if (isApplicationExpression(item)) {
            const parts = flattenApplication(item);
            let source = parts[0];
            while (isParenthesizedExpression(source)) source = source.value;
            if (!isNameExpression(source)) return undefined;
            const value = lookup(source.name);
            if (value?.types.join() !== 'array' || !(value.eagerScalarCells || value.callbackFreeScalarCells)
                || !value.shape || parts.length - 1 !== value.shape.length) return undefined;
            for (const selector of parts.slice(1)) {
                const fact = visit(selector);
                if (fact?.rank !== 0 || fact.types.join() !== 'integer') return undefined;
            }
            arrays.add(source.name);
        } else return undefined;
        const value = expressionFacts(item, lookup);
        return scalar(value) ? value : undefined;
    };
    const value = visit(node);
    return value ? { value, arrays, values } : undefined;
}

export const scalarArithmetic = (node: Expression, env: ReadonlyMap<string, ValueFacts>): boolean => {
    const proof = scalarReadEffects(node, name => env.get(name));
    return !!proof && !proof.arrays.size && proof.value.rank === 0
        && proof.value.types.every(type => type === 'integer' || type === 'real');
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
export const safeRead = (fact: ValueFacts | undefined): boolean => fact?.completion === 'ready'
    && fact.types.length > 0 && fact.types.every(type => ['array', 'bytes', 'tuple', 'record', 'object'].includes(type))
    || fact?.eagerScalarCells === true
    || fact?.callbackFreeScalarCells === true || fact?.types.join() === 'text'
    || fact?.types.join() === 'index';
export function safeIndexedIteration(collection: ValueFacts): boolean {
    const kind = collection.types.join();
    return kind === 'text' || kind === 'queue'
        || collection.rank !== undefined && collection.rank > 0 && ['array', 'sequence'].includes(kind)
            && safeRead(collection)
        // A materialized array of records with a proved schema holds no lazy cells.
        || kind === 'array' && collection.rank === 1 && collection.elements?.join() === 'record'
            && collection.elementRecord !== undefined;
}

export function safeIndexedSource(source: Expression): boolean {
    if (directValue(source)) return true;
    if (isBinaryExpression(source) && ['to', 'till'].includes(source.operator)) {
        return directValue(source.left) && directValue(source.right)
            && (!source.step || directValue(source.step));
    }
    if (!isApplicationExpression(source)) return false;
    const parts = flattenApplication(source);
    return parts.length === 3 && isNameExpression(parts[1]) && findOperation(parts[1].name) === findOperation('window')
        && directValue(parts[0]) && directValue(parts[2]);
}

export function safeEmptyArrayIteration(source: Expression | undefined, collection: ValueFacts): boolean {
    return !!source && collection.types.join() === 'array' && collection.rank !== undefined
        && collection.rank > 0 && collection.shape?.[0] === 0 && safeIndexedSource(source);
}
