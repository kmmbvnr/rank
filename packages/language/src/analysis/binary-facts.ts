import type { BinaryExpression, Expression } from '../generated/ast.js';
import { rangeSliceOperands } from '../expressions.js';
import { applicationForm, type ApplicationForm } from '../application-forms.js';
import { findOperation } from '../operations.js';
import { binaryType, type Types } from './types.js';
import { broadcastShape, incompatibleShapes, isAtom,
    type FactLookup, type ValueFacts } from './value-domain.js';

/** Transfer existing facts through a binary expression without executing it. */
export function binaryExpressionFacts(
    expression: BinaryExpression, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts,
): ValueFacts | undefined {
    const symbolic = applicationForm(expression, name => lookup(name) ? false : findOperation(name));
    const transferred = symbolicFormFacts(symbolic, lookup, infer);
    if (transferred) return transferred;
    if (symbolic?.kind === 'outer'
        && ['+', '-', '*', '/', '//', '%', '**'].includes(symbolic.operator)) {
        if (symbolic.operands.length === 2) {
            const left = infer(symbolic.operands[0], lookup);
            const right = infer(symbolic.operands[1], lookup);
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
    const left = infer(expression.left, lookup);
    const right = infer(expression.right, lookup);
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
        const stepText = expression.step ? infer(expression.step, lookup).integer : '1';
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
        const inferred = binaryType(expression.operator, left.types, right.types);
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
    return undefined;
}

/** Transfer a classified modifier independently of the source spelling. */
export function symbolicFormFacts(symbolic: ApplicationForm, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts): ValueFacts | undefined {
    if (symbolic?.kind === 'segment' && symbolic.operator === '+') {
        const values = infer(symbolic.source, lookup);
        if (['array', 'sequence'].includes(values.types.join()) && values.rank === 1
            && (values.eagerScalarCells || values.callbackFreeScalarCells)
            && values.elements?.length
            && values.elements.every(type => type === 'integer' || type === 'real')) {
            return { types: ['segment'], elements: values.elements, segmentOperation: '+' };
        }
    }
    if (symbolic?.kind === 'scan' && ['+', '*'].includes(symbolic.operator)) {
        const source = infer(symbolic.source, lookup);
        const seed = symbolic.seed && infer(symbolic.seed, lookup);
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
    if (symbolic?.kind === 'reduce' && ['+', '*'].includes(symbolic.operator)
        && symbolic.seed === undefined && symbolic.rank === undefined) {
        const source = infer(symbolic.source, lookup);
        if (['array', 'sequence'].includes(source.types.join()) && source.rank !== undefined
            && source.rank > 0 && (source.eagerScalarCells || source.callbackFreeScalarCells)
            && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
            return { types: source.elements.join() === 'integer' ? ['integer'] : ['integer', 'real'],
                rank: 0, shape: [] };
        }
    }
    return undefined;
}

/** `Values (Start until End)`: a contiguous run along one axis keeps the source's kind and cells. */
export function sliceFacts(
    expression: Expression, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts,
): ValueFacts | undefined {
    const slice = rangeSliceOperands(expression);
    if (slice) {
        const source = infer(slice.source, lookup);
        const kind = source.types.join();
        if (kind === 'array' || kind === 'text' || kind === 'sequence' || kind === 'queue') {
            const axis = Number(slice.axis);
            const start = infer(slice.start, lookup).integer;
            const end = infer(slice.end, lookup).integer;
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
        return undefined;
    }
    return undefined;
}
