import {
    isApplicationExpression, isAllAxisExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral, isMaterializeExpression,
    isFirstIndexWhereExpression, isFirstWhereExpression, isLabelLiteral, isNameExpression, isNewStructureExpression,
    isNumberLiteral,
    isParenthesizedExpression, isRecordExpression, isRecordUpdateExpression, isStdinExpression, isStringLiteral,
    isTableFilterExpression,
    isTakeWhileExpression, isUnaryExpression,
    type Expression,
} from '../generated/ast.js';
import { binaryType, localCollectionType, mapsScalarCells, resultTypes, typeOf, type Types } from './types.js';
import { flattenApplication, groupedUnaryDyadicChain, inlineSliceOperands } from '../expressions.js';
import { findOperation, type Operation } from '../operations.js';
import { axisReductionForm } from '../application-forms.js';

/** Serializable facts only: inspecting these never evaluates user code. */
export interface ValueFacts {
    readonly types: Types;
    readonly acceptedTypes?: Types;
    readonly acceptedArrayRank?: number;
    /** Possible array/sequence cells or values stored in an index. */
    readonly elements?: Types;
    /** Rank fixed by the first insertion of an array into a mutable collection. */
    readonly elementRank?: number;
    /** Element types by position for a fixed rank-1 array. */
    readonly positions?: readonly Types[];
    /** Complete cell facts for a fixed rank-1 array whose cells may themselves be arrays. */
    readonly positionFacts?: readonly ValueFacts[];
    /** Proven eager cells; reading one cannot run a lazy callback. */
    readonly eagerScalarCells?: true;
    /** Derived scalar cells may be lazy, but cannot call Rank code when read. */
    readonly callbackFreeScalarCells?: true;
    readonly rank?: number;
    readonly shape?: readonly (number | null)[];
    readonly boolean?: boolean;
    readonly integer?: string;
    readonly integers?: readonly (number | null)[];
    readonly textLiteral?: string;
    /** Whether a functional graph carries edge weights; `upto` has a different result in each mode. */
    readonly functionalWeighted?: boolean;
    /** Built-in numeric combine proved at construction; user callbacks never get this marker. */
    readonly segmentOperation?: '+' | 'min' | 'max' | 'maxsum' | 'band' | 'bor' | 'bxor';
    /** Known fields of a record; absent fields remain unknown. */
    readonly fields?: Readonly<Record<string, ValueFacts>>;
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

/** `find` and `findall` hash every source cell and the target without invoking Rank code. */
export function hasCallbackFreeFindProof(source: ValueFacts, target: ValueFacts): boolean {
    const scalar = (type: string) => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type);
    return (source.types.join() === 'text' || source.types.join() === 'array'
        && source.rank === 1 && (source.eagerScalarCells === true || source.callbackFreeScalarCells === true)
        && !!source.elements?.length && source.elements.every(scalar))
        && isAtom(target) && target.types.length > 0 && target.types.every(scalar);
}

function sortedScalarArray(source: ValueFacts): ValueFacts | undefined {
    if (source.types.join() !== 'array' || source.rank !== 1 || !source.shape
        || !(source.eagerScalarCells || source.callbackFreeScalarCells)
        || !source.elements?.length || !source.elements.every(type => type === 'integer' || type === 'real')) return;
    return { types: ['array'], rank: 1, shape: source.shape,
        elements: source.elements, eagerScalarCells: true };
}

export function stableRecordField(value: ValueFacts): ValueFacts {
    const { types } = value;
    return { types,
        ...(types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol',
            'date', 'datetime', 'duration'].includes(type)) ? { rank: 0, shape: [] }
            : types.join() === 'text' ? { rank: 1, shape: [null] } : {}) };
}

/** Start with facts that follow directly from syntax, retaining unknown lengths. */
export function expressionFacts(expression: Expression, lookup: FactLookup): ValueFacts {
    if (isParenthesizedExpression(expression)) return expressionFacts(expression.value, lookup);
    if (isNameExpression(expression)) {
        const value = lookup(expression.name);
        const local = localCollectionType(expression.name);
        const builtin = findOperation(expression.name);
        return value?.types.includes('function') && lookup.invoke && lookup.arity?.(expression.name) === 0
            ? lookup.invoke(expression.name, []) : value ?? (local.length ? { types: local }
                : builtin?.arities.length === 0 ? {
                    types: resultTypes(builtin),
                    ...(builtin.valueElements ? { elements: [builtin.valueElements] } : {}),
                    ...(builtin.valueCallbackFree ? { callbackFreeScalarCells: true as const } : {}),
                    ...(builtin.result === 'sequence' ? { rank: 1, shape: [null] } : {}),
                    ...(builtin.result === 'real' ? { rank: 0, shape: [] } : {}),
                } : UNKNOWN_VALUE);
    }
    if (isNewStructureExpression(expression) && expression.structure === 'index') {
        return { types: ['index'], elements: [] };
    }
    if (isNumberLiteral(expression)) return {
        types: [typeof expression.value === 'bigint' ? 'integer' : 'real'], rank: 0, shape: [],
        ...(typeof expression.value === 'bigint' ? { integer: String(expression.value) } : {}),
    };
    if (isLabelLiteral(expression)) return { types: ['symbol'], rank: 0, shape: [] };
    if (isStdinExpression(expression)) {
        const elements = expression.mode.name === 'integer' ? ['integer']
            : expression.mode.name === 'word' ? ['text'] : [];
        if (!elements.length) return UNKNOWN_VALUE;
        if (expression.count) {
            const count = expressionFacts(expression.count, lookup).integer;
            const size = count === undefined ? NaN : Number(count);
            return { types: ['sequence'], rank: 1,
                shape: [Number.isSafeInteger(size) && size >= 0 ? size : null],
                ...(elements.length ? { elements } : {}) };
        }
        return elements.join() === 'integer' ? { types: elements, rank: 0, shape: [] }
            : elements.join() === 'text' ? { types: elements, rank: 1, shape: [null] } : UNKNOWN_VALUE;
    }
    // Runtime rank is one for text, although arithmetic treats the whole text as an atom.
    if (isStringLiteral(expression)) return { types: ['text'], rank: 1,
        shape: [[...expression.value].length], textLiteral: expression.value };
    if (isBooleanLiteral(expression)) return { types: ['boolean'], rank: 0, shape: [], boolean: expression.value };
    if (isRecordExpression(expression)) return { types: ['record'], fields: Object.fromEntries(
        expression.fields.map(field => [field.name, stableRecordField(expressionFacts(field.value, lookup))])) };
    if (isRecordUpdateExpression(expression)) {
        const source = expressionFacts(expression.source, lookup);
        if (source.types.join() !== 'record') return { types: ['record'] };
        if (!source.fields) return source;
        const fields = { ...source.fields };
        for (const field of expression.fields) if (fields[field.name]) {
            fields[field.name] = stableRecordField(fields[field.name]);
        }
        return { ...source, fields };
    }
    if (isUnaryExpression(expression) && expression.operator === 'not') {
        const operand = expressionFacts(expression.operand, lookup);
        if (operand.rank === 0 && operand.types.join() === 'boolean') {
            return { types: ['boolean'], rank: 0, shape: [],
                ...(operand.boolean === undefined ? {} : { boolean: !operand.boolean }) };
        }
    }
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
                ? fill.types.length > 0 && isAtom(fill)
                : items.length > 0 && items.every(item => item.types.length > 0 && isAtom(item));
            const elements = fill && isAtom(fill) ? fill.types
                : !fill && items.length && items.every(isAtom)
                    ? [...new Set(items.flatMap(item => item.types))] : undefined;
            return { types: ['array'], rank: shape.length, shape,
                ...(elements ? { elements } : {}),
                ...(!fill && shape.length === 1 && elements && elements.length > 1
                    ? { positions: items.map(item => item.types) } : {}),
                ...(eagerScalarCells ? { eagerScalarCells: true as const } : {}) };
        }
        // Nested array literals and row assembly need the runtime's cell rules.
        const items = expression.items.map(item => expressionFacts(item.value, lookup));
        if (!expression.rows.length && items.every(isAtom)) {
            const eagerScalarCells = items.every(item => item.types.length > 0 && isAtom(item));
            const elements = [...new Set(items.flatMap(item => item.types))];
            return { types: ['array'], rank: 1, shape: [items.length],
                elements, ...(elements.length > 1 ? { positions: items.map(item => item.types) } : {}),
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
            ? { ...source, types: ['array'],
                ...(isStdinExpression(expression.source) && source.elements?.length
                    ? { eagerScalarCells: true as const } : {}) } : { types: ['array'] };
    }
    if (isFirstIndexWhereExpression(expression)) return { types: ['integer'], rank: 0, shape: [] };
    if (isTableFilterExpression(expression) && !expression.sourceFields.length) {
        const source = expressionFacts(expression.source, lookup);
        if (source.types.join() === 'array' && source.rank === 1) return {
            types: ['array'], rank: 1, shape: [null],
        };
    }
    if (isFirstWhereExpression(expression) || isTakeWhileExpression(expression)) {
        const source = expressionFacts(expression.source, lookup);
        const mask = expressionFacts(expression.mask, lookup);
        const safeMask = mask.rank === 1 && mask.elements?.join() === 'boolean'
            && (mask.eagerScalarCells || mask.callbackFreeScalarCells);
        const safeSource = source.rank === 1 && source.elements?.length
            && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))
            && (source.eagerScalarCells || source.callbackFreeScalarCells);
        if (isTakeWhileExpression(expression)) {
            if (source.types.join() === 'text') return { types: ['text'], rank: 1, shape: [null] };
            if (source.types.join() === 'queue') return { types: ['array'], rank: 1, shape: [null] };
            if (source.rank === 1 && ['array', 'sequence'].includes(source.types.join())) {
                const kind = source.types.join() === 'sequence' ? 'sequence' : 'array';
                return { types: [kind], rank: 1, shape: [null],
                    ...(safeSource && safeMask ? { elements: source.elements, callbackFreeScalarCells: true as const } : {}) };
            }
            return UNKNOWN_VALUE;
        }
        if (source.types.join() === 'text') return { types: ['text'], rank: 1, shape: [1] };
        if (safeSource && safeMask && ['array', 'sequence'].includes(source.types.join())) {
            return source.elements!.join() === 'text'
                ? { types: ['text'], rank: 1, shape: [null] }
                : { types: source.elements!, rank: 0, shape: [] };
        }
        return UNKNOWN_VALUE;
    }
    if (isBinaryExpression(expression)) {
        if (expression.operator === '+' && isNameExpression(expression.right)
            && expression.right.name === 'segment' && lookup('segment') === undefined) {
            const values = expressionFacts(expression.left, lookup);
            if (['array', 'sequence'].includes(values.types.join()) && values.rank === 1
                && (values.eagerScalarCells || values.callbackFreeScalarCells)
                && values.elements?.length
                && values.elements.every(type => type === 'integer' || type === 'real')) {
                return { types: ['segment'], elements: values.elements, segmentOperation: '+' };
            }
        }
        if (['+', '*'].includes(expression.operator) && lookup('scan') === undefined) {
            const parts = isNameExpression(expression.right) ? [expression.right]
                : isApplicationExpression(expression.right) ? flattenApplication(expression.right) : [];
            if ((parts.length === 1 || parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'with')
                && isNameExpression(parts[0]) && parts[0].name === 'scan') {
                const source = expressionFacts(expression.left, lookup);
                const seed = parts[2] && expressionFacts(parts[2], lookup);
                const numeric = (types: Types | undefined) => !!types?.length
                    && types.every(type => type === 'integer' || type === 'real');
                if (['array', 'sequence'].includes(source.types.join()) && source.rank === 1
                    && (source.eagerScalarCells || source.callbackFreeScalarCells) && numeric(source.elements)
                    && (!seed || seed.rank === 0 && numeric(seed.types))) {
                    const length = source.shape?.[0];
                    const size = length == null ? null : length + (seed ? 1 : 0);
                    return { types: source.types, rank: 1, shape: [size],
                        elements: [...new Set([...source.elements!, ...(seed?.types ?? [])])],
                        callbackFreeScalarCells: true };
                }
            }
        }
        if (['+', '*'].includes(expression.operator) && isNameExpression(expression.right)
            && expression.right.name === 'reduce' && lookup('reduce') === undefined) {
            const source = expressionFacts(expression.left, lookup);
            if (['array', 'sequence'].includes(source.types.join()) && source.rank !== undefined
                && source.rank > 0 && (source.eagerScalarCells || source.callbackFreeScalarCells)
                && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
                return { types: source.elements.join() === 'integer' ? ['integer'] : ['integer', 'real'],
                    rank: 0, shape: [] };
            }
        }
        const slice = inlineSliceOperands(expression);
        if (slice) {
            const source = expressionFacts(slice.source, lookup);
            const kind = source.types.join();
            if (kind === 'array' || kind === 'text' || kind === 'sequence' || kind === 'queue') {
                const axis = Number(slice.axis);
                const start = expressionFacts(slice.start, lookup).integer;
                const end = expressionFacts(slice.end, lookup).integer;
                const shape = source.shape?.slice() ?? (kind === 'array' ? undefined : [null]);
                if (shape && Number.isSafeInteger(axis) && axis >= 0 && axis < shape.length) {
                    shape[axis] = null;
                    if (start !== undefined && end !== undefined) {
                        const first = BigInt(start);
                        const last = BigInt(end) + (slice.inclusive ? 1n : 0n);
                        const size = source.shape?.[axis] ?? null;
                        if (first >= 0n && last >= 0n && size !== null
                            && first <= BigInt(size) && last <= BigInt(size)) {
                            shape[axis] = Number(last > first ? last - first : 0n);
                        }
                    }
                }
                if (kind === 'text') return { types: ['text'], rank: 1, shape };
                if (kind === 'sequence' || kind === 'queue') return { types: ['array'], rank: 1, shape,
                    elements: source.elements,
                    ...(kind === 'sequence' && source.callbackFreeScalarCells
                        ? { callbackFreeScalarCells: true as const } : {}) };
                return { types: ['array'], rank: source.rank, shape,
                    elements: source.elements,
                    ...(source.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}) };
            }
            return UNKNOWN_VALUE;
        }
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
                    const numeric = [left, right].every(value =>
                        (value.eagerScalarCells || value.callbackFreeScalarCells)
                        && value.elements?.length && value.elements.every(type => type === 'integer' || type === 'real'));
                    const integers = ['+', '-', '*', '//', '%'].includes(expression.operator)
                        && [left, right].every(value => value.elements?.join() === 'integer');
                    return { types: ['array'], rank: shape.length, shape,
                        ...(numeric ? { elements: (integers ? ['integer'] : ['integer', 'real']) as Types,
                            callbackFreeScalarCells: true as const } : {}) };
                }
            }
        }
        const left = expressionFacts(expression.left, lookup);
        const right = expressionFacts(expression.right, lookup);
        if (['in', 'notin'].includes(expression.operator)
            && ['array', 'sequence'].includes(left.types.join()) && left.rank !== undefined
            && left.elements?.length && (left.eagerScalarCells || left.callbackFreeScalarCells)
            && left.elements.every(type => ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))
            && ['array', 'sequence'].includes(right.types.join())
            && right.elements?.length && (right.eagerScalarCells || right.callbackFreeScalarCells)
            && right.elements.every(type => ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))) {
            return { types: left.types, rank: left.rank, shape: left.shape,
                elements: ['boolean'], callbackFreeScalarCells: true };
        }
        if (expression.operator === 'default') {
            const types = left.types.length && right.types.length
                ? [...new Set([...left.types, ...right.types])] : [];
            return left.rank === 0 && right.rank === 0 && types.length
                ? { types, rank: 0, shape: [] } : { types };
        }
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
            return { types: ['sequence'], elements: ['integer'], rank: 1, shape: [length],
                callbackFreeScalarCells: true };
        }
        if (['+', '-', '*', '/', '//', '%', '**'].includes(expression.operator)) {
            const inferred = typeOf(expression, name => lookup(name)?.types);
            const scalarNumbers = [left, right].every(value => value.rank === 0
                && value.types.length > 0 && value.types.every(type => type === 'integer' || type === 'real'));
            const integerArithmetic = scalarNumbers && ['+', '-', '*', '//', '%'].includes(expression.operator)
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
                    || (['array', 'sequence'].includes(value.types.join()) && !!value.shape
                        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
                        && !!value.elements?.length
                        && value.elements.every(type => type === 'integer' || type === 'real'));
                const callbackFree = ['array', 'sequence'].includes(types.join()) && [left, right].every(safeNumeric);
                const integerCells = (value: ValueFacts): boolean => value.rank === 0
                    && value.types.join() === 'integer'
                    || ['array', 'sequence'].includes(value.types.join())
                        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
                        && value.elements?.join() === 'integer';
                const integerResult = ['+', '-', '*', '//', '%'].includes(expression.operator)
                    && [left, right].every(integerCells);
                return { types, rank: shape.length, shape,
                    ...(callbackFree ? { elements: (integerResult ? ['integer'] : ['integer', 'real']) as Types,
                        callbackFreeScalarCells: true as const } : {}) };
            }
        }
        if (['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'multipleby',
            'and', 'or', 'xor'].includes(expression.operator)
            && left.rank === 0 && right.rank === 0
            && left.types.length && right.types.length
            && binaryType(expression.operator, left.types, right.types).join() === 'boolean') {
            return { types: ['boolean'], rank: 0, shape: [] };
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
        const ranked = flattenApplication(expression);
        if (ranked.length === 2 && isNewStructureExpression(ranked[0]) && ranked[0].structure === 'dsu') {
            const values = expressionFacts(ranked[1], lookup);
            const allowed = ['integer', 'real', 'boolean', 'text', 'symbol'];
            const elements = values.rank === 0 || values.types.join() === 'text' ? values.types
                : values.rank === 1 && ['array', 'sequence'].includes(values.types.join())
                    && (values.eagerScalarCells || values.callbackFreeScalarCells) ? values.elements : undefined;
            if (elements?.length && elements.every(type => allowed.includes(type))) {
                return { types: ['dsu'], elements };
            }
        }
        if (ranked.length === 3 && isNewStructureExpression(ranked[0]) && ranked[0].structure === 'graph'
            && isLabelLiteral(ranked[2]) && ['directed', 'undirected'].includes(ranked[2].name)) {
            const vertices = expressionFacts(ranked[1], lookup);
            const allowed = ['integer', 'real', 'boolean', 'text', 'symbol'];
            const elements = vertices.rank === 0 ? vertices.types
                : ['array', 'sequence'].includes(vertices.types.join())
                    && (vertices.eagerScalarCells || vertices.callbackFreeScalarCells) ? vertices.elements : undefined;
            if (elements?.length && elements.every(type => allowed.includes(type))) {
                return { types: ['graph'], elements };
            }
        }
        if (ranked.length === 3 && isNameExpression(ranked[1]) && ranked[1].name === 'text'
            && lookup('text') === undefined && isStringLiteral(ranked[2])) {
            const source = expressionFacts(ranked[0], lookup);
            const numeric = (types: Types | undefined) => !!types?.length
                && types.every(type => type === 'integer' || type === 'real');
            if (source.rank === 0 && numeric(source.types)) {
                return { types: ['text'], rank: 1, shape: [null] };
            }
            if (['array', 'sequence'].includes(source.types.join()) && numeric(source.elements)
                && (source.eagerScalarCells || source.callbackFreeScalarCells)) {
                return { types: source.types, elements: ['text'], rank: source.rank,
                    shape: source.shape, ...(source.types.join() === 'array'
                        ? { eagerScalarCells: true as const } : { callbackFreeScalarCells: true as const }) };
            }
        }
        const rank = ranked.at(-2);
        const operationName = ranked.at(-3);
        const rankValue = ranked.at(-1);
        if (ranked.length >= 4 && isNameExpression(rank) && rank.name === 'rank'
            && lookup('rank') === undefined && isNumberLiteral(rankValue) && rankValue.value === 0n
            && isNameExpression(operationName) && lookup(operationName.name) === undefined
            && ['integer', 'real', 'codepoint'].includes(operationName.name)
            && isApplicationExpression(expression.head) && isApplicationExpression(expression.head.head)) {
            const source = expressionFacts(expression.head.head.head, lookup);
            const kind = source.types.join();
            const cells = kind === 'text' ? ['text'] : source.elements;
            if (source.rank !== undefined && source.rank > 0
                && (kind === 'text' || ['array', 'sequence'].includes(kind)
                    && (source.eagerScalarCells || source.callbackFreeScalarCells))
                && cells?.length && cells.every(type => operationName.name === 'codepoint'
                    ? type === 'text' : ['integer', 'real', 'text'].includes(type))) {
                return { types: [kind === 'text' ? 'sequence' : kind],
                    elements: [operationName.name === 'real' ? 'real' : 'integer'],
                    rank: source.rank, shape: source.shape, callbackFreeScalarCells: true };
            }
        }
        const grouped = groupedUnaryDyadicChain(expression, name => lookup(name) === undefined);
        if (grouped) return expressionFacts(grouped, lookup);
        const flattened = flattenApplication(expression);
        let parts = flattened;
        if (flattened.length > 2 && isLabelLiteral(flattened[1])
            && expressionFacts(flattened[0], lookup).fields?.[flattened[1].name]) {
            let prefix: Expression = expression;
            while (isApplicationExpression(prefix) && flattenApplication(prefix).length > 2) {
                prefix = prefix.head;
            }
            if (isApplicationExpression(prefix)) parts = [prefix, ...flattened.slice(2)];
        }
        const last = parts.at(-1)!;
        if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'from') {
            const source = expressionFacts(parts[0], lookup);
            const limit = expressionFacts(parts[2], lookup);
            if (source.types.join() === 'sequence' && limit.types.join() === 'integer') return {
                types: ['sequence'], elements: source.elements, rank: 1, shape: [null],
                ...(source.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}),
            };
        }
        const headParts = isApplicationExpression(expression.head) ? flattenApplication(expression.head) : [];
        const headLast = headParts.at(-1);
        const completedUnaryBuiltin = headParts.length >= 2 && isNameExpression(headLast)
            && lookup(headLast.name) === undefined && findOperation(headLast.name)?.arities.join() === '1';
        const unaryTail = isApplicationExpression(expression.head) && expression.arguments.length === 1
            && isNameExpression(last) && (lookup(last.name) === undefined
                ? findOperation(last.name)?.arities.join() === '1'
                    || completedUnaryBuiltin && findOperation(last.name)?.arities.includes(1)
                : lookup(last.name)?.types.includes('function') && lookup.arity?.(last.name) === 1);
        const source = expressionFacts(unaryTail ? expression.head : parts[0], lookup);
        if (parts.length === 2 && source.types.join() === 'array' && source.rank === 1 && source.shape) {
            const fields = expressionFacts(parts[1], lookup);
            const columns = fields.shape?.[0];
            if (fields.types.join() === 'array' && fields.rank === 1 && columns != null && columns > 0
                && fields.eagerScalarCells && fields.elements?.length
                && fields.elements.every(type => type === 'symbol' || type === 'text')) {
                return { types: ['array'], rank: 2, shape: [source.shape[0], columns] };
            }
        }
        if (parts.length === 2 && isNameExpression(last) && last.name === 'json'
            && lookup('json') === undefined && source.textLiteral !== undefined
            && source.textLiteral.length <= 100_000) {
            try {
                const value: unknown = JSON.parse(source.textLiteral);
                if (Array.isArray(value)) {
                    const elementTypes = [...new Set(value.map(item => item === null ? 'symbol'
                        : Array.isArray(item) ? 'array' : typeof item === 'object' ? 'object'
                            : typeof item === 'number' ? 'integer' : typeof item))];
                    const types = elementTypes.flatMap(type => type === 'integer' ? ['integer', 'real'] : [type]);
                    const eagerScalarCells = elementTypes.every(type =>
                        ['integer', 'boolean', 'text', 'symbol'].includes(type));
                    return { types: ['array'], rank: 1, shape: [value.length],
                        ...(types.length ? { elements: [...new Set(types)] } : {}),
                        ...(eagerScalarCells ? { eagerScalarCells: true as const } : {}) };
                }
                if (value === null) return { types: ['symbol'], rank: 0, shape: [] };
                if (typeof value === 'object') return { types: ['object'] };
                if (typeof value === 'number') return { types: ['integer', 'real'], rank: 0, shape: [] };
                if (typeof value === 'boolean') return { types: ['boolean'], rank: 0, shape: [] };
                if (typeof value === 'string') return { types: ['text'], rank: 1, shape: [[...value].length] };
            } catch { /* Invalid JSON has no value facts. */ }
        }
        if (parts.length === 2 && isNameExpression(last)
            && ['pop', 'peek', 'popfront', 'peekfront', 'popback', 'peekback'].includes(last.name)
            && lookup(last.name) === undefined
            && ['queue', 'stack', 'deque', 'heap'].includes(source.types.join())
            && source.elements?.length) {
            const types = source.elements;
            return types.join() === 'array' && source.elementRank !== undefined
                ? { types, rank: source.elementRank, shape: Array(source.elementRank).fill(null) }
                : stableRecordField({ types });
        }
        if (parts.length === 3 && isLabelLiteral(parts[1]) && parts[1].name === 'flat'
            && isNameExpression(last) && ['json', 'xml'].includes(last.name)
            && lookup(last.name) === undefined && source.types.join() === 'text') {
            return { types: ['array'], rank: 1, shape: [null], elements: ['object'] };
        }
        if (parts.length === 2 && isNameExpression(last) && last.name === 'xml'
            && lookup(last.name) === undefined && source.types.join() === 'text') {
            return { types: ['object'] };
        }
        const combine = parts.length === 3 && isNameExpression(parts[1]) ? parts[1].name : undefined;
        if (combine && ['min', 'max', 'maxsum', 'band', 'bor', 'bxor'].includes(combine)
            && lookup(combine) === undefined
            && isNameExpression(last) && last.name === 'segment' && lookup('segment') === undefined
            && ['array', 'sequence'].includes(source.types.join()) && source.rank === 1
            && (source.eagerScalarCells || source.callbackFreeScalarCells)
            && source.elements?.length
            && source.elements.every(type => type === 'integer'
                || !['band', 'bor', 'bxor'].includes(combine) && type === 'real')) {
            return { types: ['segment'], elements: source.elements,
                segmentOperation: combine as 'min' | 'max' | 'maxsum' | 'band' | 'bor' | 'bxor' };
        }
        if (parts.length === 2 && source.types.join() === 'segment' && source.segmentOperation
            && source.elements?.length && expressionFacts(last, lookup).types.join() === 'integer') {
            return { types: source.elements, rank: 0, shape: [] };
        }
        const covarianceName = parts.length === 2 ? last : parts.length === 5 ? parts[1] : undefined;
        if (covarianceName && isNameExpression(covarianceName)
            && ['covariance', 'correlation', 'corr'].includes(covarianceName.name)
            && lookup(covarianceName.name) === undefined
            && (parts.length === 2 || isNameExpression(parts[2]) && parts[2].name === 'axis')
            && source.types.join() === 'array' && source.shape && source.shape.length >= 2
            && (source.eagerScalarCells || source.callbackFreeScalarCells)
            && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
            const axes = parts.length === 2 ? [source.shape.length - 2, source.shape.length - 1]
                : parts.slice(3).map(part => {
                    const value = expressionFacts(part, lookup).integer;
                    return value === undefined ? NaN : Number(value);
                });
            if (axes.every(axis => Number.isSafeInteger(axis) && axis >= 0 && axis < source.shape!.length)
                && axes[0] !== axes[1]) {
                const shape = [...source.shape.filter((_, axis) => !axes.includes(axis)),
                    source.shape[axes[0]], source.shape[axes[0]]];
                return { types: ['array'], rank: shape.length, shape,
                    elements: ['real'], callbackFreeScalarCells: true };
            }
        }
        if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'find'
            && lookup('find') === undefined && source.types.join() === 'dsu' && source.elements?.length) {
            return stableRecordField({ types: source.elements });
        }
        if (parts.length === 2 && source.types.join() === 'graph' && source.elements?.length
            && expressionFacts(parts[1], lookup).types.length) return {
            types: ['sequence'], rank: 1, shape: [null], elements: source.elements,
            callbackFreeScalarCells: true,
        };
        if (parts.length === 2 && source.types.join() === 'record' && isLabelLiteral(last)) {
            return source.fields?.[last.name] ?? UNKNOWN_VALUE;
        }
        if (parts.length === 4 && isNameExpression(parts[1]) && parts[1].name === 'len'
            && isNameExpression(parts[2]) && parts[2].name === 'axis'
            && lookup('len') === undefined && lookup('axis') === undefined
            && isNumberLiteral(parts[3]) && typeof parts[3].value === 'bigint'
            && source.types.join() === 'array' && source.rank !== undefined) {
            const axis = Number(parts[3].value);
            if (Number.isSafeInteger(axis) && axis >= 0 && axis < source.rank) {
                const dimension = source.shape?.[axis];
                return { types: ['integer'], rank: 0, shape: [],
                    ...(dimension === undefined || dimension === null ? {} : { integer: String(dimension) }) };
            }
        }
        if (source.types.join() === 'fenwick'
            && (parts.length === 2 || parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'sum')
            && expressionFacts(parts.at(-1)!, lookup).types.join() === 'integer') {
            return { types: ['integer'], rank: 0, shape: [] };
        }
        if (parts.length === 4 && isNameExpression(last) && last.name === 'outer'
            && lookup('outer') === undefined && isNameExpression(parts[2]) && lookup(parts[2].name) === undefined) {
            const operation = findOperation(parts[2].name);
            const right = expressionFacts(parts[1], lookup);
            const domain = operation?.scalarNoCallback;
            const safe = (value: ValueFacts) => (value.types.join() === 'array' || value.types.join() === 'sequence')
                && value.rank !== undefined && value.rank > 0 && !!value.shape
                && (value.eagerScalarCells || value.callbackFreeScalarCells)
                && !!value.elements?.length && value.elements.every(type => type === 'integer'
                    || domain === 'number' && type === 'real');
            if (domain && operation?.arities.includes(2) && !operation.effects?.length
                && operation.dyadicRanks?.[0] === 0 && operation.dyadicRanks[1] === 0
                && safe(source) && safe(right)) {
                const elements = resultTypes(operation);
                if (elements.length && elements.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))) {
                    return { types: ['array'], rank: source.rank! + right.rank!,
                        shape: [...source.shape!, ...right.shape!], elements,
                        callbackFreeScalarCells: true };
                }
            }
        }
        if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'sort'
            && lookup('sort') === undefined && isLabelLiteral(last)
            && (last.name === 'ascending' || last.name === 'descending')) {
            const sorted = sortedScalarArray(source);
            if (sorted) return sorted;
        }
        if (source.types.join() === 'index' && source.elements?.length && parts.length > 1
            && parts.slice(1).every(part => {
                const key = expressionFacts(part, lookup);
                return key.types.length > 0 && key.types.every(type =>
                    ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
            })) {
            const types = source.elements;
            return types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                ? { types, rank: 0, shape: [] } : { types };
        }
        if (isNameExpression(last) && lookup(last.name) === undefined) {
            const operation = findOperation(last.name);
            const arity = unaryTail ? 1 : parts.length - 1;
            if (operation?.arities.includes(arity)) {
                const operands = unaryTail ? [source] : parts.slice(0, -1).map(part => expressionFacts(part, lookup));
                if (arity === 1 && last.name === 'eigh' && source.types.join() === 'array'
                    && source.rank === 2 && source.shape?.length === 2
                    && (source.eagerScalarCells || source.callbackFreeScalarCells)
                    && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
                    const size = source.shape[0];
                    return { types: ['array'], rank: 1, shape: [2], elements: ['array'],
                        positionFacts: [
                            { types: ['array'], rank: 1, shape: [size], elements: ['real'], eagerScalarCells: true },
                            { types: ['array'], rank: 2, shape: [size, size], elements: ['real'], eagerScalarCells: true },
                        ], eagerScalarCells: true };
                }
                if (arity === 1 && last.name === 'functional') {
                    return { types: ['functional'], functionalWeighted: false };
                }
                if (arity === 2 && last.name === 'weighted') {
                    return { types: ['functional'], functionalWeighted: true };
                }
                if (arity === 3 && last.name === 'upto' && source.types.join() === 'functional') {
                    if (source.functionalWeighted === false) return { types: ['integer'], rank: 0, shape: [] };
                    if (source.functionalWeighted === true) return { types: ['record'], fields: {
                        count: { types: ['integer'], rank: 0, shape: [] },
                        sum: { types: ['integer', 'real'], rank: 0, shape: [] },
                        last: { types: ['integer'], rank: 0, shape: [] },
                    } };
                }
                if (arity === 3 && last.name === 'jump' && source.types.join() === 'functional') {
                    return { types: ['integer'], rank: 0, shape: [] };
                }
                if (arity === 3 && last.name === 'query' && source.types.join() === 'segment'
                    && source.segmentOperation && source.elements?.length) {
                    if (source.segmentOperation === 'maxsum') {
                        const field = { types: source.elements, rank: 0, shape: [] };
                        return { types: ['record'], fields: {
                            sum: field, prefix: field, suffix: field, best: field,
                        } };
                    }
                    return { types: source.elements, rank: 0, shape: [] };
                }
                if (arity === 1 && last.name === 'components' && source.types.join() === 'dsu') {
                    return { types: ['integer'], rank: 0, shape: [] };
                }
                if (arity === 2 && last.name === 'find' && source.types.join() === 'dsu'
                    && source.elements?.length) {
                    return stableRecordField({ types: source.elements });
                }
                if (arity === 3 && ['ancestor', 'lca'].includes(last.name) && source.types.join() === 'record'
                    && source.elements?.length) {
                    return stableRecordField({ types: source.elements });
                }
                if (arity === 2 && ['take', 'drop'].includes(last.name)
                    && operands[1].types.join() === 'integer' && operands[1].rank === 0
                    && (operands[1].integer === undefined || BigInt(operands[1].integer) >= 0n)) {
                    const size = source.shape?.[0];
                    const count = operands[1].integer;
                    const leading = size == null || count === undefined ? null
                        : Number(BigInt(count) < BigInt(size) ? BigInt(count) : BigInt(size));
                    const length = last.name === 'drop' && size != null && leading != null
                        ? size - leading : leading;
                    if (source.types.join() === 'text') return { types: ['text'], rank: 1, shape: [length] };
                    if (source.types.join() === 'sequence') return { types: ['sequence'], rank: 1,
                        shape: [length], elements: source.elements,
                        ...(source.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}) };
                    if (source.types.join() === 'array' && source.rank !== undefined && source.rank > 0) return {
                        types: ['array'], rank: source.rank,
                        shape: [length, ...(source.shape?.slice(1) ?? Array(source.rank - 1).fill(null))],
                        elements: source.elements,
                        ...(source.eagerScalarCells || source.callbackFreeScalarCells
                            ? { callbackFreeScalarCells: true as const } : {}),
                    };
                }
                if (operation.result === 'record'
                    && (operation.recordFields || operation.recordVertexArrays
                        || operation.recordVertexFields || operation.recordIndexValues)) {
                    const fields: Record<string, ValueFacts> = Object.fromEntries(Object.entries(operation.recordFields ?? {})
                        .map(([name, result]) => [name, { types: resultTypes({ result }),
                            ...(['integer', 'real', 'number', 'boolean'].includes(result)
                                ? { rank: 0, shape: [] } : {}) }]));
                    if (source.types.join() === 'graph' && source.elements?.length) {
                        for (const name of operation.recordVertexArrays ?? []) fields[name] = {
                            types: ['array'], rank: 1, shape: [null], elements: source.elements,
                            eagerScalarCells: true,
                        };
                        for (const name of operation.recordVertexFields ?? []) fields[name] =
                            stableRecordField({ types: source.elements });
                    }
                    for (const [name, kind] of Object.entries(operation.recordIndexValues ?? {})) fields[name] = {
                        types: ['index'],
                        ...(kind === 'vertices' ? source.elements?.length ? { elements: source.elements } : {}
                            : { elements: kind === 'integer' ? ['integer'] : ['integer', 'real'] }),
                    };
                    return { types: ['record'], fields,
                        ...(last.name === 'root' && source.types.join() === 'graph' && source.elements?.length
                            ? { elements: source.elements } : {}) };
                }
                if (operation.denseResult && resultTypes(operation).join() === 'array') return {
                    types: ['array'], rank: operation.denseResult.shape.length,
                    shape: operation.denseResult.shape, elements: operation.denseResult.elements,
                    eagerScalarCells: true,
                };
                if (arity === 1 && last.name === 'indices' && source.types.join() === 'array'
                    && source.rank === 1 && source.elements?.join() === 'boolean'
                    && (source.eagerScalarCells || source.callbackFreeScalarCells)) {
                    return { types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true };
                }
                if (arity === 2 && last.name === 'findall' && hasCallbackFreeFindProof(source, operands[1])) {
                    return { types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true };
                }
                if (arity === 1 && ['factors', 'divisors'].includes(last.name)
                    && source.rank === 0 && source.types.join() === 'integer') {
                    return { types: ['sequence'], elements: ['integer'], rank: 1,
                        shape: [null], callbackFreeScalarCells: true };
                }
                if (arity === 1 && last.name === 'permutations' && source.types.join() === 'text') {
                    return { types: ['sequence'], elements: ['text'], rank: 1, shape: [null],
                        callbackFreeScalarCells: true };
                }
                if (arity === 1 && last.name === 'sort') {
                    const sorted = sortedScalarArray(source);
                    if (sorted) return sorted;
                }
                if (arity === 1 && last.name === 'argsort'
                    && (source.types.join() === 'text' || source.types.join() === 'array'
                        && source.rank === 1 && (source.eagerScalarCells || source.callbackFreeScalarCells))) {
                    return { types: ['array'], rank: 1, shape: [source.shape?.[0] ?? null],
                        elements: ['integer'], eagerScalarCells: true };
                }
                if (arity === 1 && last.name === 'unique' && source.rank === 1
                    && ['array', 'sequence'].includes(source.types.join())
                    && (source.eagerScalarCells || source.callbackFreeScalarCells)
                    && source.elements?.length && source.elements.every(type =>
                        ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))) {
                    return { types: source.types, elements: source.elements, rank: 1,
                        shape: [null], ...(source.types.join() === 'array'
                            ? { eagerScalarCells: true as const } : { callbackFreeScalarCells: true as const }) };
                }
                if (last.name === 'text' && arity === 1 && source.rank === 0
                    && source.types.length > 0 && source.types.every(type =>
                        ['integer', 'real', 'boolean', 'symbol'].includes(type))) {
                    return { types: ['text'], rank: 1, shape: [null] };
                }
                if (arity === 1 && operation.preservesNumericScalarType && source.rank === 0
                    && source.types.length > 0
                    && source.types.every(type => type === 'integer' || type === 'real')) {
                    return { types: source.types, rank: 0, shape: [] };
                }
                if (hasScalarNoCallbackProof(operation, operands)) {
                    const types = resultTypes(operation);
                    if (types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol',
                        'date', 'datetime', 'duration'].includes(type))) {
                        return { types, rank: 0, shape: [] };
                    }
                }
                if (operation.scalarResult) return { types: resultTypes(operation), rank: 0, shape: [] };
                if (arity === 2 && last.name === 'startswith') {
                    const right = operands[1];
                    if (['text', 'bytes'].includes(source.types.join())
                        && right.types.join() === source.types.join()) {
                        return { types: ['boolean'], rank: 0, shape: [] };
                    }
                    const leftArray = source.types.join() === 'array';
                    const rightArray = right.types.join() === 'array';
                    if (leftArray || rightArray) {
                        const singleArray = leftArray !== rightArray;
                        const other = leftArray ? right : source;
                        const textCells = (value: ValueFacts): boolean => value.types.join() === 'text'
                            || value.types.join() === 'array' && value.elements?.join() === 'text'
                                && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true);
                        const shape = leftArray && rightArray
                            ? source.shape && right.shape && !incompatibleShapes(source, right)
                                ? broadcastShape(source.shape, right.shape) : undefined
                            : singleArray && other.types.length && !other.types.includes('array')
                                ? (leftArray ? source : right).shape : undefined;
                        return { types: ['array'], rank: shape?.length, shape,
                            ...(textCells(source) && textCells(right) ? { elements: ['boolean'] } : {}) };
                    }
                }
                if (last.name === 'sum' && arity === 1
                    && (['array', 'sequence'].includes(source.types.join())
                        && (source.eagerScalarCells || source.callbackFreeScalarCells)
                        || ['queue', 'stack', 'deque', 'set'].includes(source.types.join()))
                    && source.elements?.join() === 'integer') {
                    return { types: ['integer'], rank: 0, shape: [] };
                }
                if (arity === 1 && operation.selectsNumericCell
                    && ['queue', 'stack', 'deque', 'set'].includes(source.types.join())
                    && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
                    return { types: source.elements, rank: 0, shape: [] };
                }
                if (hasScalarCellArrayNoCallbackProof(operation, operands)) {
                    return { types: operation.selectsNumericCell ? source.elements! : resultTypes(operation),
                        rank: 0, shape: [] };
                }
                if (last.name === 'parse' && arity === 2 && operands[1].textLiteral !== undefined) {
                    const positions = parsePositions(operands[1].textLiteral);
                    if (positions) {
                        const elements = [...new Set(positions.flat())];
                        return { types: ['array'], rank: 1, shape: [positions.length], elements,
                            ...(elements.length > 1 ? { positions } : {}), eagerScalarCells: true };
                    }
                }
                if (last.name === 'shape' && arity === 1 && source.types.join() === 'array'
                    && source.rank !== undefined) return { types: ['array'], rank: 1, shape: [source.rank],
                    elements: ['integer'], eagerScalarCells: true,
                    ...(source.shape ? { integers: source.shape } : {}) };
                if (last.name === 'copy' && arity === 1 && source.types.join() === 'array'
                    && source.rank !== undefined && source.shape
                    && (source.eagerScalarCells || source.callbackFreeScalarCells)
                    && source.elements?.length && source.elements.every(type =>
                        ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))) {
                    return { types: ['array'], rank: source.rank, shape: source.shape,
                        elements: source.elements, eagerScalarCells: true };
                }
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
                            shape, elements: resultTypes(operation),
                            ...(hasNumericArrayNoCallbackProof(operation, operands)
                                ? { callbackFreeScalarCells: true as const } : {}) };
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
        const axisReduction = axisReductionForm(parts, name => lookup(name) === undefined);
        if (source.types.join() === 'array' && source.shape && axisReduction?.operation.name === 'sum') {
            const axes = axisReduction.axes.map(part => expressionFacts(part, lookup).integer);
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
        if (source.types.join() === 'array' && source.shape
            && axisReduction?.operation.module === 'stats' && axisReduction.operation.result === 'real'
            && (source.eagerScalarCells || source.callbackFreeScalarCells)
            && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
            const axes = axisReduction.axes.map(part => expressionFacts(part, lookup).integer);
            if (axes.length && axes.every(axis => axis !== undefined && Number.isSafeInteger(Number(axis))
                && Number(axis) >= 0 && Number(axis) < source.shape!.length)
                && new Set(axes).size === axes.length) {
                const shape = source.shape.filter((_, axis) => !axes.includes(String(axis)));
                return shape.length ? { types: ['array'], rank: shape.length, shape,
                    elements: ['real'], callbackFreeScalarCells: true }
                    : { types: ['real'], rank: 0, shape: [] };
            }
        }
        if (isNameExpression(last) && last.name === 'len' && lookup(last.name) === undefined
            && parts.length === 2 && (['array', 'bytes', 'text', 'queue', 'set', 'counter', 'deque', 'heap',
                'multiset', 'object', 'graph', 'dsu', 'segment', 'wavelet'].includes(source.types.join())
                || source.types.join() === 'sequence' && source.callbackFreeScalarCells === true)) {
            const length = ['array', 'text', 'sequence'].includes(source.types.join()) ? source.shape?.[0] : undefined;
            return { types: ['integer'], rank: 0, shape: [],
                ...(length !== undefined && length !== null ? { integer: String(length) } : {}) };
        }
        if (isNameExpression(last) && last.name === 'len' && lookup(last.name) === undefined
            && parts.length === 2) return { types: ['integer'], rank: 0, shape: [] };
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
            const pipedArguments = isApplicationExpression(expression.head) && expression.arguments.length === 1
                && lookup.arity?.(last.name) === expression.head.arguments.length + 1
                ? [expression.head.head, ...expression.head.arguments] : undefined;
            return lookup.invoke(last.name, pipedArguments
                ? pipedArguments.map(part => expressionFacts(part, lookup))
                : unaryTail ? [source] : parts.slice(0, -1).map(part => expressionFacts(part, lookup)));
        }
        if (isNameExpression(last) && lookup(last.name) === undefined) {
            if (last.name === 'window' && parts.length === 3 && source.rank === 1 && source.shape?.[0] != null) {
                const widthText = expressionFacts(parts[1], lookup).integer;
                const width = widthText === undefined ? NaN : Number(widthText);
                if (Number.isSafeInteger(width) && width > 0) {
                    const count = Math.max(0, source.shape[0] - width + 1);
                    if (source.types.join() === 'text') return { types: ['sequence'], elements: ['text'], rank: 1,
                        shape: [count], callbackFreeScalarCells: true };
                    if (['array', 'bytes', 'sequence'].includes(source.types.join())) return {
                        types: ['array'], elements: source.elements, rank: 2, shape: [count, width],
                        ...(source.eagerScalarCells || source.callbackFreeScalarCells
                            ? { callbackFreeScalarCells: true as const } : {}),
                    };
                }
            }
            if (last.name === 'reshape' && parts.length === 3) {
                const dimensions = expressionFacts(parts[1], lookup).integers;
                if (dimensions && dimensions.every(n => n === null || n >= 0)) return {
                    types: ['array'], elements: source.elements, rank: dimensions.length, shape: dimensions,
                    ...((source.eagerScalarCells || source.callbackFreeScalarCells)
                        && source.elements?.length && source.elements.every(type =>
                            ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))
                        ? { eagerScalarCells: true as const } : {}),
                };
            }
        }
        if (parts.length === 2 && source.types.join() === 'text'
            && expressionFacts(parts[1], lookup).types.join() === 'integer') {
            return { types: ['text'], rank: 1, shape: [1] };
        }
        if (parts.length === 2 && source.types.join() === 'counter'
            && expressionFacts(parts[1], lookup).types.length > 0) {
            return { types: ['integer'], rank: 0, shape: [] };
        }
        if (source.types.join() === 'array' && source.shape && parts.length - 1 <= source.shape.length) {
            const selectors = parts.slice(1).map(part => isAllAxisExpression(part)
                ? undefined : expressionFacts(part, lookup));
            const integerVector = (value: ValueFacts | undefined): boolean => !!value
                && ['array', 'sequence'].includes(value.types.join()) && value.rank === 1
                && value.elements?.join() === 'integer'
                && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true);
            if (selectors.some(integerVector) && parts.slice(1).every((part, index) =>
                isAllAxisExpression(part) || selectors[index]?.rank === 0
                    && selectors[index]?.types.join() === 'integer' || integerVector(selectors[index]))) {
                const shape = source.shape.flatMap((dimension, axis) => {
                    const selector = selectors[axis];
                    if (selector?.rank === 0 && selector.types.join() === 'integer') return [];
                    return [integerVector(selector) ? selector?.shape?.[0] ?? null : dimension];
                });
                return { types: ['array'], rank: shape.length, shape, elements: source.elements,
                    ...((source.eagerScalarCells || source.callbackFreeScalarCells)
                        ? { callbackFreeScalarCells: true as const } : {}) };
            }
        }
        if (parts.length === 2 && ['array', 'queue', 'sequence'].includes(
            expressionFacts(parts[1], lookup).types.join())) {
            if (source.types.join() === 'text') return { types: ['text'], rank: 1, shape: [null] };
            if (source.types.join() === 'array' && source.rank !== undefined && source.rank > 0) {
                const shape = source.shape?.slice() ?? Array(source.rank).fill(null);
                shape[0] = null;
                return { types: ['array'], rank: source.rank, shape,
                    ...(source.eagerScalarCells || source.callbackFreeScalarCells
                        ? { elements: source.elements, callbackFreeScalarCells: true as const } : {}) };
            }
            if (source.types.join() === 'sequence' || source.types.join() === 'queue') return {
                types: ['array'], rank: 1, shape: [null], elements: source.elements,
            };
        }
        // Only plain scalar and whole-axis addressing is proven here.
        if (source.types.length === 1 && ['array', 'bytes', 'sequence'].includes(source.types[0])
            && (source.types[0] !== 'sequence' || source.callbackFreeScalarCells) && source.shape
            && parts.slice(1).every(part => isAllAxisExpression(part)
                || expressionFacts(part, lookup).types.join() === 'integer')
            && parts.length - 1 <= source.shape.length) {
            const shape = source.shape.filter((_, index) => index >= parts.length - 1 || isAllAxisExpression(parts[index + 1]));
            if (shape.length) return { types: source.types, elements: source.elements, rank: shape.length, shape,
                ...(source.eagerScalarCells || source.callbackFreeScalarCells
                    ? { callbackFreeScalarCells: true as const } : {}) };
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

function parsePositions(format: string): Types[] | undefined {
    const positions: Types[] = [];
    const directivePattern = /\/(integer|real|word|text)/y;
    for (let index = 0; index < format.length;) {
        if (format[index] !== '/') { index++; continue; }
        if (format[index + 1] === '/') { index += 2; continue; }
        directivePattern.lastIndex = index;
        const directive = directivePattern.exec(format);
        if (!directive) return undefined;
        positions.push([directive[1] === 'word' || directive[1] === 'text' ? 'text' : directive[1]]);
        index += directive[0].length;
    }
    return positions;
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
    const elements = values.every(value => value.elements !== undefined
        && (value.elements.length > 0 || types.join() === 'index'))
        ? [...new Set(values.flatMap(value => value.elements!))] : undefined;
    const elementRank = elements?.join() === 'array' && values.every(value => value.elementRank === first.elementRank)
        ? first.elementRank : undefined;
    const positions = first.positions && values.every(value => value.positions?.length === first.positions!.length)
        ? first.positions.map((_, index) => values.every(value => value.positions![index].length)
            ? [...new Set(values.flatMap(value => value.positions![index]))] : []) : undefined;
    const fields = types.join() === 'record' && first.fields
        ? Object.fromEntries(Object.keys(first.fields).filter(name => values.every(value => value.fields?.[name]))
            .map(name => [name, joinValueFacts(values.map(value => value.fields![name]))])) : undefined;
    return { types, ...(rank !== undefined ? { rank } : {}), ...(shape ? { shape } : {}),
        ...(types.join() === 'boolean' && first.boolean !== undefined
            && values.every(value => value.boolean === first.boolean) ? { boolean: first.boolean } : {}),
        ...(first.functionalWeighted !== undefined
            && values.every(value => value.functionalWeighted === first.functionalWeighted)
            ? { functionalWeighted: first.functionalWeighted } : {}),
        ...(first.segmentOperation && values.every(value => value.segmentOperation === first.segmentOperation)
            ? { segmentOperation: first.segmentOperation } : {}),
        ...(elements ? { elements } : {}),
        ...(elementRank !== undefined ? { elementRank } : {}),
        ...(positions ? { positions } : {}),
        ...(fields ? { fields } : {}),
        ...(first.textLiteral !== undefined && values.every(value => value.textLiteral === first.textLiteral)
            ? { textLiteral: first.textLiteral } : {}),
        ...(values.every(value => value.eagerScalarCells) ? { eagerScalarCells: true as const }
            : values.every(value => value.eagerScalarCells || value.callbackFreeScalarCells)
                ? { callbackFreeScalarCells: true as const } : {}) };
}
