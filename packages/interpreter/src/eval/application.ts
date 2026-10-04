import {
    applicationExpression as applicationParts, applicationForm, assertNever, flattenApplication, isAllAxisExpression,
    isApplicationExpression, isLabelLiteral, isNameExpression, isNumberLiteral, isStringLiteral, isUnpackExpression,
    renamedBuiltinCall, type ApplicationForm, type ArrayItem, type Expression, type Operation,
} from '@arrrank/language';
import { RankError } from '../errors.js';
import {
    completed, flatMapResult, mapExecution, mapResult, resume, type Evaluation, type Execution,
} from '../execution.js';
import type { FastPaths } from '../fast-paths.js';
import type { FunctionInvocation } from '../function-invocation.js';
import { graphConstructor } from '../graph.js';
import { addToCollection, newStructure } from '../collections.js';
import { pushCollection, RankHeap } from '../containers.js';
import { dsuFrom } from '../dsu.js';
import { finiteValues } from '../multiset.js';
import type { BuiltinRegistry } from '../modules/builtins.js';
import { fenwickSum, multisetQuery, namedSegment, symbolicSegment } from '../modules/algo.js';
import { dsuQuery, functionalQuery } from '../modules/graph.js';
import { matmulValues } from '../modules/linalg.js';
import { shuffleValue } from '../modules/random.js';
import {
    argsortAxis, directedSort, lengthOfAxis, materializeCollection, sortDescending, sortMode, transposeValue,
    type SortMode,
} from '../modules/sequences.js';
import { correlationValue, covarianceValue, errorMetricValue, quantileValue } from '../modules/stats.js';
import { formattedText } from '../modules/text.js';
import { type Operators } from '../operators.js';
import { dyadicCells, type RankApplication } from '../rank-application.js';
import type { ReductionEvaluator } from '../reduction.js';
import type { ResourceOwnership } from '../resource-ownership.js';
import { ALL_AXIS, selectAxis } from '../selectors.js';
import { materializeSequence, shiftValue, windowValue } from '../sequence.js';
import { safeDimension } from '../tensor-index.js';
import { callArguments, canApplySelectors, hasField, unpackApplicationItems } from '../value-selection.js';
import {
    isNativeFunction, isRankArray, isRankDsu, isRankFenwick, isRankFunctionalGraph, isRankGraph, isRankLabel,
    isRankMultiset, isRankSequence, typeName,
    type RankValue,
} from '../value.js';

/** What evaluating application forms needs from the rest of evaluation. */
export interface ApplicationContext {
    evaluate(expression: Expression): Evaluation<RankValue>;
    checkInput(expression: Expression, value: RankValue, source: string): void;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** Evaluation of an expression that is not an application, without classifying it again. */
    compile(expression: Expression, missing?: () => RankValue, tail?: boolean, classify?: boolean): () => Evaluation<RankValue>;
    evaluateArrayItem(item: ArrayItem): Execution<RankValue>;
    /** Builtin identity a name is bound to, or false for a user value; never runs user code. */
    operationOf(name: string): Operation | undefined | false;
    resolve(name: string): RankValue;
    select(values: RankValue[], missing?: () => RankValue): RankValue;
    requireModule(module: string, operation: string): void;
    readonly random: () => number;
    readonly operators: Operators;
    readonly reductions: ReductionEvaluator;
    readonly rankApplication: RankApplication;
    readonly builtins: BuiltinRegistry;
    readonly resources: ResourceOwnership;
    readonly functions: FunctionInvocation;
    readonly fastPaths: FastPaths;
}

/**
 * Applications: a value followed by functions, modifiers and selectors. The
 * form is classified once per binding identity in language; this owner
 * evaluates each form kind, then applies functions to the data before them
 * and selects from what remains.
 */
export class ApplicationEvaluator {
    constructor(private readonly context: ApplicationContext) {}

    /** The evaluation of one classified application form. */
    compileForm(
        expression: Expression, form: ApplicationForm, missing?: () => RankValue, tail = false,
    ): () => Evaluation<RankValue> {
        const context = this.context;
        const application = this;
        const parts = flattenApplication(expression);
        switch (form.kind) {
            case 'checked-read': {
                const read = applicationParts(form.parts, expression);
                const first = form.parts[0];
                const source = form.reader === 'csv' && isStringLiteral(first) ? first.value : `${form.reader} input`;
                return () => mapResult(context.evaluate(read), value => {
                    context.checkInput(expression, value, source);
                    return value;
                });
            }
            case 'collection-mutation': throw new RankError('collection mutation requires a statement');
            case 'invalid': throw new RankError(form.message);
            case 'comparison-rank': {
                const comparison = form;
                return function* (): Execution<RankValue> {
                    const left = yield* resume(context.evaluate(comparison.left));
                    const right = yield* resume(context.evaluate(comparison.right));
                    return context.operators.compareAtRank(left, right, comparison);
                };
            }
            case 'outer': {
                const outer = form;
                if (outer.operands.length !== 2) {
                    throw new RankError(`outer expects two operands, got ${outer.operands.length}`);
                }
                return function* (): Execution<RankValue> {
                    return context.operators.evaluateOuter(
                        outer.operator,
                        (yield* resume(context.evaluate(outer.operands[0]))),
                        (yield* resume(context.evaluate(outer.operands[1]))),
                    );
                };
            }
            case 'segment': {
                const segment = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('algo', 'segment');
                    const build = symbolicSegment(segment.operator, context.operators);
                    return build(yield* resume(context.evaluate(segment.source)));
                };
            }
            case 'scan': {
                const scan = form;
                if (scan.axis !== undefined) {
                    const axis = safeDimension(integerLiteral(scan.axis, 'scan axis'), 'scan axis');
                    return function* (): Execution<RankValue> {
                        const source = yield* resume(context.evaluate(scan.source));
                        return context.reductions.evaluateScanAxis(scan.operator, source, axis);
                    };
                }
                return function* (): Execution<RankValue> {
                    const source = yield* resume(context.evaluate(scan.source));
                    const seed = scan.seed === undefined
                        ? undefined
                        : yield* resume(context.evaluate(scan.seed));
                    return context.reductions.evaluateScan(
                        scan.operator,
                        source,
                        seed,
                    );
                };
            }
            case 'reduce': {
                const reduction = { ...form, rank: form.rank === undefined ? undefined
                    : safeDimension(integerLiteral(form.rank, 'rank'), 'rank') };
                const fused = context.fastPaths.application(form, parts, {
                    reduce: (operator, value) => context.reductions.evaluateReduction(operator, value),
                    apply: values => application.apply(values, missing, 0, [], tail),
                });
                if (fused) return fused;
                return function* (): Execution<RankValue> {
                    const source = yield* resume(context.evaluate(reduction.source));
                    const seed = reduction.seed === undefined
                        ? undefined
                        : yield* resume(context.evaluate(reduction.seed));
                    return context.reductions.evaluateReduction(
                        reduction.operator,
                        source,
                        reduction.rank,
                        seed,
                    );
                };
            }
            case 'sort-direction': {
                const sortDirection = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('sequences', 'sort direction');
                    const all = flattenApplication(expression);
                    let labelStart = all.length;
                    while (labelStart > 1 && isLabelLiteral(all[labelStart - 1])) labelStart--;
                    // `Values sort .indexes .descending`: the labels may come in either order.
                    const labels = labelStart < all.length ? all.slice(labelStart)
                        : [sortDirection.direction];
                    const parts = labelStart < all.length ? all.slice(0, labelStart) : all.slice(0, -1);
                    const inner = applicationForm(parts, name => context.operationOf(name));
                    if (inner.kind === 'invalid') throw new RankError(inner.message);
                    const axis = inner.kind === 'axis-argsort' ? inner : undefined;
                    const ranked = inner.kind === 'rank' ? inner : undefined;
                    const name = sortDirection.operation.name;
                    if (name !== 'sort' && name !== 'argsort') {
                        throw new RankError('sort direction must follow sort or argsort', 'TypeError');
                    }
                    const fn = context.resolve(name);
                    if (!context.builtins.is('sequences', name, fn) || !isNativeFunction(fn)) {
                        throw new RankError('sort direction requires the standard sort or argsort', 'TypeError');
                    }
                    let descending: boolean | undefined;
                    let mode: SortMode | undefined;
                    for (const label of labels) {
                        const value = yield* resume(context.evaluate(label));
                        const picked = sortMode(value);
                        if (picked) {
                            if (mode) throw new RankError('sort accepts one of .indexes and .indexed', 'TypeError');
                            if (name !== 'sort') throw new RankError(`argsort does not accept .${picked}`, 'TypeError');
                            mode = picked;
                        } else {
                            if (descending !== undefined) throw new RankError('sort direction given twice', 'TypeError');
                            descending = sortDescending(value);
                        }
                    }
                    if (axis) return argsortAxis(yield* resume(context.evaluate(axis.source)), axis.axis, descending ?? false);
                    const source = yield* resume(context.evaluate(applicationParts((ranked?.parts ?? parts).slice(0, -1))));
                    const directed = directedSort(fn, name, descending ?? false, mode);
                    return yield* resume(ranked
                        ? application.applyAtRank([source, directed], ranked.rank, ranked.axes)
                        : context.rankApplication.applyIntrinsicRank(directed, [source]));
                };
            }

            case 'unpack': {
                return function* (): Execution<RankValue> {
                    const values: RankValue[] = [];
                    for (const part of parts) {
                        if (isUnpackExpression(part)) {
                            const source = yield* resume(context.evaluate(part.value));
                            values.push(...unpackApplicationItems(source));
                        } else {
                            values.push(isAllAxisExpression(part)
                                ? ALL_AXIS
                                : yield* resume(context.evaluate(part)));
                        }
                    }
                    return yield* resume(application.apply(values, missing, 0, [], tail));
                };
            }
            case 'new-graph': {
                return function* (): Execution<RankValue> {
                    context.requireModule('graph', 'new graph');
                    const constructor = graphConstructor();
                    if (!isNativeFunction(constructor)) {
                        throw new RankError('invalid graph constructor');
                    }
                    const arguments_ = yield* resume(mapExecution(
                        parts.slice(1),
                        part => context.evaluate(part),
                    ));
                    return constructor.call(arguments_);
                };
            }
            case 'new-dsu': {
                if (parts.length !== 2) throw new RankError('new dsu expects one collection');
                return function* (): Execution<RankValue> {
                    context.requireModule('graph', 'new dsu');
                    return dsuFrom(yield* resume(context.evaluate(parts[1])));
                };
            }
            case 'new-filled': {
                const structure = form.structure;
                return function* (): Execution<RankValue> {
                    context.requireModule('algo', 'new');
                    const filled = newStructure(structure);
                    const items = yield* resume(context.evaluate(parts[1]));
                    for (const item of finiteValues(items)) {
                        if (['queue', 'stack', 'deque', 'heap'].includes(structure)) pushCollection(filled, item);
                        else addToCollection(filled, item);
                    }
                    return filled;
                };
            }
            case 'new-heap': {
                const heapForm = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('algo', 'new');
                    const direction = heapForm.direction && (yield* resume(context.evaluate(heapForm.direction)));
                    if (direction !== undefined && (!isRankLabel(direction)
                        || !['ascending', 'descending'].includes(direction.name))) {
                        throw new RankError('heap direction must be .ascending or .descending', 'TypeError');
                    }
                    const heap = new RankHeap(direction !== undefined && direction.name === 'descending');
                    const priorities = heapForm.priorities && (yield* resume(context.evaluate(heapForm.priorities)));
                    const values = heapForm.values && (yield* resume(context.evaluate(heapForm.values)));
                    if (priorities !== undefined) {
                        if (!isRankArray(priorities) || priorities.shape.length !== 1
                            || values === undefined || !isRankArray(values) || values.shape.length < 1) {
                            throw new RankError('new heap priorities must be a vector and values must be an array', 'DimensionMismatch');
                        }
                        if (priorities.shape[0] !== values.shape[0]) {
                            throw new RankError('heap priorities and values must have the same length', 'DimensionMismatch');
                        }
                        const cells = dyadicCells(values, values.shape.length - 1);
                        const payloads = Array.from({ length: values.shape[0] }, (_, index) => cells.cellAt(index));
                        return heap.fill([...finiteValues(priorities)], payloads);
                    }
                    if (values !== undefined) {
                        const items = [...finiteValues(values)];
                        return heap.fill(items, items);
                    }
                    return heap;
                };
            }
            case 'named-outer': {
                const namedOuter = form;
                return function* (): Execution<RankValue> {
                    const operation = (yield* resume(context.evaluate(namedOuter.operation)));
                    if (!isNativeFunction(operation)) {
                        throw new RankError('outer expects a binary function');
                    }
                    return context.operators.evaluateNamedOuter(
                        operation,
                        (yield* resume(context.evaluate(namedOuter.left))),
                        (yield* resume(context.evaluate(namedOuter.right))),
                    );
                };
            }
            case 'rank': {
                const explicitRank = form;
                return function* (): Execution<RankValue> {
                    if (explicitRank.parts.length === 3) {
                        const left = yield* resume(context.evaluate(explicitRank.parts[0]));
                        const right = yield* resume(context.evaluate(explicitRank.parts[1]));
                        const operation = yield* resume(context.evaluate(explicitRank.parts[2]));
                        if (isNativeFunction(operation) && (operation.dyadicRanks || operation.arities.includes(2))) {
                            return yield* resume(context.rankApplication.applyDyadicAtRank(
                                left, right, operation, Number(explicitRank.rank),
                                explicitRank.rightRank === undefined ? undefined : Number(explicitRank.rightRank),
                            ));
                        }
                    }
                    if (explicitRank.rightRank !== undefined) {
                        throw new RankError('rank L R expects a binary operation');
                    }
                    const source = yield* resume(context.evaluate(
                        applicationParts(explicitRank.parts.slice(0, -1)),
                    ));
                    const operation = yield* resume(context.evaluate(explicitRank.parts.at(-1)!));
                    return yield* resume(application.applyAtRank([source, operation], explicitRank.rank, explicitRank.axes));
                };
            }
            case 'axis-matmul': {
                const axisMatmul = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('linalg', 'matmul');
                    return matmulValues(
                        (yield* resume(context.evaluate(axisMatmul.left))),
                        (yield* resume(context.evaluate(axisMatmul.right))),
                        axisMatmul.axes,
                    );
                };
            }
            case 'axis-covariance': {
                const axisCovariance = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('stats', 'covariance');
                    return covarianceValue(
                        (yield* resume(context.evaluate(axisCovariance.source))),
                        axisCovariance.axes,
                    );
                };
            }
            case 'axis-correlation': {
                const axisCorrelation = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('stats', axisCorrelation.name);
                    return correlationValue(
                        (yield* resume(context.evaluate(axisCorrelation.source))),
                        axisCorrelation.axes,
                    );
                };
            }
            case 'axis-quantile': {
                const axisQuantile = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('stats', axisQuantile.isPercentile ? 'percentile' : 'quantile');
                    return quantileValue(
                        (yield* resume(context.evaluate(axisQuantile.source))),
                        (yield* resume(context.evaluate(axisQuantile.q))),
                        axisQuantile.axes,
                        axisQuantile.isPercentile,
                    );
                };
            }
            case 'text-format': {
                const textFormat = form.position;
                const format = parts[textFormat + 1];
                if (!isStringLiteral(format)) throw new RankError('expected text format');
                return function* (): Execution<RankValue> {
                    const values = yield* resume(mapExecution(parts.slice(0, textFormat),
                        part => context.evaluate(part)));
                    const source = values.length === 1 ? values[0] : yield* resume(application.apply(values));
                    const result = formattedText(source, format.value);
                    const remaining = yield* resume(mapExecution(parts.slice(textFormat + 2),
                        part => context.evaluate(part)));
                    return remaining.length ? yield* resume(application.apply([result, ...remaining], missing, 0, [], tail)) : result;
                };
            }
            case 'axis-window': {
                const axisWindow = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('sequences', 'window');
                    return windowValue(
                        (yield* resume(context.evaluate(axisWindow.source))),
                        (yield* resume(context.evaluate(axisWindow.size))),
                        axisWindow.axes,
                        axisWindow.stride
                            ? (yield* resume(context.evaluate(axisWindow.stride)))
                            : undefined,
                        axisWindow.padding
                            ? (yield* resume(context.evaluate(axisWindow.padding)))
                            : undefined,
                        axisWindow.fill
                            ? (yield* resume(context.evaluate(axisWindow.fill)))
                            : undefined,
                    );
                };
            }
            case 'axis-shift': {
                const axisShift = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('sequences', 'shift');
                    return shiftValue(
                        (yield* resume(context.evaluate(axisShift.source))),
                        (yield* resume(context.evaluate(axisShift.amount))),
                        axisShift.fill
                            ? (yield* resume(context.evaluate(axisShift.fill)))
                            : undefined,
                        axisShift.axis,
                    );
                };
            }
            case 'axis-shuffle': {
                const axisShuffle = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('random', 'shuffle');
                    return shuffleValue(
                        (yield* resume(context.evaluate(axisShuffle.source))),
                        axisShuffle.seed ? (yield* resume(context.evaluate(axisShuffle.seed))) : undefined,
                        axisShuffle.axis,
                        context.random,
                    );
                };
            }
            case 'axis-length': {
                const axisLength = form;
                return function* (): Execution<RankValue> {
                    return lengthOfAxis((yield* resume(context.evaluate(axisLength.source))), axisLength.axis);
                };
            }
            case 'axis-argsort': {
                const axisArgsort = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('sequences', 'argsort');
                    return argsortAxis(
                        (yield* resume(context.evaluate(axisArgsort.source))),
                        axisArgsort.axis,
                    );
                };
            }
            case 'axis-metric': {
                const axisMetric = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('stats', axisMetric.metric);
                    return errorMetricValue(
                        (yield* resume(context.evaluate(axisMetric.left))),
                        (yield* resume(context.evaluate(axisMetric.right))),
                        axisMetric.metric,
                        axisMetric.axes,
                    );
                };
            }
            case 'axis-reduction': {
                const axisReduction = form;
                const axes = axisReduction.axes.map(axis =>
                    safeDimension(integerLiteral(axis, `${axisReduction.operation.name} axis`),
                        `${axisReduction.operation.name} axis`));
                return function* (): Execution<RankValue> {
                    context.requireModule(axisReduction.operation.module, axisReduction.operation.name);
                    return context.reductions.evaluateAxisReduction(
                        axisReduction.operation.name,
                        (yield* resume(context.evaluate(axisReduction.source))),
                        axes,
                    );
                };
            }
            case 'axis-transpose': {
                const axisTranspose = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('sequences', 'transpose');
                    return transposeValue(
                        (yield* resume(context.evaluate(axisTranspose.source))),
                        axisTranspose.axes,
                    );
                };
            }
            case 'named-segment': {
                const segment = form;
                return function* (): Execution<RankValue> {
                    context.requireModule('algo', 'segment');
                    const source = yield* resume(context.evaluate(segment.source));
                    const identity = segment.identity
                        ? yield* resume(context.evaluate(segment.identity)) : undefined;
                    const operation = yield* resume(context.evaluate(segment.operation));
                    return namedSegment(source, operation, identity, context.builtins.standard('algo', 'maxsum'));
                };
            }
            case 'named-scan': {
                const namedScan = form;
                const namedAxis = namedScan.axis === undefined ? undefined
                    : safeDimension(integerLiteral(namedScan.axis, 'scan axis'), 'scan axis');
                return function* (): Execution<RankValue> {
                    const source = yield* resume(context.evaluate(namedScan.source));
                    const seed = namedScan.seed === undefined
                        ? undefined : yield* resume(context.evaluate(namedScan.seed));
                    const operation = yield* resume(context.evaluate(namedScan.operation));
                    if (!isNativeFunction(operation) || !operation.arities.includes(2)) {
                        throw new RankError('scan requires a binary operation');
                    }
                    if (namedAxis !== undefined) {
                        return context.reductions.evaluateNamedScanAxis(operation, source, namedAxis);
                    }
                    return context.reductions.evaluateNamedScan(operation, source, seed);
                };
            }
            case 'axis-selection': {
                const axisSelection = form;
                return function* (): Execution<RankValue> {
                    return selectAxis(
                        (yield* resume(context.evaluate(axisSelection.source))),
                        axisSelection.axis,
                        (yield* resume(context.evaluate(axisSelection.selector))),
                    );
                };
            }
            case 'graph-edges': {
                const graphEdges = form;
                return function* (): Execution<RankValue> {
                    const receiver = yield* resume(context.evaluate(
                        graphEdges.receiver,
                    ));
                    const argument = yield* resume(context.evaluate(
                        graphEdges.argument,
                    ));
                    if (isRankGraph(receiver)) {
                        context.requireModule('graph', 'edges');
                        return receiver.edges(argument);
                    }
                    const operation = yield* resume(context.evaluate(
                        graphEdges.operation,
                    ));
                    return yield* resume(application.apply(
                        [receiver, argument, operation],
                        missing,
                        0,
                        [],
                        tail,
                    ));
                };
            }
            case 'dsu-method': {
                const dsuMethod = form;
                return function* (): Execution<RankValue> {
                    const receiver = yield* resume(context.evaluate(dsuMethod.receiver));
                    const arguments_ = yield* resume(mapExecution(
                        dsuMethod.arguments,
                        argument => context.evaluate(argument),
                    ));
                    if (isRankDsu(receiver)) {
                        context.requireModule('graph', dsuMethod.operation);
                        if (dsuMethod.operation === 'findroot' && isRankArray(arguments_[0])) {
                                // One representative per queried value, in the shape of the queries.
                                const operation = yield* resume(context.evaluate(dsuMethod.operationExpression));
                            if (isNativeFunction(operation)) {
                                return yield* resume(context.rankApplication.applyDyadicAtRank(
                                    receiver, arguments_[0], operation,
                                ));
                            }
                        }
                        return dsuQuery(receiver, dsuMethod.operation, arguments_);
                    }
                    const operation = yield* resume(context.evaluate(dsuMethod.operationExpression));
                    return yield* resume(application.apply(
                        [receiver, ...arguments_, operation], missing, 0, [], tail,
                    ));
                };
            }
            case 'functional-method': {
                const functionalMethod = form;
                return function* (): Execution<RankValue> {
                    const receiver = yield* resume(context.evaluate(
                        functionalMethod.receiver,
                    ));
                    const arguments_ = yield* resume(mapExecution(
                        functionalMethod.arguments,
                        argument => context.evaluate(argument),
                    ));
                    if (isRankFunctionalGraph(receiver)) {
                        context.requireModule('graph', functionalMethod.operation);
                        return functionalQuery(receiver, functionalMethod.operation, arguments_);
                    }
                    const operation = yield* resume(context.evaluate(
                        functionalMethod.operationExpression,
                    ));
                    return yield* resume(application.apply(
                        [receiver, ...arguments_, operation], missing, 0, [], tail,
                    ));
                };
            }
            case 'multiset-method': {
                const multisetMethod = form;
                return function* (): Execution<RankValue> {
                    const receiverParts = yield* resume(mapExecution(
                        multisetMethod.receiver,
                        part => context.evaluate(part),
                    ));
                    const argumentParts = yield* resume(mapExecution(
                        multisetMethod.argument,
                        part => context.evaluate(part),
                    ));
                    const receiverValue = receiverParts.length === 1
                        ? receiverParts[0]
                        : yield* resume(application.apply(receiverParts));
                    const argumentValue = argumentParts.length === 1
                        ? argumentParts[0]
                        : yield* resume(application.apply(argumentParts));
                    if (isRankMultiset(receiverValue)) {
                        context.requireModule('algo', multisetMethod.operation);
                        if (isRankArray(argumentValue)) {
                            // Many queries against one structure: the operation's intrinsic ranks
                            // split the queries into scalar cells.
                            const operation = yield* resume(context.evaluate(
                                parts[multisetMethod.receiver.length],
                            ));
                            if (isNativeFunction(operation)) {
                                return yield* resume(context.rankApplication.applyDyadicAtRank(
                                    receiverValue, argumentValue, operation,
                                ));
                            }
                        }
                        return multisetQuery(receiverValue, multisetMethod.operation, argumentValue);
                    }
                    const operation = yield* resume(context.evaluate(
                        parts[multisetMethod.receiver.length],
                    ));
                    return yield* resume(application.apply(
                        [receiverValue, argumentValue, operation],
                        missing,
                        0,
                        [],
                        tail,
                    ));
                };
            }
            case 'materialize-pipeline': {
                const materializePipeline = form;
                return function* (): Execution<RankValue> {
                    const sourceParts = yield* resume(mapExecution(
                        materializePipeline.source,
                        part => context.evaluate(part),
                    ));
                    const source = sourceParts.length === 1
                        ? sourceParts[0]
                        : yield* resume(application.apply(sourceParts));
                    // A sequence or a container with a defined order materializes; others are selected from.
                    const materialized = isRankSequence(source) ? materializeSequence(source) : materializeCollection(source);
                    if (materialized) {
                        let result: RankValue = materialized;
                        for (const item of materializePipeline.steps) {
                            result = yield* resume(application.apply([
                                result,
                                yield* resume(context.evaluateArrayItem(item)),
                            ], missing, 0, [], tail));
                        }
                        return result;
                    }
                    const selector = yield* resume(context.evaluate(materializePipeline.selector));
                    return yield* resume(application.apply(
                        [source, selector], missing, 0, [], tail,
                    ));
                };
            }
            case 'plain': {
                if (!isApplicationExpression(expression)) return context.compile(expression, missing, tail, false);
                const fused = context.fastPaths.application(form, parts, {
                    reduce: (operator, value) => context.reductions.evaluateReduction(operator, value),
                    apply: values => application.apply(values, missing, 0, [], tail),
                });
                if (fused) return fused;
                if (parts.some((part, index) => index > 0 && isNamed(part, 'sum'))) {
                    return function* (): Execution<RankValue> {
                        let pending: RankValue[] = [];
                        for (let index = 0; index < parts.length; index += 1) {
                            const part = parts[index];
                            // Resolve receiver methods before looking up ordinary functions.
                            // Each operation consumes its arguments and leaves its result
                            // available to the remainder of the postfix chain.
                            if (isNamed(part, 'sum')) {
                                const receiver = pending.length === 1 ? pending[0]
                                    : canApplySelectors(pending) ? context.select(pending) : undefined;
                                if (receiver !== undefined && isRankFenwick(receiver)) {
                                    context.requireModule('algo', 'fenwick');
                                    const argument = parts[++index];
                                    if (!argument) throw new RankError('fenwick sum expects one integer index');
                                    const position = yield* resume(context.evaluate(argument));
                                    pending = [fenwickSum(receiver, position)];
                                    continue;
                                }
                            }
                            const value = isAllAxisExpression(part)
                                ? ALL_AXIS : yield* resume(context.evaluate(part));
                            pending.push(value);
                            if (isNativeFunction(value)) {
                                pending = [yield* resume(application.apply(
                                    pending, missing, 0, [], tail && index === parts.length - 1,
                                ))];
                            }
                        }
                        return pending.length === 1
                            ? pending[0] : context.select(pending, missing);
                    };
                }
                return application.compileApplication(parts, missing, tail);
            }
            default: return assertNever(form);
        }
    }

    private compileApplication(
        parts: Expression[], missing?: () => RankValue, tail = false,
    ): () => Evaluation<RankValue> {
        const context = this.context;
        const application = this;
        const renamed = renamedBuiltinCall(parts);
        const checkRename = renamed ? (receiver: RankValue): void => {
            if (typeName(receiver) === renamed.receiver
                && context.operationOf(renamed.operation.name) !== false) {
                throw new RankError(renamed.message, 'BuiltinRename');
            }
        } : undefined;
        const directParts = parts.map(part => isAllAxisExpression(part)
            ? () => ALL_AXIS : context.compileDirect(part));
        if (directParts.every(part => part !== undefined)) {
            const last = parts.at(-1)!;
            if (!tail && (parts.length === 2 || parts.length === 3) && isNameExpression(last)) {
                const [left, right, operation] = directParts;
                const binary = parts.length === 3;
                return () => {
                    const a = left();
                    checkRename?.(a);
                    const b = binary ? right() : undefined;
                    const arguments_ = binary ? [a, b!] : [a];
                    // `Record .field fn` reads the field first, on the general path.
                    const simple = !isNativeFunction(a) && (b === undefined || !isNativeFunction(b))
                        && !(b !== undefined && isRankLabel(b) && hasField(a, b.name));
                    const fn = (binary ? operation : right)();
                    if (simple && isNativeFunction(fn) && fn.arities.includes(arguments_.length)) {
                        const result = context.rankApplication.applyIntrinsicRank(fn, arguments_);
                        if ('done' in result) {
                            context.resources.ownFiles(result.value);
                            return result;
                        }
                        return application.finishApplication(result);
                    }
                    return application.apply([...arguments_, fn], missing, 0, [], tail);
                };
            }
            return () => application.apply(directParts.map((part, index) => {
                const value = part();
                if (index === 0) checkRename?.(value);
                return value;
            }), missing, 0, [], tail);
        }
        return () => flatMapResult(mapExecution(parts, part => {
            const task = isAllAxisExpression(part) ? completed(ALL_AXIS) : context.evaluate(part);
            return checkRename && part === parts[0] ? mapResult(task, value => {
                checkRename(value);
                return value;
            }) : task;
        }), values => application.apply(values, missing, 0, [], tail));
    }

    /** Applies each function in `values` to the data before it, left to right; plain data is selection. */
    apply(
        values: RankValue[],
        missing?: () => RankValue,
        start = 0,
        pending: RankValue[] = [],
        tail = false,
    ): Evaluation<RankValue> {
        const context = this.context;
        const application = this;
        if (start === 0 && !values.some(isNativeFunction)) return completed(context.select(values, missing));

        for (let index = start; index < values.length; index += 1) {
            const value = values[index];
            if (!isNativeFunction(value)) {
                pending.push(value);
                continue;
            }
            if (pending.length === 0) {
                throw new RankError(`operation must follow its data: ${value.name}`);
            }
            const arguments_ = callArguments(
                value,
                pending,
                parts => context.select(parts),
            );
            if (tail && index === values.length - 1 && context.resources.currentScopeEmpty()) {
                context.functions.throwTailCall(value, arguments_);
            }
            const task = context.rankApplication.applyIntrinsicRank(value, arguments_);
            if (!('done' in task)) return application.continueApplication(values, missing, index + 1, task, tail);
            context.resources.ownFiles(task.value);
            pending = [task.value];
        }
        return completed(pending.length === 1 ? pending[0] : context.select(pending));
    }

    private *finishApplication(task: Execution<RankValue>): Execution<RankValue> {
        const context = this.context;
        const result = yield* resume(task);
        context.resources.ownFiles(result);
        return result;
    }

    private *continueApplication(
        values: RankValue[],
        missing: (() => RankValue) | undefined,
        start: number,
        task: Execution<RankValue>,
        tail: boolean,
    ): Execution<RankValue> {
        const context = this.context;
        const application = this;
        const result = yield* resume(task);
        context.resources.ownFiles(result);
        return yield* resume(application.apply(values, missing, start, [result], tail));
    }

    private *applyAtRank(
        values: RankValue[],
        rank: bigint,
        axes?: readonly number[],
    ): Execution<RankValue> {
        const context = this.context;
        if (rank > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`rank is too large: ${rank}`);
        }
        const functions = values.filter(isNativeFunction);
        if (functions.length !== 1 || values.at(-1) !== functions[0]) {
            throw new RankError('rank requires one unary operation after its data');
        }
        const fn = functions[0];
        if (!fn.arities.includes(1)) throw new RankError(`rank requires a unary operation: ${fn.name}`);
        const receivers = values.slice(0, -1);
        if (receivers.length !== 1) throw new RankError('unary rank requires one data value');
        return yield* resume(context.rankApplication.applyUnaryAtRank(receivers[0], fn, Number(rank), axes));
    }
}

export function integerLiteral(expression: Expression, name: string): bigint {
    if (!isNumberLiteral(expression) || typeof expression.value !== 'bigint') {
        throw new RankError(`${name} expects nonnegative integer literals`);
    }
    return expression.value;
}

export function isNamed(expression: Expression, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
}
