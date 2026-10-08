import { inferSignatureResultTypes } from '../signature-matching.js';
import type { SignatureAtom } from '../type-signature.js';
import { rankedFunctionFacts } from './ranked-function-facts.js';
import { joinValueFacts } from './value-domain.js';
import { diagonalResultShape } from '../shape-signature.js';
import { operationShapeFacts, rankedOperandShapes } from './operation-shape.js';
import { freshDim } from './shape-index.js';
import { symbolicFormFacts } from './binary-facts.js';
import {
    isAllAxisExpression, isApplicationExpression, isLabelLiteral, isNameExpression, isNewStructureExpression,
    isNumberLiteral, isStringLiteral, isUnpackExpression, type ApplicationExpression, type Expression,
} from '../generated/ast.js';
import { applicationExpression, flattenApplication, groupedUnaryDyadicChain, unaryApplicationHead } from '../expressions.js';
import { findOperation } from '../operations.js';
import { applicationForm, assertNever, type ApplicationForm } from '../application-forms.js';
import { mapsScalarCells, resultTypes, type Types } from './types.js';
import { broadcastShape, incompatibleShapes, isAtom, stableRecordField, UNKNOWN_VALUE,
    type FactLookup, type ValueFacts } from './value-domain.js';
import {
    hasCallbackFreeFindProof, hasMappedScalarNoCallbackProof,
    hasNumericArrayNoCallbackProof, hasScalarCellArrayNoCallbackProof, hasScalarNoCallbackProof,
} from './operation-proofs.js';

/**
 * Answers to structure queries (`Bag floor Q`, `Dsu Q findroot`): their ranks are `all 0`, so one
 * query gives one element and an array of queries gives an array of elements in the same shape.
 */
function perQueryFacts(query: ValueFacts, elements: Types): ValueFacts {
    if (query.types.join() === 'array' && query.rank !== undefined) {
        return { types: ['array'], rank: query.rank, shape: query.shape ?? Array(query.rank).fill(null), elements };
    }
    return isAtom(query) ? stableRecordField({ types: elements }) : UNKNOWN_VALUE;
}

function multisetMethodFacts(form: Extract<ApplicationForm, { kind: 'multiset-method' }>, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts): ValueFacts {
    if (!form.receiver.length || !form.argument.length) return UNKNOWN_VALUE;
    const receiver = infer(applicationExpression(form.receiver), lookup);
    if (receiver.types.join() !== 'multiset' || !receiver.elements?.length) return UNKNOWN_VALUE;
    return perQueryFacts(infer(applicationExpression(form.argument), lookup), receiver.elements);
}

/** Cell types a scalar or array operand can contribute to a mask selection. */
function selectedCells(value: ValueFacts): Types | undefined {
    const cells = value.rank === 0 ? value.types : value.types.join() === 'array' ? value.elements : undefined;
    return cells?.length && cells.every(type => type === 'integer' || type === 'real') ? cells : undefined;
}

/**
 * Scalar choose keeps the selected branch facts; an array mask keeps the broadcast shape
 * and the numeric cell types either branch can supply.
 */
function chooseFacts(mask: ValueFacts, then: ValueFacts, otherwise: ValueFacts): ValueFacts | undefined {
    const operands = [mask, then, otherwise];
    if (mask.types.join() === 'boolean' && mask.rank === 0) {
        return mask.boolean === undefined ? joinValueFacts([then, otherwise])
            : mask.boolean ? then : otherwise;
    }
    if (mask.types.join() !== 'array' || !mask.rank || mask.elements?.join() !== 'boolean') return;
    const thenCells = selectedCells(then);
    const otherCells = selectedCells(otherwise);
    if (!thenCells || !otherCells || operands.some(operand => operand.rank === undefined)) return;
    let shape: (number | null)[] = [];
    for (const operand of operands) {
        const next = operand.shape ?? Array(operand.rank!).fill(null);
        if (incompatibleShapes({ types: ['array'], shape }, { types: ['array'], shape: next })) return;
        shape = broadcastShape(shape, next);
    }
    return { types: ['array'], rank: shape.length, shape, elements: [...new Set([...thenCells, ...otherCells])] };
}

function sortedScalarArray(source: ValueFacts): ValueFacts | undefined {
    if (source.types.join() !== 'array' || source.rank !== 1 || !source.shape
        || !(source.eagerScalarCells || source.callbackFreeScalarCells)
        || !source.elements?.length || !source.elements.every(type => type === 'integer' || type === 'real')) return;
    const shaped = operationShapeFacts(findOperation('sort')!, [source]);
    return shaped ? { ...shaped, elements: source.elements, eagerScalarCells: true } : undefined;
}

function mergedSequenceFacts(operands: readonly ValueFacts[]): ValueFacts {
    const cells = operands[0]?.elements;
    const sameCells = cells?.length && operands.every(value => value.elements?.join() === cells.join());
    const collections = operands.every(value => ['array', 'sequence'].includes(value.types.join()));
    const rows = operands.length === 2 && operands.every(value => value.rank === 1)
        || operands.length === 1 && operands[0].types.join() === 'array' && operands[0].rank === 2;
    return { types: ['sequence'], rank: 1, shape: [null],
        ...(collections && rows && sameCells ? { elements: cells,
            ...(cells.every(type => ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))
                && operands.every(value => value.eagerScalarCells || value.callbackFreeScalarCells)
                ? { callbackFreeScalarCells: true as const } : {}) } : {}) };
}

function windowFacts(form: Extract<ApplicationForm, { kind: 'window' }>, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts): ValueFacts {
    const source = infer(form.source, lookup);
    const sizes = form.dimensions.map(part => infer(isUnpackExpression(part) ? part.value : part, lookup));
    const widths = form.dimensions.length === 1 && !isUnpackExpression(form.dimensions[0])
        ? sizes[0].integer !== undefined ? [Number(sizes[0].integer)] : sizes[0].integers
        : form.dimensions.flatMap((part, index) => isUnpackExpression(part)
            ? sizes[index].integers ?? Array(sizes[index].shape?.[0] ?? 0).fill(null)
            : [sizes[index].integer === undefined ? null : Number(sizes[index].integer)]);
    const axes = form.axes ?? (source.rank === undefined ? undefined
        : Array.from({ length: source.rank }, (_, axis) => axis));
    if (!axes || source.rank === undefined || axes.some(axis => axis < 0 || axis >= source.rank!))
        return UNKNOWN_VALUE;
    const geometry = (value: Expression | undefined, fallback: number): (number | null)[] => {
        if (!value) return axes.map(() => fallback);
        const fact = infer(value, lookup);
        if (fact.integer !== undefined) return axes.map(() => Number(fact.integer));
        return fact.integers?.length === axes.length ? [...fact.integers] : axes.map(() => null);
    };
    if (widths && widths.length !== axes.length) return UNKNOWN_VALUE;
    const cellWidths = widths ?? axes.map(() => null);
    const strides = geometry(form.stride, 1);
    const padding = geometry(form.padding, 0);
    const count = (length: number | null, index: number): number | null => {
        const width = cellWidths[index], stride = strides[index], pad = padding[index];
        if (length === null || width === null || stride === null || pad === null
            || width <= 0 || stride <= 0 || pad < 0) return null;
        const available = length + pad * 2 - width;
        return available < 0 ? 0 : Math.floor(available / stride) + 1;
    };
    if (source.types.join() === 'text' && axes.length === 1) return {
        types: ['sequence'], elements: ['text'], rank: 1, shape: [count(source.shape?.[0] ?? null, 0)],
        callbackFreeScalarCells: true,
    };
    if (source.types.join() === 'sequence' && source.shape?.[0] == null) return UNKNOWN_VALUE;
    if (!['array', 'sequence'].includes(source.types.join())) return UNKNOWN_VALUE;
    const shape = (source.shape ?? Array(source.rank).fill(null)).map((length, axis) => {
        const selected = axes.indexOf(axis);
        return selected < 0 ? length : count(length, selected);
    });
    return { types: ['array'], elements: source.elements, rank: shape.length + axes.length,
        shape: [...shape, ...cellWidths],
        ...(source.eagerScalarCells || source.callbackFreeScalarCells
            ? { callbackFreeScalarCells: true as const } : {}) };
}

/** Transfer facts through a flattened application and its standard-operation contract. */
export function applicationExpressionFacts(
    expression: ApplicationExpression, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts,
): ValueFacts | undefined {
    const form = applicationForm(expression, name => operationBinding(name, lookup));
    return applicationFormFacts(expression, form, lookup, infer);
}

/** Both syntax versions of a form use this transfer without inspecting their spelling. */
export function applicationFormFacts(expression: Expression, form: ApplicationForm, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts): ValueFacts | undefined {
    switch (form.kind) {
        case 'diagonal': {
            const source = infer(form.source, lookup);
            const offsetFacts = form.offset ? infer(form.offset, lookup) : undefined;
            const offset = form.offset ? offsetFacts?.integer === undefined ? undefined
                : Number(offsetFacts.integer) : 0;
            const requested = form.rank === undefined ? 2 : Number(form.rank);
            const partition = rankedOperandShapes([source], [requested], form.axes);
            const dimensions = partition?.cells[0];
            const result = dimensions && diagonalResultShape(dimensions, offset ?? 0);
            const cellShape = result && (offset === undefined ? result.map(() => null) : result);
            const shape = cellShape && partition ? [...partition.frame, ...cellShape] : undefined;
            return { types: ['array'], elements: source.elements,
                ...(shape ? { rank: shape.length, shape } : {}) };
        }
        case 'checked-read':
            return infer(applicationExpression(form.parts, expression), lookup);
        case 'array-combine-constructor': {
            const spread = form.items.some(isUnpackExpression);
            const cells = form.items.map(item => infer(isUnpackExpression(item) ? item.value : item, lookup));
            if (!spread && !cells.every(cell => ['array', 'sequence'].includes(cell.types.join()))) return UNKNOWN_VALUE;
            const first = cells[0];
            const inputRank = spread || first.rank === undefined || cells.some(cell => cell.rank !== first.rank)
                ? undefined : first.rank;
            const axisFact = form.axis && infer(form.axis, lookup);
            const axis = axisFact?.integer === undefined ? form.axis ? undefined : 0 : Number(axisFact.integer);
            const rank = inputRank === undefined ? undefined
                : form.operation === 'stack' ? inputRank + 1 : inputRank;
            const validAxis = axis !== undefined && rank !== undefined && axis >= 0
                && axis < rank;
            const shape = !validAxis || inputRank === undefined ? undefined
                : (first.shape ?? Array(inputRank).fill(null)).map((length, index) => {
                    if (form.operation === 'concat' && index === axis) {
                        return cells.every(cell => cell.shape?.[index] != null)
                            ? cells.reduce((sum, cell) => sum + cell.shape![index]!, 0) : null;
                    }
                    return cells.every(cell => cell.shape?.[index] === length) ? length : null;
                });
            if (shape && form.operation === 'stack') shape.splice(axis!, 0, cells.length);
            const sequence = form.operation === 'concat' && cells.some(cell => cell.types.join() === 'sequence');
            const combined: ValueFacts = { types: [sequence ? 'sequence' : 'array'], rank, shape,
                elements: first.elements?.length && cells.every(cell => cell.elements?.join() === first.elements?.join())
                    && !spread ? first.elements : undefined,
                ...(!spread && cells.every(cell => cell.eagerScalarCells || cell.callbackFreeScalarCells)
                    ? { callbackFreeScalarCells: true as const } : {}) };
            if (!form.rest.length) return combined;
            const name = '\0combined-result';
            const source = { $type: 'NameExpression', name } as Expression;
            const next = applicationExpression([source, ...form.rest], expression);
            const nested = Object.assign((key: string) => key === name ? combined : lookup(key),
                { arity: lookup.arity, invoke: lookup.invoke });
            return infer(next, nested);
        }
        case 'reshape': {
            const source = infer(form.source, lookup);
            const continueWith = (shaped: ValueFacts): ValueFacts => {
                if (!form.rest.length) return shaped;
                const name = '\0reshape-result';
                const result = { $type: 'NameExpression', name } as Expression;
                const next = applicationExpression([result, ...form.rest], expression);
                const nested = Object.assign((key: string) => key === name ? shaped : lookup(key),
                    { arity: lookup.arity, invoke: lookup.invoke });
                return infer(next, nested);
            };
            if (form.dimensions.length === 1 && isUnpackExpression(form.dimensions[0])) {
                const shapes = infer(form.dimensions[0].value, lookup);
                if (shapes.rank === 2) {
                    const columns = shapes.shape?.[1];
                    const shaped: ValueFacts = { types: ['array'], elements: source.elements,
                        ...(columns == null ? {} : { rank: columns + 1,
                            shape: [shapes.shape?.[0] ?? null, ...Array(columns).fill(null)] }) };
                    return continueWith(shaped);
                }
            }
            const dimensions = form.dimensions.flatMap(part => {
                if (isUnpackExpression(part)) {
                    const value = infer(part.value, lookup);
                    return value.integers ?? Array(value.shape?.[0] ?? 0).fill(null);
                }
                const value = infer(part, lookup).integer;
                return [value === undefined ? null : Number(value)];
            });
            const knownRank = form.dimensions.every(part => !isUnpackExpression(part)
                || infer(part.value, lookup).integers !== undefined
                || infer(part.value, lookup).shape?.[0] != null);
            const shaped: ValueFacts = { types: ['array'], elements: source.types.join() === 'text'
                ? ['text'] : source.elements,
                ...(knownRank ? { rank: dimensions.length, shape: dimensions } : {}),
                ...((source.eagerScalarCells || source.callbackFreeScalarCells) && source.elements?.length
                    ? { eagerScalarCells: true as const } : {}) };
            return continueWith(shaped);
        }
        case 'window': {
            const shaped = windowFacts(form, lookup, infer);
            if (!form.rest.length) return shaped;
            const name = '\0window-result';
            const result = { $type: 'NameExpression', name } as Expression;
            const next = applicationExpression([result, ...form.rest], expression);
            const nested = Object.assign((key: string) => key === name ? shaped : lookup(key),
                { arity: lookup.arity, invoke: lookup.invoke });
            return infer(next, nested);
        }
        case 'dsu-method':
            if (form.operation === 'merge') {
                const receiver = infer(form.receiver, lookup);
                return receiver.types.join() === 'dsu'
                    ? { types: ['boolean'], rank: 0, shape: [] } : UNKNOWN_VALUE;
            }
            return isApplicationExpression(expression)
                ? transferApplicationFacts(expression, form, lookup, infer) : UNKNOWN_VALUE;
        case 'plain': case 'new-dsu': case 'new-filled': case 'new-heap': case 'new-graph': case 'text-format': case 'rank':
        case 'named-segment': case 'named-outer': case 'sort-direction':
        case 'axis-length': case 'axis-reduction': case 'axis-covariance': case 'axis-correlation':
        case 'functional-method': case 'graph-edges': case 'materialize-pipeline':
            return isApplicationExpression(expression)
                ? transferApplicationFacts(expression, form, lookup, infer) : UNKNOWN_VALUE;
        // These forms have runtime implementations but no abstract transfer yet.
        case 'collection-mutation': case 'unpack': case 'invalid': case 'axis-matmul': case 'axis-quantile':
        case 'axis-shift': case 'axis-shuffle': case 'axis-argsort': case 'axis-metric':
        case 'axis-transpose': case 'axis-selection':
        case 'comparison-rank':
            return UNKNOWN_VALUE;
        case 'named-scan':
            return namedScanFacts(form, lookup, infer) ?? UNKNOWN_VALUE;
        case 'multiset-method':
            return multisetMethodFacts(form, lookup, infer);
        case 'segment': case 'scan': case 'reduce': case 'outer':
            return symbolicFormFacts(form, lookup, infer) ?? UNKNOWN_VALUE;
        default: return assertNever(form);
    }
}

/** `Values scan bxor with 0`: a builtin scalar operation folded over proven numeric cells. */
function namedScanFacts(form: Extract<ApplicationForm, { kind: 'named-scan' }>, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts): ValueFacts | undefined {
    if (form.axis || !isNameExpression(form.operation)) return undefined;
    const operation = operationBinding(form.operation.name, lookup);
    // Integer-only scalar operations, or ones that return one of their numeric operands.
    const realCells = operation && operation.selectsNumericCell === true;
    if (!operation || !(operation.scalarNoCallback === 'integer' || realCells) || operation.effects?.length
        || !operation.arities.includes(2) || operation.dyadicRanks?.[0] !== 0
        || operation.dyadicRanks[1] !== 0) return undefined;
    const source = infer(form.source, lookup);
    const seed = form.seed && infer(form.seed, lookup);
    const cells = [...(source.elements ?? []), ...(seed?.types ?? [])];
    if (!['array', 'sequence'].includes(source.types.join()) || source.rank !== 1
        || !(source.eagerScalarCells || source.callbackFreeScalarCells) || !source.elements?.length
        || seed && seed.rank !== 0
        || !cells.every(type => type === 'integer' || realCells && type === 'real')) return undefined;
    const length = source.shape?.[0];
    return { types: ['array'], rank: 1, shape: [length == null ? null : length + (seed ? 1 : 0)],
        elements: [...new Set(cells)], callbackFreeScalarCells: true };
}

function operationBinding(name: string, lookup: FactLookup) {
    const bound = lookup(name);
    return bound ? bound.builtinOperation ? findOperation(bound.builtinOperation) : false : findOperation(name);
}

function transferApplicationFacts(
    expression: ApplicationExpression, form: ApplicationForm, lookup: FactLookup,
    infer: (expression: Expression, lookup: FactLookup) => ValueFacts,
): ValueFacts | undefined {
    if (form.kind === 'new-heap') {
        const values = form.values && infer(form.values, lookup);
        if (values?.types.join() === 'array' && values.rank !== undefined && values.rank > 1) {
            return { types: ['heap'], elements: ['array'], elementRank: values.rank - 1,
                elementCells: values.elements };
        }
        return { types: ['heap'], ...(values?.elements?.length ? { elements: values.elements } : {}) };
    }
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
    if (form.kind === 'rank' && lookup('rank') === undefined) {
        const name = form.parts.at(-1);
        const operation = isNameExpression(name) ? operationBinding(name.name, lookup) : undefined;
        const operands = form.parts.slice(0, -1).map(part => infer(part, lookup));
        if (form.rank === 0n && form.rightRank === undefined && !form.axes
            && operands.length === 1 && operands[0].types.join() === 'sequence'
            && (operands[0].callbackFreeScalarCells || operands[0].eagerScalarCells)) {
            const source = operands[0];
            const cells: ValueFacts = { types: source.elements ?? [], rank: 0, shape: [] };
            const result = isNameExpression(name) && lookup(name.name)?.types.join() === 'function' && lookup.invoke
                ? lookup.invoke(name.name, [cells], true)
                : operation ? operationShapeFacts(operation, [cells]) : undefined;
            if (result?.rank === 0 && result.types.length) return {
                types: ['sequence'], rank: 1, shape: source.shape, elements: result.types,
                ...(source.unbounded ? { unbounded: true as const } : {}),
            };
        }
        if (isNameExpression(name) && lookup(name.name)?.types.join() === 'function'
            && lookup.invoke && lookup.arity?.(name.name) === operands.length
            && operands.length === (form.rightRank === undefined ? 1 : 2)) {
            const ranks = form.rightRank === undefined ? [Number(form.rank)] : [Number(form.rank), Number(form.rightRank)];
            return rankedFunctionFacts(operands, ranks, cells => lookup.invoke!(name.name, cells, true), form.axes);
        }
        if (operation && operands.length === (form.rightRank === undefined ? 1 : 2)
            && operands.every(value => value.types.join() === 'array')) {
            const ranks = form.rightRank === undefined ? [Number(form.rank)] : [Number(form.rank), Number(form.rightRank)];
            const shaped = operationShapeFacts(operation, operands, ranks, form.axes);
            if (shaped) return shaped;
        }
    }
    const grouped = groupedUnaryDyadicChain(expression, name => lookup(name) === undefined);
    if (grouped) return infer(grouped, lookup);
    const flattened = flattenApplication(expression);
    let parts = flattened;
    if (flattened.length > 2 && isLabelLiteral(flattened[1])
        && (infer(flattened[0], lookup).fields?.[flattened[1].name]
            || infer(flattened[0], lookup).checkedFields?.[flattened[1].name]
            || infer(flattened[0], lookup).checkedColumns?.[flattened[1].name])) {
        let prefix: Expression = expression;
        while (isApplicationExpression(prefix) && flattenApplication(prefix).length > 2) {
            prefix = prefix.head;
        }
        if (isApplicationExpression(prefix)) parts = [prefix, ...flattened.slice(2)];
    }
    // A later operand `Record .field` is a field read too, as in `X Model .weights matmul`.
    for (let index = 2; parts.length > 2 && index < parts.length; index++) {
        const label = parts[index];
        if (!isLabelLiteral(label) || !(infer(parts[index - 1], lookup).fields?.[label.name]
            || infer(parts[index - 1], lookup).checkedFields?.[label.name]
            || infer(parts[index - 1], lookup).checkedColumns?.[label.name])) continue;
        parts = [...parts.slice(0, index - 1), applicationExpression([parts[index - 1], label], expression),
            ...parts.slice(index + 1)];
        index--;
    }
    // `Steps Value 5 min`: when the count fits no arity, the leading values are one receiver and its
    // selectors and the rest are the remaining operands. A full integer read of a scalar array is
    // the only leading selection proven here.
    const trailing = parts.at(-1);
    const trailingOperation = trailing && isNameExpression(trailing) && parts.length > 3
        ? operationBinding(trailing.name, lookup) : undefined;
    if (trailingOperation && !trailingOperation.arities.includes(parts.length - 1)) {
        const receiver = infer(parts[0], lookup);
        const arity = [...trailingOperation.arities].sort((left, right) => right - left)
            .find(candidate => candidate >= 1 && parts.length - 1 > candidate);
        const firstLength = arity === undefined ? 0 : parts.length - arity;
        if (firstLength >= 2 && receiver.types.join() === 'array' && receiver.rank === firstLength - 1
            && (receiver.eagerScalarCells || receiver.callbackFreeScalarCells) && receiver.elements?.length
            && parts.slice(1, firstLength).every(part => {
                const selector = infer(part, lookup);
                return selector.rank === 0 && selector.types.length > 0
                    && selector.types.every(type => type === 'integer');
            })) {
            parts = [applicationExpression(parts.slice(0, firstLength), expression), ...parts.slice(firstLength)];
        }
    }
    const last = parts.at(-1)!;
    const unaryTail = unaryApplicationHead(expression, name => lookup(name) === undefined
        ? findOperation(name)?.arities : lookup(name)?.types.includes('function') && lookup.arity?.(name) !== undefined
            ? [lookup.arity(name)!] : undefined, name => lookup(name) === undefined) !== undefined;
    const source = infer(unaryTail ? expression.head : parts[0], lookup);
    if (parts.length === 2 && source.tupleItems && infer(parts[1], lookup).types.join() === 'integer') {
        const index = infer(parts[1], lookup).integer;
        if (index !== undefined) {
            const position = Number(index) < 0 ? source.tupleItems.length + Number(index) : Number(index);
            return source.tupleItems[position] ?? UNKNOWN_VALUE;
        }
        return joinValueFacts(source.tupleItems);
    }
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
                const primitive = (item: unknown): ValueFacts => item === null ? { types: ['symbol'], rank: 0, shape: [] }
                    : typeof item === 'string' ? { types: ['text'], rank: 1, shape: [null] }
                    : typeof item === 'boolean' ? { types: ['boolean'], rank: 0, shape: [] }
                    : typeof item === 'number' ? { types: ['integer', 'real'], rank: 0, shape: [] }
                    : { types: [Array.isArray(item) ? 'array' : 'object'] };
                const cells = value.map(primitive);
                if (value.every(item => typeof item === 'number')) {
                    const tokens = source.textLiteral.trim().slice(1, -1).split(',');
                    cells.forEach((cell, index) => { cells[index] = { ...cell,
                        types: /[.eE]/.test(tokens[index]) ? ['real'] : ['integer'] }; });
                }
                if (value.some(Array.isArray)) return { types: ['array', 'tuple'] };
                const kinds = new Set(cells.map(cell => cell.types.join()));
                if (kinds.size > 1) return { types: ['tuple'], rank: 0, shape: [], tupleItems: cells };
                return { types: ['array'], rank: 1, shape: [value.length],
                    elements: cells[0]?.types ?? [], eagerScalarCells: true };
            }
            if (value === null) return { types: ['symbol'], rank: 0, shape: [] };
            if (typeof value === 'object') return { types: ['object'] };
            if (typeof value === 'number') return { types: ['integer', 'real'], rank: 0, shape: [] };
            if (typeof value === 'boolean') return { types: ['boolean'], rank: 0, shape: [] };
            if (typeof value === 'string') return { types: ['text'], rank: 1, shape: [[...value].length] };
        } catch { /* Invalid JSON has no value facts. */ }
    }
    if (parts.length === 2 && (isNameExpression(last)
        && ['pop', 'peek', 'popfront', 'peekfront', 'popback', 'peekback'].includes(last.name)
        && lookup(last.name) === undefined
        || ['queue', 'stack', 'deque'].includes(source.types.join()) && infer(parts[1], lookup).types.join() === 'integer')
        && ['queue', 'stack', 'deque', 'heap'].includes(source.types.join())
        && source.elements?.length) {
        const types = source.elements;
        if (source.elementRecord && types.join() === 'record') return source.elementRecord;
        return types.join() === 'array' && source.elementRank !== undefined
            ? { types, rank: source.elementRank, shape: Array(source.elementRank).fill(null), elements: source.elementCells }
            : stableRecordField({ types });
    }
    if (parts.length === 3 && isLabelLiteral(parts[1]) && parts[1].name === 'flat'
        && isNameExpression(last) && ['json', 'xml'].includes(last.name)
        && lookup(last.name) === undefined && source.types.join() === 'text') {
        return { types: ['array'], rank: 1, shape: [null], elements: ['object'] };
    }
    if (parts.length === 2 && isNameExpression(last) && last.name === 'xml'
        && lookup(last.name) === undefined && source.types.join() === 'text') {
        const text = { types: ['text'], rank: 1, shape: [null] };
        return { types: ['object'], fields: {
            kind: text, name: text, value: text, attributes: { types: ['object'], xmlAttributeValues: true },
            children: { types: ['array'], rank: 1, shape: [null], elements: ['object'] },
        } };
    }
    const namedSegment = form.kind === 'named-segment' ? form : undefined;
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
    const covarianceOperation = parts.length === 2 && isNameExpression(last) ? operationBinding(last.name, lookup) : undefined;
    const covariance = form.kind === 'axis-covariance' || form.kind === 'axis-correlation' ? form : undefined;
    if ((covariance || covarianceOperation && [findOperation('covariance'), findOperation('correlation'),
        findOperation('corr')].includes(covarianceOperation))
        && source.types.join() === 'array' && source.shape && source.shape.length >= 2
        && (source.eagerScalarCells || source.callbackFreeScalarCells)
        && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
        const axes = covariance?.axes ?? [source.shape.length - 2, source.shape.length - 1];
        if (axes.every(axis => Number.isSafeInteger(axis) && axis >= 0 && axis < source.shape!.length)
            && axes[0] !== axes[1]) {
            const shape = [...source.shape.filter((_, axis) => !axes.includes(axis)),
                source.shape[axes[0]], source.shape[axes[0]]];
            return { types: ['array'], rank: shape.length, shape,
                elements: ['real'], callbackFreeScalarCells: true };
        }
    }
    if (parts.length === 3 && isNameExpression(parts[1]) && parts[1].name === 'findroot'
        && lookup('findroot') === undefined && source.types.join() === 'dsu' && source.elements?.length) {
        return perQueryFacts(infer(parts[2], lookup), source.elements);
    }
    if (parts.length === 2 && isNameExpression(last) && last.name === 'multiset' && lookup('multiset') === undefined
        && source.rank === 1 && ['array', 'sequence'].includes(source.types.join())
        && (source.eagerScalarCells || source.callbackFreeScalarCells)
        && source.elements?.length && source.elements.every(type => ['integer', 'real', 'text'].includes(type))) {
        return { types: ['multiset'], elements: source.elements };
    }
    if (parts.length === 2 && source.types.join() === 'graph' && source.elements?.length
        && infer(parts[1], lookup).types.length && !infer(parts[1], lookup).types.includes('function')) return {
        types: ['sequence'], rank: 1, shape: [null], elements: source.elements,
        callbackFreeScalarCells: true,
    };
    if (parts.length === 2 && isLabelLiteral(last) && source.checkedFields?.[last.name]) {
        return source.checkedFields[last.name];
    }
    if (parts.length === 2 && ['record', 'object'].includes(source.types.join()) && isLabelLiteral(last)) {
        return source.fields?.[last.name] ?? UNKNOWN_VALUE;
    }
    if (parts.length === 2 && source.types.join() === 'array' && isLabelLiteral(last)) {
        return source.checkedColumns?.[last.name] ?? UNKNOWN_VALUE;
    }
    const axisLength = form.kind === 'axis-length' ? form : undefined;
    if (axisLength
        && source.types.join() === 'array' && source.rank !== undefined) {
        const axis = axisLength.axis;
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
    const namedOuter = form.kind === 'named-outer' ? form : undefined;
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
    const sortDirection = form.kind === 'sort-direction' ? form : undefined;
    if (sortDirection && sortDirection.operation.name === 'merge'
        && (parts.length === 3 || parts.length === 4)
        && isLabelLiteral(sortDirection.direction)
        && ['ascending', 'descending'].includes(sortDirection.direction.name)) {
        return mergedSequenceFacts(parts.slice(0, -2).map(part => infer(part, lookup)));
    }
    if (parts.length === 3 && sortDirection
        && isLabelLiteral(sortDirection.direction)
        && (sortDirection.direction.name === 'ascending' || sortDirection.direction.name === 'descending')) {
        const sorted = sortDirection.operation.name === 'sort' && sortedScalarArray(source);
        if (sorted) return sorted;
        const shaped = operationShapeFacts(sortDirection.operation, [source]);
        if (shaped) return shaped;
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
    const lastOperation = isNameExpression(last) ? operationBinding(last.name, lookup) : undefined;
    if (isNameExpression(last) && lastOperation) {
        const operation = lastOperation;
        const arity = unaryTail ? 1 : parts.length - 1;
        if (operation?.arities.includes(arity)) {
            const operands = unaryTail ? [source] : parts.slice(0, -1).map(part => infer(part, lookup));
            if (last.name === 'merge') {
                return mergedSequenceFacts(operands);
            }
            const shaped = operation.sortDirection && arity === 2 ? undefined
                : operationShapeFacts(operation, operands);
            // Extrema select an ordered value, including text, rather than
            // manufacturing a number. The numeric shape signature alone cannot
            // establish their result domain or text's runtime rank.
            if (operation.selectsNumericCell) {
                const ordered = new Set(['integer', 'real', 'text', 'boolean', 'symbol', 'date', 'datetime', 'record']);
                const domains = operands.map(value => {
                    if (value.types.length && value.types.every(type => ordered.has(type))) return value.types;
                    if (arity !== 1 || !value.elements?.length
                        || !value.elements.every(type => ordered.has(type))) return undefined;
                    if (['array', 'sequence'].includes(value.types.join())
                        && !value.eagerScalarCells && !value.callbackFreeScalarCells
                        && value.elements.every(type => type === 'integer' || type === 'real')) return ['integer', 'real'];
                    return value.elements;
                });
                if (domains.every(domain => domain !== undefined)) {
                    const types = [...new Set(domains.flatMap(domain => domain!))];
                    return types.every(type => type === 'text') ? { types, rank: 1, shape: [null] }
                        : types.every(type => type !== 'text') ? { types, rank: 0, shape: [] } : { types };
                }
                if (arity === 1) {
                    // Successful reduction selects an ordered value. Unknown max
                    // can also build a SQLite expression. Neither fixes a rank.
                    const collection = source.types.length && source.types.every(type =>
                        ['array', 'sequence', 'queue', 'stack', 'deque', 'set', 'multiset'].includes(type));
                    return { types: [...ordered, ...(!collection && operation.name === 'max' ? ['sqlite-expression'] : [])] };
                }
            }
            if (arity === 3 && operation.name === 'choose') {
                const chosen = chooseFacts(operands[0], operands[1], operands[2]);
                if (chosen) return chosen;
            }
            if (arity === 1 && last.name === 'eigh' && source.types.join() === 'array'
                && source.rank === 2 && source.shape?.length === 2
                && (source.eagerScalarCells || source.callbackFreeScalarCells)
                && source.elements?.length && source.elements.every(type => type === 'integer' || type === 'real')) {
                const size = source.shape[0];
                return { types: ['tuple'], rank: 0, shape: [],
                    tupleItems: [
                        { types: ['array'], rank: 1, shape: [size], elements: ['real'], eagerScalarCells: true },
                        { types: ['array'], rank: 2, shape: [size, size], elements: ['real'], eagerScalarCells: true },
                    ] };
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
            if (arity === 2 && operation.name === 'findroot' && source.types.join() === 'dsu'
                && source.elements?.length) {
                return perQueryFacts(infer(parts[1], lookup), source.elements);
            }
            if (arity === 3 && ['ancestor', 'lca'].includes(last.name) && source.types.join() === 'record'
                && source.elements?.length) {
                return stableRecordField({ types: source.elements });
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
            if (operation.denseElements && shaped) return {
                ...shaped, elements: operation.denseElements, eagerScalarCells: true,
            };
            if (arity === 1 && last.name === 'indices' && source.types.join() === 'array'
                && source.rank === 1 && source.elements?.join() === 'boolean'
                && (source.eagerScalarCells || source.callbackFreeScalarCells)) {
                return { types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true };
            }
            if (arity === 1 && ['first', 'last'].includes(last.name) && source.rank === 1
                && ['array', 'sequence'].includes(source.types.join()) && source.elements?.length) {
                return { types: source.elements, rank: 0, shape: [] };
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
            if (arity === 1 && operation === findOperation('sort')) {
                const sorted = sortedScalarArray(source);
                if (sorted) return sorted;
            }
            if (arity === 1 && operation === findOperation('argsort')
                && (source.types.join() === 'text' || source.types.join() === 'array'
                    && source.rank === 1 && (source.eagerScalarCells || source.callbackFreeScalarCells))) {
                return { ...(shaped ?? { types: ['array'] }),
                    elements: ['integer'], eagerScalarCells: true };
            }
            // A queue, stack or deque reverses into a new array of the same items.
            if (arity === 1 && last.name === 'reverse' && operation === findOperation('reverse')
                && ['queue', 'stack', 'deque'].includes(source.types.join())) {
                const scalar = source.elements?.length
                    && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type));
                return { types: ['array'], rank: 1, shape: [null],
                    ...(scalar ? { elements: source.elements, eagerScalarCells: true as const } : {}) };
            }
            if (arity === 1 && last.name === 'unique' && source.rank === 1
                && ['array', 'sequence'].includes(source.types.join())
                && (source.eagerScalarCells || source.callbackFreeScalarCells)
                && source.elements?.length && source.elements.every(type =>
                    ['integer', 'real', 'boolean', 'symbol', 'text'].includes(type))) {
                return { ...shaped, types: source.types, elements: source.elements, ...(source.types.join() === 'array'
                        ? { eagerScalarCells: true as const } : { callbackFreeScalarCells: true as const }) };
            }
            if (last.name === 'text' && arity === 1 && source.rank === 0
                && source.types.length > 0 && source.types.every(type =>
                    ['integer', 'real', 'boolean', 'symbol'].includes(type))) {
                return { types: ['text'], rank: 1, shape: [null] };
            }
            if (arity === 1 && source.rank === 0
                && source.types.length > 0
                && source.types.every(type => type === 'integer' || type === 'real')) {
                const result = inferSignatureResultTypes(operation.signatures ?? [],
                    [{ union: source.types as readonly SignatureAtom[] }]);
                if (result?.length && result.every(type => type === 'integer' || type === 'real'))
                    return { types: result, rank: 0, shape: [] };
            }
            if (hasScalarNoCallbackProof(operation, operands)) {
                const types = resultTypes(operation);
                if (types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol',
                    'date', 'datetime', 'duration'].includes(type))) {
                    return { types, rank: 0, shape: [] };
                }
            }
            if (arity === 2 && operation.selectsNumericCell && shaped
                && operands.every(value => value.rank === 0 && value.types.length > 0
                    && value.types.every(type => type === 'integer' || type === 'real'))) {
                return { ...shaped, types: [...new Set(operands.flatMap(value => value.types))] };
            }
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
                    return elements.length > 1
                        ? { types: ['tuple'], rank: 0, shape: [], tupleItems: positions.map(types => ({ types })) }
                        : { types: ['array'], rank: 1, shape: [positions.length], elements, eagerScalarCells: true };
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
            if (operation.preservesCollectionElements && arity === 2 && collection) return {
                ...(shaped ?? { types: source.types }), elements: source.elements,
                ...(hasNumericArrayNoCallbackProof(operation, operands)
                    ? { callbackFreeScalarCells: true as const } : {}),
            };
            if (operation === findOperation('reverse') && arity === 1) {
                if (source.types.join() === 'text') return { types: ['text'], rank: source.rank, shape: source.shape };
                if (source.types.join() === 'array' && source.shape) return {
                    types: ['array'], rank: source.rank, shape: source.shape, elements: source.elements,
                    ...(hasNumericArrayNoCallbackProof(operation, operands)
                        ? { callbackFreeScalarCells: true as const } : {}) };
            }
            // `Values Count shift` keeps the shape; vacated cells read the integer zero fill.
            if (operation === findOperation('shift') && arity === 2 && source.types.join() === 'array'
                && source.shape && source.rank !== undefined && source.rank > 0
                && (source.eagerScalarCells || source.callbackFreeScalarCells) && source.elements?.length
                && source.elements.every(type => type === 'integer' || type === 'real')
                && operands[1].rank === 0 && operands[1].types.join() === 'integer') {
                return { types: ['array'], rank: source.rank, shape: source.shape,
                    elements: [...new Set([...source.elements, 'integer'])], callbackFreeScalarCells: true };
            }
            if (operation === findOperation('transpose') && arity === 1 && source.types.join() === 'array'
                && shaped) return { ...shaped, elements: source.elements,
                ...(hasNumericArrayNoCallbackProof(operation, operands)
                    ? { callbackFreeScalarCells: true as const } : {}) };
            if (arity === 2) {
                const right = infer(parts[1], lookup);
                if (operation.dyadicRanks && shaped?.types.join() === 'array') return {
                    ...shaped, ...(shaped.types.join() === 'array' ? { elements: resultTypes(operation) } : {}),
                    ...(hasNumericArrayNoCallbackProof(operation, operands)
                        ? { callbackFreeScalarCells: true as const } : {}),
                };
                if (operation === findOperation('matmul') && source.types.join() === 'array'
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
            if (hasNumericArrayNoCallbackProof(operation, operands)
                && resultTypes(operation).join() === 'array') return {
                ...(shaped ?? { types: ['array'] }), elements: ['integer', 'real'], callbackFreeScalarCells: true,
            };
            if (shaped) return shaped;
        }
    }
    const axisReduction = form.kind === 'axis-reduction' ? form : undefined;
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
        // An unknown length is one fixed natural number: a bound `N = X len` keeps it for later shapes.
        const symbolic = source.dims?.length === source.shape?.length ? source.dims?.[0] ?? undefined : undefined;
        const dim = symbolic ?? (length === null && source.types.join() === 'array' ? freshDim('len') : undefined);
        return { types: ['integer'], rank: 0, shape: [],
            ...(length !== undefined && length !== null ? { integer: String(length) } : {}),
            ...(dim && !(length !== null && length !== undefined) ? { dim } : {}) };
    }
    if (isNameExpression(last) && last.name === 'len' && lookup(last.name) === undefined
        && parts.length === 2) return { types: ['integer'], rank: 0, shape: [] };
    if (isNameExpression(last) && last.name === 'count' && lookup(last.name) === undefined
        && parts.length === 2 && source.types.join() === 'array') {
        return { types: ['integer'], rank: 0, shape: [] };
    }
    if (isNameExpression(last) && lookup(last.name)?.types.includes('function') && lookup.invoke) {
        const pipedArguments = isApplicationExpression(expression.head) && expression.arguments.length === 1
            && lookup.arity?.(last.name) === expression.head.arguments.length + 1
            ? [expression.head.head, ...expression.head.arguments] : undefined;
        return lookup.invoke(last.name, pipedArguments
            ? pipedArguments.map(part => infer(part, lookup))
            : unaryTail ? [source] : parts.slice(0, -1).map(part => infer(part, lookup)));
    }
    if (parts.length === 2 && source.types.join() === 'text'
        && infer(parts[1], lookup).types.join() === 'integer') {
        return { types: ['text'], rank: 1, shape: [1] };
    }
    if (parts.length === 2 && source.types.join() === 'counter'
        && infer(parts[1], lookup).types.length > 0) {
        return { types: ['integer'], rank: 0, shape: [] };
    }
    if (parts.length === 2 && ['sequence', 'text', 'queue'].includes(source.types.join())) {
        const open = infer(parts[1], lookup).openRange;
        if (open) {
            const start = open.start === undefined ? undefined : BigInt(open.start);
            const step = open.step === undefined ? undefined : BigInt(open.step);
            const size = source.shape?.[0];
            let length: number | null = null;
            if (start !== undefined && step !== undefined && start >= 0n && step !== 0n) {
                if (source.unbounded && step < 0n) length = Number(start / -step + 1n);
                else if (size != null && start <= BigInt(size)) length = start === BigInt(size) ? 0
                    : Number(step > 0n ? (BigInt(size) - start + step - 1n) / step : start / -step + 1n);
            }
            const lazy = source.types.join() === 'sequence' && source.unbounded;
            return { types: [lazy ? 'sequence' : source.types.join() === 'text' ? 'text' : 'array'],
                rank: 1, shape: [length], elements: source.elements,
                ...(lazy && step !== undefined && step > 0n ? { unbounded: true as const } : {}),
                ...(source.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}) };
        }
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
                const open = selector?.openRange;
                if (open?.start !== undefined && open.step !== undefined && dimension !== null) {
                    const start = BigInt(open.start), step = BigInt(open.step), size = BigInt(dimension);
                    if (start >= 0n && start <= size && step !== 0n) {
                        return [start === size ? 0 : Number(step > 0n
                            ? (size - start + step - 1n) / step : start / -step + 1n)];
                    }
                }
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
        if (source.elements?.join() === 'object' && source.checkedInputId !== undefined) {
            return { types: ['object'], checkedInputId: source.checkedInputId };
        }
        if (source.types[0] === 'array' && source.elements?.join() === 'record' && source.elementRecord) {
            return source.elementRecord;
        }
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

/** `Values take Count` and `Values drop Count` keep the kind and trailing shape of their source. */
export function takeDropFacts(source: ValueFacts, count: ValueFacts, drop: boolean): ValueFacts | undefined {
    if (count.types.join() !== 'integer' || count.rank !== 0
        || (count.integer !== undefined && BigInt(count.integer) < 0n)) return undefined;
    const size = source.shape?.[0];
    const leading = !drop && source.unbounded && count.integer !== undefined
        ? Number(BigInt(count.integer)) : size == null || count.integer === undefined ? null
        : Number(BigInt(count.integer) < BigInt(size) ? BigInt(count.integer) : BigInt(size));
    const length = drop && size != null && leading != null ? size - leading : leading;
    if (source.types.join() === 'text') return { types: ['text'], rank: 1, shape: [length] };
    if (source.types.join() === 'sequence') return { types: ['sequence'], rank: 1,
        shape: [length], elements: source.elements,
        ...(drop && source.unbounded ? { unbounded: true as const } : {}),
        ...(source.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}) };
    if (source.types.join() === 'array' && source.rank !== undefined && source.rank > 0) return {
        types: ['array'], rank: source.rank,
        shape: [length, ...(source.shape?.slice(1) ?? Array(source.rank - 1).fill(null))],
        elements: source.elements,
        ...(source.eagerScalarCells || source.callbackFreeScalarCells
            ? { callbackFreeScalarCells: true as const } : {}),
    };
    return undefined;
}
