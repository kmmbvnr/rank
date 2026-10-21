import { queryDefault } from '../query-default.js';
import {
    assertNever, flattenApplication, isParenthesizedExpression, isNameExpression, type ApplicationForm,
    type Expression,
} from '@arrrank/language';
import { RankError } from '../errors.js';
import { runExecution, mapExecution, resume, type Evaluation, type Execution } from '../execution.js';
import { graphConstructor, PredicateGraph, SuccessorGraph } from '../graph.js';
import { addToCollection, newStructure } from '../collections.js';
import { pushCollection, RankHeap } from '../containers.js';
import { materializeValue } from '../materialize.js';
import { dsuFrom } from '../dsu.js';
import { finiteValues } from '../multiset.js';
import { multisetQuery, namedSegment, symbolicSegment } from '../modules/algo.js';
import { dsuQuery, functionalQuery } from '../modules/graph.js';
import { dyadicCells } from '../rank-application.js';
import {
    isNativeFunction, isRankArray, isRankDsu, isRankFunctionalGraph, isRankGraph, isRankLabel,
    isRankMultiset, type RankValue,
} from '../value.js';

import type { ApplicationContext } from './application.js';
import type { ModuleApplication } from './application-module.js';

type StructuresForm = Extract<ApplicationForm, { kind: 'segment' | 'new-graph' | 'new-dsu' | 'new-filled' | 'new-heap' | 'named-segment' | 'graph-edges' | 'dsu-method' | 'functional-method' | 'multiset-method' }>;

export function compileStructureApplication(context: ApplicationContext, application: ModuleApplication,
    expression: Expression, form: StructuresForm, missing?: () => RankValue, tail = false): () => Evaluation<RankValue> {
    const parts = flattenApplication(expression);
    switch (form.kind) {

        case 'segment': {
            const segment = form;
            return function* (): Execution<RankValue> {
                context.requireModule('algo', 'segment');
                const build = symbolicSegment(segment.operator, context.operators);
                return build(yield* resume(context.evaluate(segment.source)));
            };
        }

        case 'new-graph': {
            return function* (): Execution<RankValue> {
                context.requireModule('graph', 'new graph');
                if (form.predicate || form.successor) {
                    const domain = form.domain ? yield* resume(context.evaluate(form.domain)) : undefined;
                    let callback = (form.predicate ?? form.successor)!;
                    while (isParenthesizedExpression(callback)) callback = callback.value;
                    const predicate = isNameExpression(callback) ? context.resolve(callback.name)
                        : yield* resume(context.evaluate(callback));
                    const direction = yield* resume(context.evaluate(form.direction!));
                    if (!isNativeFunction(predicate)) throw new RankError(form.successor ? 'graph successor expects a function' : 'graph predicate expects a function');
                    if (form.successor) return new SuccessorGraph(direction, predicate, vertex =>
                        runExecution(context.functions.invoke(predicate, [vertex])));
                    return new PredicateGraph(domain!, direction, predicate, (left, right) =>
                        runExecution(context.functions.invoke(predicate, [left, right])));
                }
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
                    const value = materializeValue(item);
                    if (['queue', 'stack', 'deque', 'heap'].includes(structure)) pushCollection(filled, value);
                    else addToCollection(filled, value);
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
                    const priorityValues = [...finiteValues(priorities)].map(materializeValue);
                    const payloads = Array.from({ length: values.shape[0] }, (_, index) => materializeValue(cells.cellAt(index)));
                    return heap.fill(priorityValues, payloads);
                }
                if (values !== undefined) {
                    const items = [...finiteValues(values)].map(materializeValue);
                    return heap.fill(items, items);
                }
                return heap;
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
                    if (missing && multisetMethod.operation === 'floor') {
                        const result = queryDefault('floor', receiverValue, argumentValue);
                        if (result !== undefined) return result;
                    }
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
        default: return assertNever(form);
    }
}
