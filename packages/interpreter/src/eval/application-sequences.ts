import {
    applicationExpression as applicationParts, applicationForm, assertNever, flattenApplication,
    isAllAxisExpression, isLabelLiteral, isUnpackExpression, type ApplicationForm, type Expression,
} from '@arrrank/language';
import { ownedArray } from '../array-storage.js';
import { RankError } from '../errors.js';
import { mapExecution, resume, type Evaluation, type Execution } from '../execution.js';
import { directedMerge } from '../modules/sorted-merge.js';
import {
    argsortAxis, directedSort, lengthOfAxis, reshapeWithDimensions, reshapeWithShapeRows, sortDescending,
    sortMode, stackValues, concatValues, transposeValue, type SortMode,
} from '../modules/sequences.js';
import { shiftValue, windowValue } from '../sequence.js';
import { unpackApplicationItems } from '../value-selection.js';
import { isNativeFunction, isRankArray, type RankValue } from '../value.js';

import type { ApplicationContext } from './application.js';
import type { ModuleApplication } from './application-module.js';

type SequencesForm = Extract<ApplicationForm, { kind: 'sort-direction' | 'reshape' | 'array-combine-constructor' | 'window' | 'axis-shift' | 'axis-length' | 'axis-argsort' | 'axis-transpose' }>;

export function compileSequenceApplication(context: ApplicationContext, application: ModuleApplication,
    expression: Expression, form: SequencesForm, missing?: () => RankValue, tail = false): () => Evaluation<RankValue> {
    switch (form.kind) {

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
                if (name !== 'sort' && name !== 'argsort' && name !== 'merge') {
                    throw new RankError('direction must follow sort, argsort or merge', 'TypeError');
                }
                const fn = context.resolve(name);
                if (!context.builtins.is('sequences', name, fn) || !isNativeFunction(fn)) {
                    throw new RankError('direction requires the standard sort, argsort or merge', 'TypeError');
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
                        if (descending !== undefined) throw new RankError(`${name} direction given twice`, 'TypeError');
                        descending = sortDescending(value, name);
                    }
                }
                if (name === 'merge') {
                    if (mode || ranked || axis) throw new RankError('merge accepts only a direction label', 'TypeError');
                    const operands = yield* resume(mapExecution(parts.slice(0, -1), part => context.evaluate(part)));
                    return yield* resume(context.rankApplication.applyIntrinsicRank(directedMerge(fn, descending ?? false), operands));
                }
                if (axis) return argsortAxis(yield* resume(context.evaluate(axis.source)), axis.axis, descending ?? false);
                const source = yield* resume(context.evaluate(applicationParts((ranked?.parts ?? parts).slice(0, -1))));
                const directed = directedSort(fn, name, descending ?? false, mode);
                return yield* resume(ranked
                    ? application.applyAtRank([source, directed], ranked.rank, ranked.axes)
                    : context.rankApplication.applyIntrinsicRank(directed, [source]));
            };
        }

        case 'reshape': {
            return function* (): Execution<RankValue> {
                context.requireModule('sequences', 'reshape');
                const source = yield* resume(context.evaluate(form.source));
                let result: RankValue;
                if (form.dimensions.length === 1 && isUnpackExpression(form.dimensions[0])) {
                    const value = yield* resume(context.evaluate(form.dimensions[0].value));
                    result = isRankArray(value) && value.shape.length === 2
                        ? reshapeWithShapeRows(source, value)
                        : reshapeWithDimensions(source, unpackApplicationItems(value));
                } else {
                    const dimensions: (RankValue | undefined)[] = [];
                    for (const part of form.dimensions) {
                        if (isUnpackExpression(part)) {
                            const value = yield* resume(context.evaluate(part.value));
                            dimensions.push(...unpackApplicationItems(value));
                        } else dimensions.push(isAllAxisExpression(part) ? undefined : yield* resume(context.evaluate(part)));
                    }
                    result = reshapeWithDimensions(source, dimensions);
                }
                if (!form.rest.length) return result;
                const rest = yield* resume(mapExecution(form.rest, part => context.evaluate(part)));
                return yield* resume(application.apply([result, ...rest], missing, 0, [], tail));
            };
        }

        case 'array-combine-constructor': {
            const constructor = form;
            return function* (): Execution<RankValue> {
                context.requireModule('sequences', constructor.operation);
                const items: RankValue[] = [];
                for (const item of constructor.items) {
                    if (isUnpackExpression(item)) {
                        const source = yield* resume(context.evaluate(item.value));
                        items.push(...unpackApplicationItems(source));
                    } else {
                        items.push(yield* resume(context.evaluate(item)));
                    }
                }
                const axisValue = constructor.axis && (yield* resume(context.evaluate(constructor.axis)));
                if (axisValue !== undefined && (typeof axisValue !== 'bigint' || constructor.operation !== 'concat' && axisValue < 0n
                    || axisValue < -BigInt(Number.MAX_SAFE_INTEGER)
                    || axisValue > BigInt(Number.MAX_SAFE_INTEGER))) {
                    throw new RankError(`${constructor.operation} axis expects ${constructor.operation === 'concat' ? 'an integer' : 'a nonnegative integer'}`, 'TypeError');
                }
                const axis = axisValue === undefined ? 0 : Number(axisValue);
                const combined = constructor.operation === 'stack'
                    ? stackValues(items, axis) : concatValues(items, axis);
                if (!constructor.rest.length) return combined;
                const rest = yield* resume(mapExecution(constructor.rest, part => context.evaluate(part)));
                return yield* resume(application.apply([combined, ...rest], missing, 0, [], tail));
            };
        }

        case 'window': {
            const window = form;
            return function* (): Execution<RankValue> {
                context.requireModule('sequences', 'window');
                const source = yield* resume(context.evaluate(window.source));
                const dimensions: RankValue[] = [];
                for (const part of window.dimensions) {
                    if (isUnpackExpression(part)) {
                        dimensions.push(...unpackApplicationItems(yield* resume(context.evaluate(part.value))));
                    } else dimensions.push(yield* resume(context.evaluate(part)));
                }
                const size = window.dimensions.length === 1 && !isUnpackExpression(window.dimensions[0])
                    ? dimensions[0] : ownedArray(dimensions);
                const result = windowValue(source, size, window.axes,
                    window.stride ? (yield* resume(context.evaluate(window.stride))) : undefined,
                    window.padding ? (yield* resume(context.evaluate(window.padding))) : undefined,
                    window.fill ? (yield* resume(context.evaluate(window.fill))) : undefined, window.wrap);
                if (!window.rest.length) return result;
                const rest = yield* resume(mapExecution(window.rest, part => context.evaluate(part)));
                return yield* resume(application.apply([result, ...rest], missing, 0, [], tail));
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
        default: return assertNever(form);
    }
}
