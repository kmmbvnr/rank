import {
    isApplicationExpression, isAllAxisExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral, isMaterializeExpression,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isStringLiteral, isUnaryExpression,
    type Expression,
} from '../generated/ast.js';
import { typeOf, type Types } from './types.js';
import { flattenApplication } from '../expressions.js';

/** Serializable facts only: inspecting these never evaluates user code. */
export interface ValueFacts {
    readonly types: Types;
    readonly acceptedTypes?: Types;
    readonly elements?: Types;
    readonly rank?: number;
    readonly shape?: readonly (number | null)[];
    readonly integer?: string;
    readonly integers?: readonly (number | null)[];
}

export const UNKNOWN_VALUE: ValueFacts = { types: [] };
export type FactLookup = ((name: string) => ValueFacts | undefined) & {
    call?: (name: string, arguments_: readonly ValueFacts[]) => ValueFacts;
};

/** Start with facts that follow directly from syntax, retaining unknown lengths. */
export function expressionFacts(expression: Expression, lookup: FactLookup): ValueFacts {
    if (isParenthesizedExpression(expression)) return expressionFacts(expression.value, lookup);
    if (isNameExpression(expression)) return lookup(expression.name) ?? UNKNOWN_VALUE;
    if (isNumberLiteral(expression)) return {
        types: [typeof expression.value === 'bigint' ? 'integer' : 'real'], rank: 0, shape: [],
        ...(typeof expression.value === 'bigint' ? { integer: String(expression.value) } : {}),
    };
    // Runtime rank is one for text, although arithmetic treats the whole text as an atom.
    if (isStringLiteral(expression)) return { types: ['text'], rank: 1, shape: [[...expression.value].length] };
    if (isBooleanLiteral(expression)) return { types: ['boolean'], rank: 0, shape: [] };
    if (isUnaryExpression(expression) && ['+', '-'].includes(expression.operator)) {
        const operand = expressionFacts(expression.operand, lookup);
        if (operand.integer !== undefined) return { ...operand,
            integer: String(BigInt(operand.integer) * (expression.operator === '-' ? -1n : 1n)) };
    }
    if (isArrayExpression(expression)) {
        if (expression.dimensions.length) {
            const shape = expression.dimensions.map(item => {
                const fact = expressionFacts(item.value, lookup);
                if (fact.integer === undefined || item.sign === '-') return null;
                const size = Number(fact.integer);
                return Number.isSafeInteger(size) && size >= 0 ? size : null;
            });
            const fill = expression.fill && expressionFacts(expression.fill, lookup);
            return { types: ['array'], rank: shape.length, shape,
                ...(fill && isAtom(fill) ? { elements: fill.types } : {}) };
        }
        // Nested array literals and row assembly need the runtime's cell rules.
        const items = expression.items.map(item => expressionFacts(item.value, lookup));
        if (!expression.rows.length && items.every(isAtom)) {
            return { types: ['array'], rank: 1, shape: [items.length],
                elements: [...new Set(items.flatMap(item => item.types))],
                ...(items.every(item => item.integer !== undefined) ? {
                    integers: items.map((item, index) => {
                        const n = Number(item.integer) * (expression.items[index].sign === '-' ? -1 : 1);
                        return Number.isSafeInteger(n) ? n : null;
                    }),
                } : {}) };
        }
        return { types: ['array'] };
    }
    if (isMaterializeExpression(expression)) {
        const source = expressionFacts(expression.source, lookup);
        return source.types.length === 1 && source.types[0] === 'sequence'
            ? { ...source, types: ['array'] } : { types: ['array'] };
    }
    if (isBinaryExpression(expression)) {
        const left = expressionFacts(expression.left, lookup);
        const right = expressionFacts(expression.right, lookup);
        if (expression.operator === 'to' || expression.operator === 'until') {
            let length: number | null = null;
            const stepText = expression.step ? expressionFacts(expression.step, lookup).integer : '1';
            if (left.integer !== undefined && right.integer !== undefined && stepText !== undefined && BigInt(stepText) !== 0n) {
                const step = BigInt(stepText);
                const distance = (BigInt(right.integer) - BigInt(left.integer)) * (step < 0n ? -1n : 1n);
                const stride = step < 0n ? -step : step;
                const count = expression.operator === 'to' ? (distance < 0n ? 0n : distance / stride + 1n)
                    : (distance <= 0n ? 0n : (distance + stride - 1n) / stride);
                if (count <= BigInt(Number.MAX_SAFE_INTEGER)) length = Number(count);
            }
            return { types: ['sequence'], elements: ['integer'], rank: 1, shape: [length] };
        }
        if (['+', '-', '*', '/', '//', '%', '**'].includes(expression.operator)) {
            const types = typeOf(expression, name => lookup(name)?.types);
            if (types.join() === 'text') return { types, rank: 1, shape: [null] };
            if (left.rank === 0 && right.rank === 0) return { types, rank: 0, shape: [] };
            const leftShape = isAtom(left) ? [] : left.shape;
            const rightShape = isAtom(right) ? [] : right.shape;
            if (leftShape && rightShape && !incompatibleShapes(left, right)) {
                const shape = Array.from({ length: Math.max(leftShape.length, rightShape.length) }, (_, index) => {
                    const offset = Math.max(leftShape.length, rightShape.length) - index;
                    const a = offset > leftShape.length ? 1 : leftShape.at(-offset);
                    const b = offset > rightShape.length ? 1 : rightShape.at(-offset);
                    return a == null || b == null ? null : a === 1 ? b : a;
                });
                return { types, rank: shape.length, shape };
            }
        }
    }
    if (isApplicationExpression(expression)) {
        const parts = flattenApplication(expression);
        const source = expressionFacts(parts[0], lookup);
        const last = parts.at(-1)!;
        if (isNameExpression(last) && lookup(last.name)?.types.includes('function') && lookup.call) {
            return lookup.call(last.name, parts.slice(0, -1).map(part => expressionFacts(part, lookup)));
        }
        if (isNameExpression(last) && lookup(last.name) === undefined) {
            if (last.name === 'window' && parts.length === 3 && source.rank === 1 && source.shape?.[0] != null) {
                const widthText = expressionFacts(parts[1], lookup).integer;
                const width = widthText === undefined ? NaN : Number(widthText);
                if (Number.isSafeInteger(width) && width > 0) {
                    const count = Math.max(0, source.shape[0] - width + 1);
                    if (source.types.join() === 'text') return { types: ['sequence'], elements: ['text'], rank: 1, shape: [count] };
                    if (['array', 'bytes', 'sequence'].includes(source.types.join())) return {
                        types: ['array'], elements: source.elements, rank: 2, shape: [count, width],
                    };
                }
            }
            if (last.name === 'reshape' && parts.length === 3) {
                const dimensions = expressionFacts(parts[1], lookup).integers;
                if (dimensions && dimensions.every(n => n === null || n >= 0)) return {
                    types: ['array'], elements: source.elements, rank: dimensions.length, shape: dimensions,
                };
            }
        }
        // Only plain scalar and whole-axis addressing is proven here.
        if (source.types.length === 1 && ['array', 'bytes'].includes(source.types[0]) && source.shape
            && parts.slice(1).every(part => isAllAxisExpression(part)
                || expressionFacts(part, lookup).types.join() === 'integer')
            && parts.length - 1 <= source.shape.length) {
            const shape = source.shape.filter((_, index) => index >= parts.length - 1 || isAllAxisExpression(parts[index + 1]));
            if (shape.length) return { types: source.types, elements: source.elements, rank: shape.length, shape };
            if (source.elements?.join() === 'text') return { types: ['text'], rank: 1, shape: [null] };
            return source.elements?.length && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                ? { types: source.elements, rank: 0, shape: [] } : { types: source.elements ?? [] };
        }
    }
    return { types: typeOf(expression, name => lookup(name)?.types) };
}

/** Unknown axes are not mismatches. Singleton axes follow runtime broadcasting. */
export function incompatibleShapes(left: ValueFacts, right: ValueFacts): boolean {
    // Text participates in scalar operations; its code-point length is not a broadcast axis.
    if (isAtom(left) || isAtom(right) || left.types.includes('text') || right.types.includes('text')) return false;
    if (!left.shape || !right.shape) return false;
    for (let offset = 1; offset <= Math.min(left.shape.length, right.shape.length); offset++) {
        const a = left.shape.at(-offset);
        const b = right.shape.at(-offset);
        if (a != null && b != null && a !== b && a !== 1 && b !== 1) return true;
    }
    return false;
}

export function isAtom(facts: ValueFacts): boolean {
    return facts.rank === 0 || facts.types.length === 1 && facts.types[0] === 'text';
}

/** Facts shared by every reachable path, with a union of possible runtime types. */
export function joinValueFacts(values: readonly ValueFacts[]): ValueFacts {
    if (!values.length) return UNKNOWN_VALUE;
    const first = values[0];
    const types = values.every(value => value.types.length)
        ? [...new Set(values.flatMap(value => value.types))] : [];
    const rank = values.every(value => value.rank === first.rank) ? first.rank : undefined;
    const shape = rank !== undefined && values.every(value => value.shape?.length === rank)
        ? first.shape!.map((dimension, axis) => values.every(value => value.shape![axis] === dimension) ? dimension : null)
        : undefined;
    const elements = values.every(value => value.elements?.length)
        ? [...new Set(values.flatMap(value => value.elements!))] : undefined;
    return { types, ...(rank !== undefined ? { rank } : {}), ...(shape ? { shape } : {}),
        ...(elements ? { elements } : {}) };
}
