import { freshDim } from './shape-index.js';
import {
    isApplicationExpression, isArrayExpression, isBinaryExpression, isBooleanLiteral, isMaterializeExpression,
    isFirstIndexWhereExpression, isFirstWhereExpression, isLabelLiteral, isNameExpression, isNewStructureExpression,
    isNumberLiteral,
    isParenthesizedExpression, isRecordExpression, isRecordUpdateExpression, isStdinExpression, isStringLiteral,
    isTableFilterExpression,
    isBoundClauseExpression, isCountClauseExpression, isKeyedSortExpression, isUnaryExpression,
    type Expression,
} from '../generated/ast.js';
import { localCollectionType, resultTypes, typeOf } from './types.js';
import { findOperation } from '../operations.js';
import { applicationExpressionFacts, takeDropFacts } from './application-facts.js';
import { callbackFreeCondition, sliceFacts } from './binary-facts.js';
import { binaryExpressionFacts } from './binary-facts.js';
import { isAtom, stableRecordField, TRACKED_COLLECTIONS, UNKNOWN_VALUE, BOTTOM_VALUE,
    type FactLookup, type ValueFacts } from './value-domain.js';

/** Start with facts that follow directly from syntax, retaining unknown lengths. */
export function expressionFacts(expression: Expression, lookup: FactLookup): ValueFacts {
    let unobserved = false;
    const observe = (value: ValueFacts | undefined): ValueFacts | undefined => {
        unobserved ||= value?.bottom === true;
        return value;
    };
    const tracked: FactLookup = Object.assign((name: string) => observe(lookup(name)), {
        arity: lookup.arity,
        ...(lookup.invoke ? { invoke: (name: string, inputs: readonly ValueFacts[]) =>
            observe(lookup.invoke!(name, inputs))! } : {}),
    });
    const result = evaluateFacts(expression, tracked);
    return unobserved ? BOTTOM_VALUE : result;
}

function evaluateFacts(expression: Expression, lookup: FactLookup): ValueFacts {
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
                    ...(builtin.name === 'infinity' ? { infinite: true as const } : {}),
                } : builtin ? { types: [], builtinOperation: builtin.name } : UNKNOWN_VALUE);
    }
    if (isNewStructureExpression(expression) && expression.structure === 'index') {
        return { types: ['index'], elements: [] };
    }
    if (isNewStructureExpression(expression) && TRACKED_COLLECTIONS.includes(expression.structure)) {
        return { types: [expression.structure], elements: [] };
    }
    if (isNumberLiteral(expression)) return {
        types: [typeof expression.value === 'bigint' ? 'integer' : 'real'], rank: 0, shape: [],
        ...(typeof expression.value === 'bigint' ? { integer: String(expression.value) } : {}),
    };
    if (isLabelLiteral(expression)) return { types: [expression.name === 'NA' ? 'missing' : 'symbol'], rank: 0, shape: [] };
    if (isStdinExpression(expression)) {
        const elements = expression.mode.name === 'integer' ? ['integer']
            : expression.mode.name === 'word' ? ['text'] : [];
        if (!elements.length) return UNKNOWN_VALUE;
        if (expression.count) {
            const counted = expressionFacts(expression.count, lookup);
            const size = counted.integer === undefined ? NaN : Number(counted.integer);
            const known = Number.isSafeInteger(size) && size >= 0;
            // The declared count is the length; a symbolic count keeps its symbol.
            return { types: ['sequence'], rank: 1, shape: [known ? size : null],
                ...(!known && counted.dim ? { dims: [counted.dim] } : {}),
                ...(elements.length ? { elements } : {}) };
        }
        return elements.join() === 'integer' ? { types: elements, rank: 0, shape: [], dim: freshDim('in') }
            : elements.join() === 'text' ? { types: elements, rank: 1, shape: [null] } : UNKNOWN_VALUE;
    }
    // Runtime rank is one for text, although arithmetic treats the whole text as an atom.
    if (isStringLiteral(expression)) return { types: ['text'], rank: 1,
        shape: [[...expression.value].length], textLiteral: expression.value };
    if (isBooleanLiteral(expression)) return { types: ['boolean'], rank: 0, shape: [], boolean: expression.value };
    if (isRecordExpression(expression)) return { types: ['record'], rank: 0, shape: [], closedRecord: true,
        fields: Object.fromEntries(expression.fields.map(field =>
            [field.name, stableRecordField(expressionFacts(field.value, lookup), true)])) };
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
        if (operand.integer !== undefined) return { ...operand, interval: undefined,
            integer: String(BigInt(operand.integer) * (expression.operator === '-' ? -1n : 1n)) };
        if (operand.rank === 0 && operand.types.length > 0
            && operand.types.every(type => type === 'integer' || type === 'real')) {
            return { types: operand.types, rank: 0, shape: [], ...(operand.infinite ? { infinite: true as const } : {}) };
        }
        if (operand.types.join() === 'array' || operand.types.join() === 'sequence') return {
            types: operand.types, rank: operand.rank, shape: operand.shape, elements: operand.elements,
        };
    }
    if (isArrayExpression(expression)) {
        if (expression.range) {
            const rangeFact = expressionFacts(expression.range, lookup);
            const elements = rangeFact.elements ?? ['integer'];
            if (expression.dimensions.length) {
                const shape = expression.dimensions.map(item => {
                    const fact = expressionFacts(item.value, lookup);
                    if (fact.integer === undefined || item.sign === '-') return null;
                    const size = Number(fact.integer);
                    return Number.isSafeInteger(size) && size >= 0 ? size : null;
                });
                return {
                    types: ['array'],
                    rank: shape.length,
                    shape,
                    elements,
                    eagerScalarCells: true as const,
                };
            }
            return {
                types: ['array'],
                rank: 1,
                shape: rangeFact.shape ?? [null],
                elements,
                eagerScalarCells: true as const,
            };
        }
        if (expression.dimensions.length) {
            const only = expression.dimensions.length === 1 ? expressionFacts(expression.dimensions[0]!.value, lookup) : undefined;
            if (only?.types.join() === 'array') {
                // `array shape Shape fill X`: a vector of dimensions, so the rank is the vector's length.
                const rank = only.shape?.length === 1 ? only.shape[0] : null;
                const fill = expression.fill && expressionFacts(expression.fill, lookup);
                const elements = fill && isAtom(fill) ? fill.types : undefined;
                return { types: ['array'], ...(rank === null || rank === undefined ? {}
                    : { rank, shape: Array<number | null>(rank).fill(null) }),
                    ...(elements ? { elements } : {}) };
            }
            const dimensionFacts = expression.dimensions.map(item => expressionFacts(item.value, lookup));
            const shape = expression.dimensions.map((item, axis) => {
                const fact = dimensionFacts[axis];
                if (fact.integer === undefined || item.sign === '-') return null;
                const size = Number(fact.integer);
                return Number.isSafeInteger(size) && size >= 0 ? size : null;
            });
            const dims = expression.dimensions.map((item, axis) =>
                shape[axis] === null && item.sign !== '-' ? dimensionFacts[axis].dim ?? null : null);
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
                ...(dims.some(Boolean) ? { dims } : {}),
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
                    ? { eagerScalarCells: true as const } : {}) }
            : source.types.length === 1 && source.types[0] === 'queue'
                ? { types: ['array'], rank: 1, shape: [null] } : { types: ['array'] };
    }
    if (isKeyedSortExpression(expression) && /^sort\s+by$/.test(expression.operator) && expression.fields.length) {
        // Sorting reorders the records without changing them, so the schema survives
        // once every sort field is a proven field of it.
        const source = expressionFacts(expression.source, lookup);
        const kind = source.types.join();
        const fields = source.elementRecord?.fields;
        if (['queue', 'deque', 'stack', 'array'].includes(kind) && source.elements?.join() === 'record'
            && fields && expression.fields.every(item => fields[item.field.name])
            && (kind !== 'array' || source.rank === 1)) {
            return { types: ['array'], rank: 1, shape: [kind === 'array' ? source.shape?.[0] ?? null : null],
                elements: ['record'], elementRecord: source.elementRecord };
        }
        return { types: ['array'] };
    }
    if (isFirstIndexWhereExpression(expression)) return { types: ['integer'], rank: 0, shape: [] };
    if (isTableFilterExpression(expression) && !expression.sourceFields.length) {
        const source = expressionFacts(expression.source, lookup);
        if (source.types.join() === 'array' && source.rank === 1) return {
            types: ['array'], rank: 1, shape: [null],
        };
    }
    if (isCountClauseExpression(expression)) {
        const facts = takeDropFacts(expressionFacts(expression.source, lookup),
            expressionFacts(expression.count, lookup), expression.operator === 'drop');
        if (facts) return facts;
        return UNKNOWN_VALUE;
    }
    if (isBoundClauseExpression(expression)) {
        // A bound keeps a run of the source's own items.
        const source = expressionFacts(expression.source, lookup);
        if (source.types.join() === 'text') return { types: ['text'], rank: 1, shape: [null] };
        if (source.types.join() === 'queue') return { types: ['array'], rank: 1, shape: [null] };
        if (source.rank === 1 && ['array', 'sequence'].includes(source.types.join())) {
            const safe = source.elements?.length && (source.eagerScalarCells || source.callbackFreeScalarCells)
                && callbackFreeCondition(expression.condition, lookup, expressionFacts);
            return { types: source.types, rank: 1, shape: [null],
                ...(safe ? { elements: source.elements, callbackFreeScalarCells: true as const } : {}) };
        }
        return UNKNOWN_VALUE;
    }
    if (isFirstWhereExpression(expression)) {
        const source = expressionFacts(expression.source, lookup);
        if (source.types.join() === 'text') return { types: ['text'], rank: 1, shape: [1] };
        const safeSource = source.rank === 1 && source.elements?.length
            && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))
            && (source.eagerScalarCells || source.callbackFreeScalarCells);
        if (safeSource && callbackFreeCondition(expression.mask, lookup, expressionFacts)
            && ['array', 'sequence'].includes(source.types.join())) {
            return source.elements!.join() === 'text'
                ? { types: ['text'], rank: 1, shape: [null] }
                : { types: source.elements!, rank: 0, shape: [] };
        }
        return UNKNOWN_VALUE;
    }
    if (isBinaryExpression(expression)) {
        const binary = binaryExpressionFacts(expression, lookup, expressionFacts);
        if (binary) return binary;
    }
    if (isApplicationExpression(expression)) {
        const slice = sliceFacts(expression, lookup, expressionFacts);
        if (slice) return slice;
        const application = applicationExpressionFacts(expression, lookup, expressionFacts);
        if (application) return application;
    }
    return { types: typeOf(expression, name => lookup(name)?.types) };
}
