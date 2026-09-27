import {
    isAllAxisExpression, isApplicationExpression, isLabelLiteral, isNameExpression, isNewStructureExpression,
    isNumberLiteral, isStringLiteral, type ApplicationExpression, type Expression,
} from '../generated/ast.js';
import { flattenApplication, groupedUnaryDyadicChain } from '../expressions.js';
import { findOperation } from '../operations.js';
import { axisLengthForm, axisReductionForm, explicitNamedOuterApplication,
    explicitNamedSegmentApplication, sortDirectionForm } from '../application-forms.js';
import { mapsScalarCells, resultTypes, type Types } from './types.js';
import { broadcastShape, incompatibleShapes, stableRecordField, UNKNOWN_VALUE,
    type FactLookup, type ValueFacts } from './value-domain.js';
import {
    hasCallbackFreeFindProof, hasMappedScalarNoCallbackProof,
    hasNumericArrayNoCallbackProof, hasScalarCellArrayNoCallbackProof, hasScalarNoCallbackProof,
} from './operation-proofs.js';

function sortedScalarArray(source: ValueFacts): ValueFacts | undefined {
    if (source.types.join() !== 'array' || source.rank !== 1 || !source.shape
        || !(source.eagerScalarCells || source.callbackFreeScalarCells)
        || !source.elements?.length || !source.elements.every(type => type === 'integer' || type === 'real')) return;
    return { types: ['array'], rank: 1, shape: source.shape,
        elements: source.elements, eagerScalarCells: true };
}

/** Transfer facts through a flattened application and its standard-operation contract. */
export function applicationExpressionFacts(
    expression: ApplicationExpression, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts,
): ValueFacts | undefined {
    const ranked = flattenApplication(expression);
    if (ranked.length === 2 && isNewStructureExpression(ranked[0]) && ranked[0].structure === 'dsu') {
        const values = infer(ranked[1], lookup);
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
        const vertices = infer(ranked[1], lookup);
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
        const source = infer(ranked[0], lookup);
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
        const source = infer(expression.head.head.head, lookup);
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
    if (grouped) return infer(grouped, lookup);
    const flattened = flattenApplication(expression);
    let parts = flattened;
    if (flattened.length > 2 && isLabelLiteral(flattened[1])
        && infer(flattened[0], lookup).fields?.[flattened[1].name]) {
        let prefix: Expression = expression;
        while (isApplicationExpression(prefix) && flattenApplication(prefix).length > 2) {
            prefix = prefix.head;
        }
        if (isApplicationExpression(prefix)) parts = [prefix, ...flattened.slice(2)];
    }
    const last = parts.at(-1)!;
    if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'from') {
        const source = infer(parts[0], lookup);
        const limit = infer(parts[2], lookup);
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
    const source = infer(unaryTail ? expression.head : parts[0], lookup);
    if (parts.length === 2 && source.types.join() === 'array' && source.rank === 1 && source.shape) {
        const fields = infer(parts[1], lookup);
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
    const namedSegment = explicitNamedSegmentApplication(parts);
    const combine = parts.length === 3 && namedSegment && isNameExpression(namedSegment.operation)
        ? namedSegment.operation.name : undefined;
    if (combine && ['min', 'max', 'maxsum', 'band', 'bor', 'bxor'].includes(combine)
        && lookup(combine) === undefined
        && lookup('segment') === undefined
        && ['array', 'sequence'].includes(source.types.join()) && source.rank === 1
        && (source.eagerScalarCells || source.callbackFreeScalarCells)
        && source.elements?.length
        && source.elements.every(type => type === 'integer'
            || !['band', 'bor', 'bxor'].includes(combine) && type === 'real')) {
        return { types: ['segment'], elements: source.elements,
            segmentOperation: combine as 'min' | 'max' | 'maxsum' | 'band' | 'bor' | 'bxor' };
    }
    if (parts.length === 2 && source.types.join() === 'segment' && source.segmentOperation
        && source.elements?.length && infer(last, lookup).types.join() === 'integer') {
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
                const value = infer(part, lookup).integer;
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
        && infer(parts[1], lookup).types.length) return {
        types: ['sequence'], rank: 1, shape: [null], elements: source.elements,
        callbackFreeScalarCells: true,
    };
    if (parts.length === 2 && source.types.join() === 'record' && isLabelLiteral(last)) {
        return source.fields?.[last.name] ?? UNKNOWN_VALUE;
    }
    const axisLength = axisLengthForm(parts, name => lookup(name) === undefined);
    if (axisLength && isNumberLiteral(axisLength.axis) && typeof axisLength.axis.value === 'bigint'
        && source.types.join() === 'array' && source.rank !== undefined) {
        const axis = Number(axisLength.axis.value);
        if (Number.isSafeInteger(axis) && axis >= 0 && axis < source.rank) {
            const dimension = source.shape?.[axis];
            return { types: ['integer'], rank: 0, shape: [],
                ...(dimension === undefined || dimension === null ? {} : { integer: String(dimension) }) };
        }
    }
    if (source.types.join() === 'fenwick'
        && (parts.length === 2 || parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'sum')
        && infer(parts.at(-1)!, lookup).types.join() === 'integer') {
        return { types: ['integer'], rank: 0, shape: [] };
    }
    const namedOuter = explicitNamedOuterApplication(parts);
    if (namedOuter && lookup('outer') === undefined
        && isNameExpression(namedOuter.operation) && lookup(namedOuter.operation.name) === undefined) {
        const operation = findOperation(namedOuter.operation.name);
        const right = infer(namedOuter.right, lookup);
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
    const sortDirection = sortDirectionForm(parts, name => lookup(name) === undefined);
    if (parts.length === 3 && sortDirection?.operation.name === 'sort'
        && isLabelLiteral(sortDirection.direction)
        && (sortDirection.direction.name === 'ascending' || sortDirection.direction.name === 'descending')) {
        const sorted = sortedScalarArray(source);
        if (sorted) return sorted;
    }
    if (source.types.join() === 'index' && source.elements?.length && parts.length > 1
        && parts.slice(1).every(part => {
            const key = infer(part, lookup);
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
            const operands = unaryTail ? [source] : parts.slice(0, -1).map(part => infer(part, lookup));
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
                const right = infer(parts[1], lookup);
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
        const axes = axisReduction.axes.map(part => infer(part, lookup).integer);
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
        const axes = axisReduction.axes.map(part => infer(part, lookup).integer);
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
        const other = infer(parts[1], lookup);
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
            ? pipedArguments.map(part => infer(part, lookup))
            : unaryTail ? [source] : parts.slice(0, -1).map(part => infer(part, lookup)));
    }
    if (isNameExpression(last) && lookup(last.name) === undefined) {
        if (last.name === 'window' && parts.length === 3 && source.rank === 1 && source.shape?.[0] != null) {
            const widthText = infer(parts[1], lookup).integer;
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
            const dimensions = infer(parts[1], lookup).integers;
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
        && infer(parts[1], lookup).types.join() === 'integer') {
        return { types: ['text'], rank: 1, shape: [1] };
    }
    if (parts.length === 2 && source.types.join() === 'counter'
        && infer(parts[1], lookup).types.length > 0) {
        return { types: ['integer'], rank: 0, shape: [] };
    }
    if (source.types.join() === 'array' && source.shape && parts.length - 1 <= source.shape.length) {
        const selectors = parts.slice(1).map(part => isAllAxisExpression(part)
            ? undefined : infer(part, lookup));
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
        infer(parts[1], lookup).types.join())) {
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
            || infer(part, lookup).types.join() === 'integer')
        && parts.length - 1 <= source.shape.length) {
        const shape = source.shape.filter((_, index) => index >= parts.length - 1 || isAllAxisExpression(parts[index + 1]));
        if (shape.length) return { types: source.types, elements: source.elements, rank: shape.length, shape,
            ...(source.eagerScalarCells || source.callbackFreeScalarCells
                ? { callbackFreeScalarCells: true as const } : {}) };
        if (source.elements?.join() === 'text') return { types: ['text'], rank: 1, shape: [null] };
        return source.elements?.length && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
            ? { types: source.elements, rank: 0, shape: [] } : { types: source.elements ?? [] };
    }
    return undefined;
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
