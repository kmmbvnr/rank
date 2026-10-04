import {
    isExpression, isParenthesizedExpression, isNumberLiteral, isNewStructureExpression, isStringLiteral, isUnaryExpression, isUnpackExpression,
    isApplicationExpression, isArrayExpression, isBinaryExpression, isLabelLiteral, isNameExpression,
    type ArrayExpression, type ArrayItem, type Expression,
} from './generated/ast.js';
import { findOperation, type Operation } from './operations.js';
import { flattenApplication } from './expressions.js';

export const REDUCE_OPERATORS = new Set(['+', '-', '*', '**', '/', '//', '%', 'and', 'or', 'xor']);
export const OUTER_OPERATORS = new Set([
    '+', '-', '*', '**', '/', '//', '%',
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost',
    'and', 'or', 'xor', 'multipleby',
]);

export interface AxisReductionForm {
    readonly kind: 'axis-reduction';
    readonly source: Expression;
    readonly operation: Operation;
    readonly axes: readonly Expression[];
}

export interface SortDirectionForm {
    readonly kind: 'sort-direction';
    readonly operation: Operation;
    readonly direction: Expression;
}

export interface AxisLengthForm {
    readonly kind: 'axis-length';
    readonly source: Expression;
    readonly axis: Expression;
}

/** Identify `Value len axis N` before either consumer interprets N. */
export function axisLengthForm(
    parts: readonly Expression[], standard: (name: string) => boolean = () => true,
): AxisLengthForm | undefined {
    if (parts.length !== 4 || !isNamed(parts[1], 'len') || !isNamed(parts[2], 'axis')
        || !standard('len') || !standard('axis')) return undefined;
    return { kind: 'axis-length', source: parts[0], axis: parts[3] };
}

/** Recognize a trailing sort direction, including invalid labels for runtime diagnostics. */
export function sortDirectionForm(
    parts: readonly Expression[], standard: (name: string) => boolean = () => true,
): SortDirectionForm | undefined {
    const direction = parts.at(-1);
    if (parts.length <= 2 || !direction || !(isLabelLiteral(direction)
        || isNameExpression(direction) && /^[A-Z]/.test(direction.name))) return undefined;
    const operation = parts.slice(0, -1).find(part => isNameExpression(part)
        && standard(part.name) && findOperation(part.name)?.sortDirection);
    if (!operation || !isNameExpression(operation)) return undefined;
    return { kind: 'sort-direction', operation: findOperation(operation.name)!, direction };
}

/** Recognize a reduction form without evaluating its axes or consulting runtime values. */
export function axisReductionForm(
    parts: readonly Expression[],
    standard: (name: string) => boolean = () => true,
): AxisReductionForm | undefined {
    if (parts.length < 4 || !isNameExpression(parts[1])
        || !isNameExpression(parts[2]) || parts[2].name !== 'axis'
        || !standard(parts[1].name)) return undefined;
    const operation = findOperation(parts[1].name);
    if (!operation?.axisReduction) return undefined;
    return { kind: 'axis-reduction', source: parts[0], operation, axes: parts.slice(3) };
}

function isNamed(expression: Expression | undefined, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
}

export type SymbolicApplicationForm =
    | { readonly kind: 'outer'; readonly operator: string; readonly operands: readonly Expression[] }
    | { readonly kind: 'segment'; readonly operator: string; readonly source: Expression }
    | { readonly kind: 'scan'; readonly operator: string; readonly source: Expression; readonly seed?: Expression;
        readonly axis?: Expression }
    | { readonly kind: 'reduce'; readonly operator: string; readonly source: Expression;
        readonly rank?: Expression; readonly seed?: Expression };

/** Recognize the current symbolic modifier syntax once for runtime and analysis. */
export function symbolicApplicationForm(
    expression: Expression, standard: (name: string) => boolean = () => true,
): SymbolicApplicationForm | undefined {
    if (!isBinaryExpression(expression)) return undefined;
    const parts = isApplicationExpression(expression.right)
        ? flattenApplication(expression.right) : [expression.right];
    if (OUTER_OPERATORS.has(expression.operator) && isNamed(parts[0], 'outer')
        && parts.length === 1 && standard('outer')) {
        return { kind: 'outer', operator: expression.operator,
            operands: flattenApplication(expression.left) };
    }
    if (!REDUCE_OPERATORS.has(expression.operator)) return undefined;
    if (parts.length === 1 && isNamed(parts[0], 'segment') && standard('segment')) {
        return { kind: 'segment', operator: expression.operator, source: expression.left };
    }
    if (isNamed(parts[0], 'scan') && standard('scan')) {
        if (parts.length === 1) return { kind: 'scan', operator: expression.operator,
            source: expression.left };
        if (parts.length === 3 && isNamed(parts[1], 'with')) return {
            kind: 'scan', operator: expression.operator, source: expression.left, seed: parts[2],
        };
        if (parts.length === 3 && isNamed(parts[1], 'axis') && isNumberLiteral(parts[2])) return {
            kind: 'scan', operator: expression.operator, source: expression.left, axis: parts[2],
        };
    }
    if (isNamed(parts[0], 'reduce') && standard('reduce')) {
        if (parts.length === 1) return { kind: 'reduce', operator: expression.operator,
            source: expression.left };
        if (parts.length === 3 && isNamed(parts[1], 'with')) return {
            kind: 'reduce', operator: expression.operator, source: expression.left, seed: parts[2],
        };
        if ((parts.length === 3 || parts.length === 5) && isNamed(parts[1], 'rank')
            && (parts.length === 3 || isNamed(parts[3], 'with'))) return {
            kind: 'reduce', operator: expression.operator, source: expression.left,
            rank: parts[2], seed: parts[4],
        };
    }
    return undefined;
}

export function explicitMaterializePipeline(parts: Expression[]): {
    readonly source: readonly Expression[];
    readonly selector: ArrayExpression;
    readonly steps: readonly ArrayItem[];
} | undefined {
    const position = parts.findIndex((part, index) => index > 0
        && isArrayExpression(part)
        && part.dimensions.length === 0
        && part.items.length > 0
        && part.items.every(item => !item.sign));
    if (position < 0 || position !== parts.length - 1) return undefined;
    const selector = parts[position] as ArrayExpression;
    return { source: parts.slice(0, position), selector, steps: selector.items };
}

export interface NamedOuterApplication {
    readonly left: Expression;
    readonly right: Expression;
    readonly operation: Expression;
}

export function explicitNamedOuterApplication(parts: Expression[]): NamedOuterApplication | undefined {
    if (parts.length !== 4 || !isNamed(parts[3], 'outer')) return undefined;
    return {
        left: parts[0],
        right: parts[1],
        operation: parts[2],
    };
}

export interface NamedSegmentApplication {
    readonly identity?: Expression;
    readonly source: Expression;
    readonly operation: Expression;
}

export interface NamedScanApplication {
    readonly seed?: Expression;
    readonly axis?: Expression;
    readonly source: Expression;
    readonly operation: Expression;
}

export function explicitNamedScanApplication(parts: Expression[]): NamedScanApplication | undefined {
    if (parts.length === 5 && isNamed(parts[2], 'scan') && isNamed(parts[3], 'with')) {
        return { source: parts[0], seed: parts[4], operation: parts[1] };
    }
    if (parts.length === 5 && isNamed(parts[2], 'scan') && isNamed(parts[3], 'axis')
        && isNumberLiteral(parts[4])) {
        return { source: parts[0], axis: parts[4], operation: parts[1] };
    }
    if (parts.length === 3 && isNamed(parts[2], 'scan')) {
        return { source: parts[0], operation: parts[1] };
    }
    return undefined;
}

export function explicitNamedSegmentApplication(parts: Expression[]): NamedSegmentApplication | undefined {
    if (parts.length === 5 && isNamed(parts[2], 'segment') && isNamed(parts[3], 'with')) {
        return { source: parts[0], identity: parts[4], operation: parts[1] };
    }
    if (parts.length !== 3 || !isNamed(parts[2], 'segment')) return undefined;
    return { source: parts[0], operation: parts[1] };
}

export interface MultisetMethodApplication {
    readonly receiver: Expression[];
    readonly operation: 'floor' | 'ceiling' | 'lowerbound' | 'upperbound';
    readonly argument: Expression[];
}

export interface CollectionMutationApplication {
    readonly receiver: Expression;
    readonly operation: 'add' | 'remove';
    readonly value: Expression;
    readonly arguments?: readonly Expression[];
}

export function explicitCollectionMutation(
    expression: Expression,
): CollectionMutationApplication | undefined {
    if (isBinaryExpression(expression)) {
        const mutation = explicitCollectionMutation(expression.left);
        if (!mutation) return undefined;
        return {
            ...mutation,
            value: { ...expression, left: mutation.value } as Expression,
            arguments: undefined,
        };
    }
    if (!isApplicationExpression(expression)) return undefined;
    const parts = flattenApplication(expression);
    if (explicitNamedScanApplication(parts) || explicitNamedSegmentApplication(parts)) return undefined;
    const receiver = parts[0];
    const operation = parts[1];
    if (!isNameExpression(receiver)
        || !/^[A-Z]/.test(receiver.name)
        || parts.length < 3) return undefined;
    if (!isNameExpression(operation)
        || (operation.name !== 'add' && operation.name !== 'remove')) return undefined;
    const values = parts.slice(2);
    const value = values.length === 1 ? values[0] : {
        $type: 'ApplicationExpression',
        head: values[0],
        arguments: values.slice(1),
    } as Expression;
    return {
        receiver,
        operation: operation.name,
        value,
        arguments: values,
    };
}

export function explicitMultisetMethod(parts: Expression[]): MultisetMethodApplication | undefined {
    const operations = ['floor', 'ceiling', 'lowerbound', 'upperbound'] as const;
    const position = parts.findIndex((part, index) =>
        index > 0 && index < parts.length - 1
        && operations.some(operation => isNamed(part, operation)));
    if (position < 0) return undefined;
    const operation = operations.find(candidate => isNamed(parts[position], candidate))!;
    return {
        receiver: parts.slice(0, position),
        operation,
        argument: parts.slice(position + 1),
    };
}

export interface GraphEdgesApplication {
    readonly receiver: Expression;
    readonly operation: Expression;
    readonly argument: Expression;
}

export interface DsuMethodApplication {
    readonly receiver: Expression;
    readonly operation: 'findroot' | 'merge' | 'connected';
    readonly operationExpression: Expression;
    readonly arguments: readonly Expression[];
}

export interface FunctionalMethodApplication {
    readonly receiver: Expression;
    readonly operation: 'jump' | 'distance';
    readonly operationExpression: Expression;
    readonly arguments: readonly Expression[];
}

export function explicitFunctionalMethod(
    parts: Expression[],
): FunctionalMethodApplication | undefined {
    if (parts.length !== 4 || !isNameExpression(parts[1])) return undefined;
    const operation = parts[1].name;
    if (operation !== 'jump' && operation !== 'distance') return undefined;
    return {
        receiver: parts[0], operation, operationExpression: parts[1],
        arguments: parts.slice(2),
    };
}

export function explicitDsuMethod(parts: Expression[]): DsuMethodApplication | undefined {
    if (parts.length !== 3 && parts.length !== 4) return undefined;
    const operation = isNameExpression(parts[1]) ? parts[1].name : undefined;
    if (operation === 'findroot' && parts.length === 3) {
        return {
            receiver: parts[0], operation, operationExpression: parts[1],
            arguments: parts.slice(2),
        };
    }
    if ((operation === 'merge' || operation === 'connected') && parts.length === 4) {
        return {
            receiver: parts[0], operation, operationExpression: parts[1],
            arguments: parts.slice(2),
        };
    }
    return undefined;
}

export function explicitGraphEdges(parts: Expression[]): GraphEdgesApplication | undefined {
    if (parts.length !== 3 || !isNamed(parts[1], 'edges')) return undefined;
    return {
        receiver: parts[0],
        operation: parts[1],
        argument: parts[2],
    };
}


/** A binding resolves to its builtin identity, a user value (false), or an unbound word. */
export type ApplicationLookup = (name: string) => Operation | false | undefined;
type Recognized<K extends string, F extends (...args: never[]) => unknown> =
    { readonly kind: K } & NonNullable<ReturnType<F>>;

/** Structures that `new X Items` fills from the items of one collection. */
const FILLED_STRUCTURES: ReadonlySet<string> = new Set(['queue', 'stack', 'deque', 'heap', 'set', 'counter', 'multiset', 'orderedset']);

export type ApplicationForm =
    | { readonly kind: 'plain' }
    | { readonly kind: 'checked-read'; readonly reader: 'csv' | 'json' | 'xml'; readonly parts: readonly Expression[] }
    | { readonly kind: 'invalid'; readonly message: string }
    | { readonly kind: 'unpack' }
    | { readonly kind: 'new-graph' }
    | { readonly kind: 'new-dsu' }
    | { readonly kind: 'new-filled'; readonly structure: string }
    | { readonly kind: 'new-heap'; readonly priorities?: Expression; readonly values?: Expression;
        readonly direction?: Expression }
    | { readonly kind: 'stack-constructor'; readonly items: readonly Expression[]; readonly rest: readonly Expression[] }
    | { readonly kind: 'text-format'; readonly position: number }
    | Recognized<'collection-mutation', typeof explicitCollectionMutation>
    | Recognized<'comparison-rank', typeof explicitComparisonRank>
    | SymbolicApplicationForm
    | Recognized<'sort-direction', typeof sortDirectionForm>
    | Recognized<'named-outer', typeof explicitNamedOuterApplication>
    | Recognized<'rank', typeof explicitRankApplication>
    | Recognized<'axis-matmul', typeof explicitAxisMatmul>
    | Recognized<'axis-covariance', typeof explicitAxisCovariance>
    | Recognized<'axis-correlation', typeof explicitAxisCorrelation>
    | Recognized<'axis-quantile', typeof explicitAxisQuantile>
    | Recognized<'axis-window', typeof explicitAxisWindow>
    | Recognized<'axis-shift', typeof explicitAxisShift>
    | Recognized<'axis-shuffle', typeof explicitAxisShuffle>
    | Recognized<'axis-length', typeof explicitAxisLength>
    | Recognized<'axis-argsort', typeof explicitAxisArgsort>
    | Recognized<'axis-metric', typeof explicitAxisMetric>
    | Recognized<'axis-reduction', typeof axisReductionForm>
    | Recognized<'axis-transpose', typeof explicitAxisTranspose>
    | Recognized<'named-segment', typeof explicitNamedSegmentApplication>
    | Recognized<'named-scan', typeof explicitNamedScanApplication>
    | Recognized<'axis-selection', typeof explicitAxisSelection>
    | Recognized<'graph-edges', typeof explicitGraphEdges>
    | Recognized<'dsu-method', typeof explicitDsuMethod>
    | Recognized<'functional-method', typeof explicitFunctionalMethod>
    | Recognized<'multiset-method', typeof explicitMultisetMethod>
    | Recognized<'materialize-pipeline', typeof explicitMaterializePipeline>;

/** One ordered classification for runtime and analysis; never reads array cells. */
export function applicationForm(
    input: Expression | readonly Expression[], lookup: ApplicationLookup = findOperation,
    statement = false,
): ApplicationForm {
    const originals = new Map<Expression, Expression>();
    const normalize = (part: Expression): Expression => {
        if (!isNameExpression(part)) return part;
        const operation = lookup(part.name);
        // Receiver methods keep their contextual meaning even with a same-named function.
        const contextual = ['add', 'remove', 'findroot', 'merge', 'connected', 'jump', 'distance',
            'edges', 'floor', 'ceiling', 'lowerbound', 'upperbound'].includes(part.name);
        const name = operation === false ? (/^[A-Z]/.test(part.name) || contextual ? part.name : '\0' + part.name)
            : operation?.name ?? part.name;
        if (name === part.name) return part;
        const canonical = { ...part, name };
        originals.set(canonical, part);
        return canonical;
    };
    const restore = (value: unknown): unknown => {
        if (isExpression(value)) return originals.get(value) ?? value;
        if (value && typeof value === 'object' && 'module' in value && 'arities' in value) return value;
        if (Array.isArray(value)) return value.map(restore);
        if (value && typeof value === 'object') return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, restore(item)]));
        return value;
    };
    try {
        if (statement && !Array.isArray(input)) {
            const mutation = explicitCollectionMutation(input as Expression);
            if (mutation) return { kind: 'collection-mutation', ...mutation };
        }
        if (!Array.isArray(input) && isBinaryExpression(input)) {
            const comparison = lookup('rank') !== false && lookup('axis') !== false
                ? explicitComparisonRank(input) : undefined;
            if (comparison) return { kind: 'comparison-rank', ...comparison };
            return symbolicApplicationForm(input, name => lookup(name) !== false) ?? { kind: 'plain' };
        }
        const parts = (Array.isArray(input) ? input : flattenApplication(input as Expression)).map(normalize);
        if (parts.length === 2 && isNamed(parts[1], 'check') && isParenthesizedExpression(parts[0])) {
            let read = parts[0].value;
            while (isParenthesizedExpression(read)) read = read.value;
            parts.splice(0, 1, ...flattenApplication(read).map(normalize));
        }
        const form = classifyParts(parts, lookup);
        return originals.size ? restore(form) as ApplicationForm : form;
    } catch (error) {
        if (error instanceof ApplicationSyntaxError) return { kind: 'invalid', message: error.message };
        throw error;
    }
}

function classifyParts(parts: Expression[], lookup: ApplicationLookup): ApplicationForm {
    if (isNamed(parts[0], 'stack')) {
        const end = parts.findIndex((part, index) => {
            if (index <= 1 || !isNameExpression(part)) return false;
            const operation = lookup(part.name);
            return !!operation && operation.arities.length > 0;
        });
        const items = parts.slice(1, end < 0 ? undefined : end);
        if (!items.length) return { kind: 'invalid', message: 'stack expects one or more arrays or sequences' };
        return { kind: 'stack-constructor', items, rest: end < 0 ? [] : parts.slice(end) };
    }
    if (parts.slice(1).some(part => isNamed(part, 'stack'))) {
        return { kind: 'invalid', message: 'use stack A B to stack arrays' };
    }
    if (isNamed(parts.at(-1), 'check')) {
        const read = parts.slice(0, -1);
        const operation = read.find((part, index) => index > 0 && isNameExpression(part)
            && ['csv', 'json', 'xml'].includes(part.name));
        if (isNameExpression(operation)) {
            const reader = operation.name as 'csv' | 'json' | 'xml';
            const valid = read.length === 2 && read[1] === operation
                || reader !== 'csv' && read.length === 3
                    && (read[1] === operation && isLabelLiteral(read[2])
                        || read[2] === operation && isLabelLiteral(read[1]));
            if (!valid) return { kind: 'invalid', message: 'check must follow a CSV read or a JSON/XML parse' };
            return { kind: 'checked-read', reader, parts: read };
        }
    }
    const direction = sortDirectionForm(parts);
    if (direction) return direction;
    if (parts.some(isUnpackExpression)) return { kind: 'unpack' };
    if (isNewStructureExpression(parts[0]) && parts[0].structure === 'graph') return { kind: 'new-graph' };
    if (isNewStructureExpression(parts[0]) && parts[0].structure === 'dsu') return { kind: 'new-dsu' };
    if (isNewStructureExpression(parts[0]) && parts[0].structure === 'heap') {
        const direction = isLabelLiteral(parts.at(-1)) ? parts.at(-1) : undefined;
        const inputs = parts.slice(1, direction ? -1 : undefined);
        if (inputs.length > 2) return { kind: 'invalid', message: 'new heap takes one collection or priority and value arrays' };
        return { kind: 'new-heap', priorities: inputs.length === 2 ? inputs[0] : undefined,
            values: inputs.at(-1), direction };
    }
    // `new queue Items`: a collection filled from the items of one collection.
    if (isNewStructureExpression(parts[0]) && FILLED_STRUCTURES.has(parts[0].structure))
        return parts.length === 2 ? { kind: 'new-filled', structure: parts[0].structure }
            : { kind: 'invalid', message: `new ${parts[0].structure} takes one collection to fill it from` };
    const form0 = explicitNamedOuterApplication(parts);
    if (form0) return { ...form0, kind: 'named-outer' };
    const form1 = explicitRankApplication(parts);
    if (form1) return { ...form1, kind: 'rank' };
    const form2 = explicitAxisMatmul(parts);
    if (form2) return { ...form2, kind: 'axis-matmul' };
    const form3 = explicitAxisCovariance(parts);
    if (form3) return { ...form3, kind: 'axis-covariance' };
    const form4 = explicitAxisCorrelation(parts);
    if (form4) return { ...form4, kind: 'axis-correlation' };
    const form5 = explicitAxisQuantile(parts);
    if (form5) return { ...form5, kind: 'axis-quantile' };
    const position = parts.findIndex((part, index) => index > 0
        && isNamed(part, 'text') && isStringLiteral(parts[index + 1]));
    if (position >= 0) return { kind: 'text-format', position };
    const form7 = explicitAxisWindow(parts);
    if (form7) return { ...form7, kind: 'axis-window' };
    const formShift = explicitAxisShift(parts);
    if (formShift) return { ...formShift, kind: 'axis-shift' };
    const form8 = explicitAxisShuffle(parts);
    if (form8) return { ...form8, kind: 'axis-shuffle' };
    const form9 = explicitAxisLength(parts);
    if (form9) return { ...form9, kind: 'axis-length' };
    const form10 = explicitAxisArgsort(parts);
    if (form10) return { ...form10, kind: 'axis-argsort' };
    const form11 = explicitAxisMetric(parts);
    if (form11) return { ...form11, kind: 'axis-metric' };
    const form12 = axisReductionForm(parts);
    if (form12) return { ...form12, kind: 'axis-reduction' };
    const form13 = explicitAxisTranspose(parts);
    if (form13) return { ...form13, kind: 'axis-transpose' };
    const form14 = explicitNamedSegmentApplication(parts);
    if (form14) return { ...form14, kind: 'named-segment' };
    const form15 = explicitNamedScanApplication(parts);
    if (form15) return { ...form15, kind: 'named-scan' };
    const form16 = explicitAxisSelection(parts);
    if (form16) return { ...form16, kind: 'axis-selection' };
    const form17 = explicitGraphEdges(parts);
    if (form17) return { ...form17, kind: 'graph-edges' };
    const form18 = explicitDsuMethod(parts);
    if (form18) return { ...form18, kind: 'dsu-method' };
    const form19 = explicitFunctionalMethod(parts);
    if (form19) return { ...form19, kind: 'functional-method' };
    const form20 = explicitMultisetMethod(parts);
    if (form20) return { ...form20, kind: 'multiset-method' };
    const form21 = explicitMaterializePipeline(parts);
    if (form21) return { ...form21, kind: 'materialize-pipeline' };
    return { kind: 'plain' };
}

export function assertNever(value: never): never {
    throw new Error('unhandled application form: ' + JSON.stringify(value));
}

class ApplicationSyntaxError extends Error {}

function integerLiteral(expression: Expression, name: string): bigint {
    if (!isNumberLiteral(expression) || typeof expression.value !== 'bigint') {
        throw new ApplicationSyntaxError(name + ' expects nonnegative integer literals');
    }
    return expression.value;
}

function literalDimension(value: bigint, name: string): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApplicationSyntaxError(name + ' is too large: ' + value);
    return Number(value);
}

const COMPARISON_OPERATORS = new Set(['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost']);
function explicitAxisSelection(
    parts: Expression[],
): { source: Expression; axis: number; selector: Expression } | undefined {
    if (parts.length !== 4 || !isNamed(parts[1], 'axis')
        || !isNumberLiteral(parts[2]) || typeof parts[2].value !== 'bigint') return undefined;
    return {
        source: parts[0],
        axis: literalDimension(parts[2].value, 'axis'),
        selector: parts[3],
    };
}

function explicitAxisLength(
    parts: Expression[],
): { source: Expression; axis: number } | undefined {
    const form = axisLengthForm(parts);
    if (!form) return undefined;
    return {
        source: form.source,
        axis: literalDimension(integerLiteral(form.axis, 'len axis'), 'len axis'),
    };
}

function explicitAxisArgsort(
    parts: Expression[],
): { source: Expression; axis: number } | undefined {
    if (parts.length !== 4 || !isNamed(parts[1], 'argsort')
        || !isNamed(parts[2], 'axis')) return undefined;
    return {
        source: parts[0],
        axis: literalDimension(integerLiteral(parts[3], 'argsort axis'), 'argsort axis'),
    };
}

function explicitAxisShuffle(
    parts: Expression[],
): { source: Expression; seed?: Expression; axis: number } | undefined {
    const shuffle = parts.findIndex(part => isNamed(part, 'shuffle'));
    if (shuffle < 0 || !isNamed(parts[shuffle + 1], 'axis')) return undefined;
    if ((shuffle !== 1 && shuffle !== 2) || parts.length !== shuffle + 3) {
        throw new ApplicationSyntaxError('shuffle axis expects data, an optional seed and one axis');
    }
    return {
        source: parts[0],
        seed: shuffle === 2 ? parts[1] : undefined,
        axis: literalDimension(integerLiteral(parts[shuffle + 2], 'shuffle axis'), 'shuffle axis'),
    };
}

function explicitAxisQuantile(
    parts: Expression[],
): {
    source: Expression;
    q: Expression;
    isPercentile: boolean;
    axes: readonly number[];
} | undefined {
    if (parts.length < 5 || !isNamed(parts[3], 'axis')) return undefined;
    const name = isNameExpression(parts[2]) ? parts[2].name : undefined;
    if (name !== 'quantile' && name !== 'percentile') return undefined;
    return {
        source: parts[0],
        q: parts[1],
        isPercentile: name === 'percentile',
        axes: parts.slice(4).map(axis =>
            literalDimension(integerLiteral(axis, `${name} axis`), `${name} axis`)),
    };
}

function explicitAxisMetric(
    parts: Expression[],
): {
    left: Expression;
    right: Expression;
    metric: 'mse' | 'mae';
    axes: readonly number[];
} | undefined {
    if (parts.length < 4 || !isNamed(parts[3], 'axis')) return undefined;
    const metric = isNameExpression(parts[2]) ? parts[2].name : undefined;
    if (metric !== 'mse' && metric !== 'mae') return undefined;
    if (parts.length < 5) {
        throw new ApplicationSyntaxError(`${metric} axis expects one or more axes`);
    }
    return {
        left: parts[0],
        right: parts[1],
        metric,
        axes: parts.slice(4).map(axis =>
            literalDimension(integerLiteral(axis, `${metric} axis`), `${metric} axis`)),
    };
}

function explicitAxisTranspose(
    parts: Expression[],
): { source: Expression; axes: readonly number[] } | undefined {
    if (parts.length < 4 || !isNamed(parts[1], 'transpose')
        || !isNamed(parts[2], 'axis')) return undefined;
    return {
        source: parts[0],
        axes: parts.slice(3).map(axis =>
            literalDimension(integerLiteral(axis, 'transpose axis'), 'transpose axis')),
    };
}

interface AxisMatmulApplication {
    readonly left: Expression;
    readonly right: Expression;
    readonly axes: readonly [number, number];
}

function explicitAxisMatmul(parts: Expression[]): AxisMatmulApplication | undefined {
    if (parts.length < 4 || !isNamed(parts[2], 'matmul') || !isNamed(parts[3], 'axis')) {
        return undefined;
    }
    if (parts.length !== 6) {
        throw new ApplicationSyntaxError('matmul axis expects one axis for each operand');
    }
    return {
        left: parts[0],
        right: parts[1],
        axes: [
            literalDimension(integerLiteral(parts[4], 'matmul axis'), 'matmul axis'),
            literalDimension(integerLiteral(parts[5], 'matmul axis'), 'matmul axis'),
        ],
    };
}

interface AxisCovarianceApplication {
    readonly source: Expression;
    readonly name: string;
    readonly axes: readonly [number, number];
}

function explicitAxisCovariance(parts: Expression[]): AxisCovarianceApplication | undefined {
    if (parts.length < 3 || !isNamed(parts[1], 'covariance') || !isNamed(parts[2], 'axis')) {
        return undefined;
    }
    if (parts.length !== 5) {
        throw new ApplicationSyntaxError('covariance axis expects feature and observation axes');
    }
    return {
        source: parts[0],
        name: 'covariance',
        axes: [
            literalDimension(integerLiteral(parts[3], 'covariance axis'), 'covariance axis'),
            literalDimension(integerLiteral(parts[4], 'covariance axis'), 'covariance axis'),
        ],
    };
}

function explicitAxisCorrelation(parts: Expression[]): AxisCovarianceApplication | undefined {
    if (parts.length < 3 || (!isNamed(parts[1], 'correlation') && !isNamed(parts[1], 'corr')) || !isNamed(parts[2], 'axis')) {
        return undefined;
    }
    const name = isNamed(parts[1], 'corr') ? 'corr' : 'correlation';
    if (parts.length !== 5) {
        throw new ApplicationSyntaxError(`${name} axis expects feature and observation axes`);
    }
    return {
        source: parts[0],
        name,
        axes: [
            literalDimension(integerLiteral(parts[3], `${name} axis`), `${name} axis`),
            literalDimension(integerLiteral(parts[4], `${name} axis`), `${name} axis`),
        ],
    };
}


/** A rank is an integer literal; a negative rank counts down from the operand's own rank, as in J. */
function rankLiteral(part: Expression | undefined): number | undefined {
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    let value: bigint | undefined;
    if (part && isNumberLiteral(part) && typeof part.value === 'bigint') value = part.value;
    else if (part && isUnaryExpression(part) && part.operator === '-'
        && isNumberLiteral(part.operand) && typeof part.operand.value === 'bigint') value = -part.operand.value;
    if (value === undefined) return undefined;
    if (value > limit || value < -limit) throw new ApplicationSyntaxError('rank is too large: ' + value);
    return Number(value);
}

function explicitRankApplication(
    parts: Expression[],
): { parts: Expression[]; rank: bigint; rightRank?: bigint; axes?: readonly number[] } | undefined {
    // `rank L R` gives the left and right operands of a binary operation their own cell ranks.
    const [word, first, second] = parts.slice(-3);
    const leftRank = isNamed(word, 'rank') ? rankLiteral(first) : undefined;
    const rightRank = isNamed(word, 'rank') ? rankLiteral(second) : undefined;
    if (parts.length >= 3 && leftRank !== undefined && rightRank !== undefined) {
        const beforeRank = parts.slice(0, -3);
        if (beforeRank.length !== 3 || beforeRank.some(part => isNamed(part, 'axis'))) {
            throw new ApplicationSyntaxError('rank L R expects two operands and a binary operation');
        }
        return { parts: beforeRank, rank: BigInt(leftRank), rightRank: BigInt(rightRank) };
    }
    const modifier = parts.at(-2);
    const rank = parts.at(-1);
    if (!modifier || !rank || !isNameExpression(modifier) || modifier.name !== 'rank') return undefined;
    const cellRank = rankLiteral(rank);
    if (cellRank === undefined) throw new ApplicationSyntaxError('rank expects an integer');
    const beforeRank = parts.slice(0, -2);
    if (beforeRank.length < 2) throw new ApplicationSyntaxError('rank requires data and a unary operation');
    const axisPosition = beforeRank.findIndex(part => isNamed(part, 'axis'));
    if (axisPosition < 0) return { parts: beforeRank, rank: BigInt(cellRank) };
    if (axisPosition !== 2 || beforeRank.length === 3) {
        throw new ApplicationSyntaxError(
            'axis rank expects data and a unary operation followed by one or more frame axes',
        );
    }
    return {
        parts: beforeRank.slice(0, axisPosition),
        rank: BigInt(cellRank),
        axes: beforeRank.slice(axisPosition + 1).map(axis =>
            literalDimension(integerLiteral(axis, 'axis rank'), 'axis rank')),
    };
}

interface OuterApplication {
    readonly operator: string;
    readonly left: Expression;
    readonly right: Expression;
}

interface ComparisonRank extends OuterApplication {
    readonly rank: number;
    readonly axes?: readonly number[];
}

function explicitComparisonRank(expression: Expression): ComparisonRank | undefined {
    if (!isBinaryExpression(expression) || !COMPARISON_OPERATORS.has(expression.operator)) return undefined;
    const parts = flattenApplication(expression.right);
    if (!isNamed(parts[0], 'rank') && !isNamed(parts[0], 'axis')) return undefined;
    const rankIndex = parts.findIndex(part => isNamed(part, 'rank'));
    if (rankIndex < 0 || rankIndex !== parts.length - 2
        || (isNamed(parts[0], 'rank') ? rankIndex !== 0 : rankIndex < 2)) {
        throw new ApplicationSyntaxError('comparison expects rank R or axis A ... rank R');
    }
    const rank = literalDimension(integerLiteral(parts[rankIndex + 1], 'rank'), 'rank');
    const axes = rankIndex === 0 ? undefined : parts.slice(1, rankIndex)
        .map(axis => literalDimension(integerLiteral(axis, 'axis'), 'axis'));
    const operands = flattenApplication(expression.left);
    if (operands.length !== 2) throw new ApplicationSyntaxError(`rank comparison expects two operands, got ${operands.length}`);
    return { operator: expression.operator, left: operands[0], right: operands[1], rank, axes };
}


/** `Values Count shift [with Fill] [axis K]`; the bare form is an ordinary operation. */
function explicitAxisShift(
    parts: Expression[],
): { source: Expression; amount: Expression; fill?: Expression; axis?: number } | undefined {
    if (parts.length < 5 || !isNamed(parts[2], 'shift')) return undefined;
    let position = 3;
    let fill: Expression | undefined;
    let axis: number | undefined;
    if (isNamed(parts[position], 'with')) {
        fill = parts[position + 1];
        if (!fill) return undefined;
        position += 2;
    }
    if (isNamed(parts[position], 'axis')) {
        if (position + 2 !== parts.length) {
            throw new ApplicationSyntaxError('shift axis expects exactly one axis');
        }
        axis = literalDimension(integerLiteral(parts[position + 1], 'shift axis'), 'shift axis');
        position += 2;
    }
    if (position !== parts.length || (!fill && axis === undefined)) return undefined;
    return { source: parts[0], amount: parts[1], fill, axis };
}

interface AxisWindowApplication {
    readonly source: Expression;
    readonly size: Expression;
    readonly axes?: readonly number[];
    readonly stride?: Expression;
    readonly padding?: Expression;
    readonly fill?: Expression;
}

function explicitAxisWindow(parts: Expression[]): AxisWindowApplication | undefined {
    if (parts.length < 5 || !isNamed(parts[2], 'window')) return undefined;
    let position = 3;
    let stride: Expression | undefined;
    let padding: Expression | undefined;
    let fill: Expression | undefined;
    let axes: readonly number[] | undefined;

    if (isNamed(parts[position], 'stride')) {
        stride = parts[position + 1];
        if (!stride) return undefined;
        position += 2;
    }
    if (isNamed(parts[position], 'padding')) {
        padding = parts[position + 1];
        if (!padding) return undefined;
        position += 2;
        if (isNamed(parts[position], 'with')) {
            fill = parts[position + 1];
            if (!fill) return undefined;
            position += 2;
        }
    }
    if (isNamed(parts[position], 'axis')) {
        if (position + 1 >= parts.length) return undefined;
        axes = parts.slice(position + 1).map(axis =>
            literalDimension(integerLiteral(axis, 'window axis'), 'window axis'));
        position = parts.length;
    }
    if (position !== parts.length || (!stride && !padding && !axes)) return undefined;
    return {
        source: parts[0],
        size: parts[1],
        axes,
        stride,
        padding,
        fill,
    };
}
