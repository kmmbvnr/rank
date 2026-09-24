import {
    isApplicationExpression, isAllAxisExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral, isMaterializeExpression,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isStringLiteral, isUnaryExpression,
    type Expression,
} from '../generated/ast.js';
import { mapsScalarCells, resultTypes, typeOf, type Types } from './types.js';
import { flattenApplication, groupedUnaryDyadicChain } from '../expressions.js';
import { findOperation, type Operation } from '../operations.js';

/** Serializable facts only: inspecting these never evaluates user code. */
export interface ValueFacts {
    readonly types: Types;
    readonly acceptedTypes?: Types;
    readonly acceptedArrayRank?: number;
    readonly elements?: Types;
    /** Proven eager scalar cells; reading one cannot run a lazy callback. */
    readonly eagerScalarCells?: true;
    /** Derived scalar cells may be lazy, but cannot call Rank code when read. */
    readonly callbackFreeScalarCells?: true;
    readonly rank?: number;
    readonly shape?: readonly (number | null)[];
    readonly integer?: string;
    readonly integers?: readonly (number | null)[];
}

export const UNKNOWN_VALUE: ValueFacts = { types: [] };
export type FactLookup = ((name: string) => ValueFacts | undefined) & {
    invoke?: (name: string, arguments_: readonly ValueFacts[]) => ValueFacts;
    arity?: (name: string) => number | undefined;
};

/** A catalogue contract applies only to proven scalar operands in its domain. */
export function hasScalarNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const domain = operation.scalarNoCallback;
    return !!domain && !operation.effects?.length && operation.arities.includes(operands.length)
        && operands.every(value => value.rank === 0 && value.types.length > 0
            && value.types.every(type => type === 'integer' || domain === 'number' && type === 'real'));
}

/** A scalar-cell array may be eager or a lazy array with a proved callback-free reader. */
export function hasScalarCellArrayNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const value = operands[0];
    const domain = operation.scalarCellArrayNoCallback;
    return !!domain && !operation.effects?.length
        && operands.length === 1 && operation.arities.includes(1)
        && value.types.join() === 'array'
        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
        && !!value.elements?.length && value.elements.every(type => domain === 'boolean'
            ? type === 'boolean' : type === 'integer' || type === 'real');
}

/** A mapped scalar builtin reads only proved numeric cells from its array input. */
export function hasMappedScalarNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const value = operands[0];
    const domain = operation.scalarNoCallback;
    return !!domain && !operation.effects?.length && operation.arities.includes(1)
        && operands.length === 1 && mapsScalarCells(operation)
        && value.types.join() === 'array' && !!value.shape
        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
        && !!value.elements?.length && value.elements.every(type => type === 'integer'
            || domain === 'number' && type === 'real');
}

/** Every array read by this builtin has numeric cells that cannot run Rank code. */
export function hasNumericArrayNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    return operation.numericArrayNoCallback === true && !operation.effects?.length
        && operation.arities.includes(operands.length)
        && operands.some(value => value.types.join() === 'array')
        && operands.every(value => value.types.join() === 'array'
            ? (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
                && !!value.elements?.length
                && value.elements.every(type => type === 'integer' || type === 'real')
            : value.rank === 0 && value.types.length > 0
                && value.types.every(type => type === 'integer' || type === 'real'));
}

/** A known Rank array's shape can be read without touching a lazy cell. */
export function hasArrayHeaderNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const value = operands[0];
    return operation.arrayHeaderNoCallback === true && !operation.effects?.length
        && operands.length === 1 && operation.arities.includes(1)
        && value.types.join() === 'array'
        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true);
}

/** Start with facts that follow directly from syntax, retaining unknown lengths. */
export function expressionFacts(expression: Expression, lookup: FactLookup): ValueFacts {
    if (isParenthesizedExpression(expression)) return expressionFacts(expression.value, lookup);
    if (isNameExpression(expression)) {
        const value = lookup(expression.name);
        return value?.types.includes('function') && lookup.invoke && lookup.arity?.(expression.name) === 0
            ? lookup.invoke(expression.name, []) : value ?? UNKNOWN_VALUE;
    }
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
        if (operand.rank === 0 && operand.types.length > 0
            && operand.types.every(type => type === 'integer' || type === 'real')) {
            return { types: operand.types, rank: 0, shape: [] };
        }
        if (operand.types.join() === 'array' || operand.types.join() === 'sequence') return {
            types: operand.types, rank: operand.rank, shape: operand.shape, elements: operand.elements,
        };
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
            const items = [...expression.items, ...expression.rows.flatMap(row => row.items)]
                .map(item => expressionFacts(item.value, lookup));
            const eagerScalarCells = fill
                ? fill.rank === 0 && fill.types.length > 0
                    && fill.types.every(type => ['integer', 'real', 'boolean'].includes(type))
                : items.length > 0 && items.every(item => item.rank === 0 && item.types.length > 0
                    && item.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type)));
            return { types: ['array'], rank: shape.length, shape,
                ...(fill && isAtom(fill) ? { elements: fill.types }
                    : !fill && items.length && items.every(isAtom) ? { elements: [...new Set(items.flatMap(item => item.types))] } : {}),
                ...(eagerScalarCells ? { eagerScalarCells: true as const } : {}) };
        }
        // Nested array literals and row assembly need the runtime's cell rules.
        const items = expression.items.map(item => expressionFacts(item.value, lookup));
        if (!expression.rows.length && items.every(isAtom)) {
            const eagerScalarCells = items.every(item => item.rank === 0 && item.types.length > 0
                && item.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type)));
            return { types: ['array'], rank: 1, shape: [items.length],
                elements: [...new Set(items.flatMap(item => item.types))],
                ...(eagerScalarCells ? { eagerScalarCells: true as const } : {}),
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
        if (['+', '-', '*', '/', '//', '%', '**'].includes(expression.operator)
            && isNameExpression(expression.right) && expression.right.name === 'outer'
            && lookup('outer') === undefined && isApplicationExpression(expression.left)) {
            const operands = flattenApplication(expression.left);
            if (operands.length === 2) {
                const left = expressionFacts(operands[0], lookup);
                const right = expressionFacts(operands[1], lookup);
                if (left.shape && right.shape && left.types.join() === 'array'
                    && right.types.join() === 'array') {
                    const shape = [...left.shape, ...right.shape];
                    return { types: ['array'], rank: shape.length, shape };
                }
            }
        }
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
            const inferred = typeOf(expression, name => lookup(name)?.types);
            const scalarNumbers = [left, right].every(value => value.rank === 0
                && value.types.length > 0 && value.types.every(type => type === 'integer' || type === 'real'));
            const integerArithmetic = scalarNumbers && ['+', '-', '*'].includes(expression.operator)
                && left.types.join() === 'integer' && right.types.join() === 'integer';
            const scalarTypes = integerArithmetic ? ['integer'] as Types
                : inferred.length ? inferred : scalarNumbers ? ['integer', 'real'] as Types : inferred;
            const collections = [left, right].map(value => value.types.join())
                .filter(type => type === 'array' || type === 'sequence');
            const types = collections.length && collections.every(type => type === collections[0])
                ? [collections[0]] : scalarTypes;
            if (types.join() === 'text') return { types, rank: 1, shape: [null] };
            if (left.rank === 0 && right.rank === 0) return { types, rank: 0, shape: [] };
            const leftShape = isAtom(left) ? [] : left.shape;
            const rightShape = isAtom(right) ? [] : right.shape;
            if (leftShape && rightShape && !incompatibleShapes(left, right)) {
                const shape = broadcastShape(leftShape, rightShape);
                const safeNumeric = (value: ValueFacts): boolean => (value.rank === 0
                    && value.types.length > 0 && value.types.every(type => type === 'integer' || type === 'real'))
                    || (value.types.join() === 'array' && !!value.shape
                        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
                        && !!value.elements?.length
                        && value.elements.every(type => type === 'integer' || type === 'real'));
                const callbackFree = types.join() === 'array' && [left, right].every(safeNumeric);
                return { types, rank: shape.length, shape,
                    ...(callbackFree ? { elements: ['integer', 'real'] as Types, callbackFreeScalarCells: true as const } : {}) };
            }
        }
        if (['equal', 'notequal', 'and', 'or', 'xor'].includes(expression.operator)) {
            const allowed = expression.operator === 'equal' || expression.operator === 'notequal'
                ? ['integer', 'real', 'boolean', 'symbol'] : ['boolean'];
            const safe = (value: ValueFacts): boolean => (value.rank === 0 && value.types.length > 0
                && value.types.every(type => allowed.includes(type)))
                || (value.types.join() === 'array' && !!value.shape
                    && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
                    && !!value.elements?.length && value.elements.every(type => allowed.includes(type)));
            if ([left, right].every(safe) && (left.types.join() === 'array' || right.types.join() === 'array')) {
                const leftShape = left.rank === 0 ? [] : left.shape!;
                const rightShape = right.rank === 0 ? [] : right.shape!;
                if (!incompatibleShapes(left, right)) {
                    const shape = broadcastShape(leftShape, rightShape);
                    return { types: ['array'], rank: shape.length, shape, elements: ['boolean'],
                        callbackFreeScalarCells: true };
                }
            }
        }
    }
    if (isApplicationExpression(expression)) {
        const grouped = groupedUnaryDyadicChain(expression, name => lookup(name) === undefined);
        if (grouped) return expressionFacts(grouped, lookup);
        const parts = flattenApplication(expression);
        const last = parts.at(-1)!;
        const unaryTail = isApplicationExpression(expression.head) && expression.arguments.length === 1
            && isNameExpression(last) && lookup(last.name) === undefined
            && findOperation(last.name)?.arities.join() === '1';
        const source = expressionFacts(unaryTail ? expression.head : parts[0], lookup);
        if (isNameExpression(last) && lookup(last.name) === undefined) {
            const operation = findOperation(last.name);
            const arity = unaryTail ? 1 : parts.length - 1;
            if (operation?.arities.includes(arity)) {
                const operands = unaryTail ? [source] : parts.slice(0, -1).map(part => expressionFacts(part, lookup));
                if (hasScalarNoCallbackProof(operation, operands)) {
                    const types = resultTypes(operation);
                    if (types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol',
                        'date', 'datetime', 'duration'].includes(type))) {
                        return { types, rank: 0, shape: [] };
                    }
                }
                if (hasScalarCellArrayNoCallbackProof(operation, operands)) {
                    return { types: resultTypes(operation), rank: 0, shape: [] };
                }
                if (last.name === 'shape' && arity === 1 && source.types.join() === 'array'
                    && source.rank !== undefined) return { types: ['array'], rank: 1, shape: [source.rank],
                    elements: ['integer'], eagerScalarCells: true,
                    ...(source.shape ? { integers: source.shape } : {}) };
                const collection = source.types.join() === 'array' || source.types.join() === 'sequence';
                if (arity === 1 && collection && mapsScalarCells(operation)) return {
                    types: source.types, rank: source.rank, shape: source.shape,
                    elements: resultTypes(operation),
                    ...(hasMappedScalarNoCallbackProof(operation, operands)
                        ? { callbackFreeScalarCells: true as const } : {}),
                };
                if (operation.preservesArrayShape && arity === 2 && collection) return {
                    types: source.types, rank: source.rank, shape: source.shape, elements: source.elements,
                    ...(hasNumericArrayNoCallbackProof(operation, operands)
                        ? { callbackFreeScalarCells: true as const } : {}),
                };
                if (last.name === 'transpose' && arity === 1 && source.types.join() === 'array'
                    && source.shape) return { types: ['array'], rank: source.shape.length,
                    shape: [...source.shape].reverse(), elements: source.elements,
                    ...(hasNumericArrayNoCallbackProof(operation, operands)
                        ? { callbackFreeScalarCells: true as const } : {}) };
                if (arity === 2) {
                    const right = expressionFacts(parts[1], lookup);
                    if (operation.dyadicRanks?.[0] === 'all' && operation.dyadicRanks[1] === 1
                        && right.types.join() === 'array' && right.rank !== undefined && right.rank > 1) {
                        return { types: ['array'], rank: right.rank - 1,
                            shape: right.shape?.slice(0, -1) ?? Array(right.rank - 1).fill(null),
                            elements: resultTypes(operation) };
                    }
                    if (operation.dyadicRanks?.[0] === 0 && operation.dyadicRanks[1] === 0
                        && (source.types.join() === 'array' || right.types.join() === 'array')) {
                        const leftArray = source.types.join() === 'array';
                        const rightArray = right.types.join() === 'array';
                        const array = leftArray ? source : right;
                        const shape = leftArray && rightArray
                            ? source.shape && right.shape && !incompatibleShapes(source, right)
                                ? broadcastShape(source.shape, right.shape) : undefined
                            : array.shape;
                        return { types: ['array'], rank: shape?.length ?? (leftArray !== rightArray ? array.rank : undefined),
                            shape, elements: resultTypes(operation) };
                    }
                    if (last.name === 'matmul' && source.types.join() === 'array'
                        && right.types.join() === 'array' && source.shape?.length && right.shape?.length) {
                        const elements = [...(source.elements ?? []), ...(right.elements ?? [])];
                        const types: Types = source.elements?.length && right.elements?.length
                            && elements.every(type => type === 'integer')
                            ? ['integer'] : elements.includes('real') ? ['real'] : ['integer', 'real'];
                        const shape = [...source.shape.slice(0, -1), ...right.shape.slice(1)];
                        return shape.length ? { types: ['array'], rank: shape.length, shape, elements: types,
                            ...(hasNumericArrayNoCallbackProof(operation, operands)
                                ? { callbackFreeScalarCells: true as const } : {}) }
                            : { types, rank: 0, shape: [] };
                    }
                }
                if (operation.resultShapeFromOperand !== undefined
                    && resultTypes(operation).join() === 'array'
                    && operands[operation.resultShapeFromOperand]?.types.join() === 'array') {
                    const shapeSource = operands[operation.resultShapeFromOperand];
                    const callbackFree = hasNumericArrayNoCallbackProof(operation, operands);
                    return { types: ['array'], rank: shapeSource.rank, shape: shapeSource.shape,
                        ...(callbackFree ? { elements: ['integer', 'real'] as Types,
                            callbackFreeScalarCells: true as const } : {}) };
                }
                if (hasNumericArrayNoCallbackProof(operation, operands)
                    && resultTypes(operation).join() === 'array') return {
                    types: ['array'], elements: ['integer', 'real'], callbackFreeScalarCells: true,
                };
            }
        }
        if (source.types.join() === 'array' && source.shape && parts.length >= 4
            && isNameExpression(parts[1]) && parts[1].name === 'sum' && lookup('sum') === undefined
            && isNameExpression(parts[2]) && parts[2].name === 'axis') {
            const axes = parts.slice(3).map(part => expressionFacts(part, lookup).integer);
            if (axes.length && axes.every(axis => axis !== undefined && Number.isSafeInteger(Number(axis))
                && Number(axis) >= 0 && Number(axis) < source.shape!.length)
                && new Set(axes).size === axes.length) {
                const shape = source.shape.filter((_, axis) => !axes.includes(String(axis)));
                const elements = source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')
                    ? source.elements : ['integer', 'real'];
                return shape.length ? { types: ['array'], rank: shape.length, shape, elements }
                    : { types: elements, rank: 0, shape: [] };
            }
        }
        if (isNameExpression(last) && last.name === 'len' && lookup(last.name) === undefined
            && parts.length === 2 && source.types.join() === 'array') {
            return { types: ['integer'], rank: 0, shape: [] };
        }
        if (isNameExpression(last) && last.name === 'count' && lookup(last.name) === undefined
            && parts.length === 2 && source.types.join() === 'array') {
            return { types: ['integer'], rank: 0, shape: [] };
        }
        if (isNameExpression(last) && lookup(last.name) === undefined && ['min', 'max'].includes(last.name)
            && parts.length === 3) {
            const other = expressionFacts(parts[1], lookup);
            if (source.rank === 0 && other.rank === 0
                && [source, other].every(value => value.types.length > 0
                    && value.types.every(type => type === 'integer' || type === 'real'))) {
                return { types: [...new Set([...source.types, ...other.types])], rank: 0, shape: [] };
            }
        }
        if (isNameExpression(last) && lookup(last.name)?.types.includes('function') && lookup.invoke) {
            return lookup.invoke(last.name, parts.slice(0, -1).map(part => expressionFacts(part, lookup)));
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

function broadcastShape(left: readonly (number | null)[], right: readonly (number | null)[]): (number | null)[] {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
        const offset = Math.max(left.length, right.length) - index;
        const a = offset > left.length ? 1 : left.at(-offset);
        const b = offset > right.length ? 1 : right.at(-offset);
        return a == null || b == null ? null : a === 1 ? b : a;
    });
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
    const scalar = types.length > 0 && types.every(type =>
        ['integer', 'real', 'boolean', 'symbol', 'date', 'datetime', 'duration'].includes(type));
    const rank = scalar ? 0 : values.every(value => value.rank === first.rank) ? first.rank : undefined;
    const shape = rank !== undefined && values.every(value => value.shape?.length === rank)
        ? first.shape!.map((dimension, axis) => values.every(value => value.shape![axis] === dimension) ? dimension : null)
        : scalar ? [] : undefined;
    const elements = values.every(value => value.elements?.length)
        ? [...new Set(values.flatMap(value => value.elements!))] : undefined;
    return { types, ...(rank !== undefined ? { rank } : {}), ...(shape ? { shape } : {}),
        ...(elements ? { elements } : {}),
        ...(values.every(value => value.eagerScalarCells) ? { eagerScalarCells: true as const }
            : values.every(value => value.eagerScalarCells || value.callbackFreeScalarCells)
                ? { callbackFreeScalarCells: true as const } : {}) };
}
