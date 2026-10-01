import {
    flattenApplication, isAllAxisExpression, isBinaryExpression, isNameExpression, isNumberLiteral,
    type Expression, type ForStatement, type Statement,
} from '@arrrank/language';
import { ownedArray } from '../array-storage.js';
import type { BindingEnvironment } from '../binding-environment.js';
import { BreakSignal, ContinueSignal } from '../control-signals.js';
import { RankDeque, RankHeap } from '../containers.js';
import { RankError } from '../errors.js';
import { resume, type Evaluation } from '../execution.js';
import type { CompiledLoop } from '../fast-paths.js';
import type { InterpreterOptions } from '../interpreter-options.js';
import { checkpoint } from '../interrupt.js';
import { tensorFrameAxes } from '../rank-application.js';
import { sequenceValues } from '../sequence.js';
import type { ExecutionContext, LoopControl, PreparedStatement } from '../statement-control.js';
import { compileTensorCellCopy } from '../tensor-cell-compiler.js';
import { arrayOffset, coordinatesAt, safeDimension } from '../tensor-index.js';
import {
    expectBoolean, isRankArray, isRankCounter, isRankMultiset, isRankObject, isRankQueue, isRankSequence, isRankSet,
    typeName, type RankArray, type RankValue,
} from '../value.js';
import { integerLiteral } from './application.js';

/** What a loop needs from statement execution. */
export interface LoopContext {
    readonly bindings: BindingEnvironment;
    evaluate(expression: Expression): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    compileAssign(name: string): (value: RankValue) => void;
    /** The body as a task to start once per iteration, prepared on first use. */
    prepareBody(
        statements: Statement[], context: ExecutionContext, iterable: boolean, loopControl?: LoopControl,
    ): () => Evaluation<RankValue | undefined>;
    execute(statements: Statement[], context: ExecutionContext): Evaluation<RankValue | undefined>;
    /** A debugger stop at the loop head before each iteration. */
    point(statement: Statement, iteration: boolean): void;
    options(): InterpreterOptions;
    /** The compiled loop the fast-path owner selects, if any. */
    compileLoop(statement: ForStatement, binding: ForBinding | undefined): CompiledLoop | undefined;
}

const NO_INDICES: readonly RankValue[] = [];

/** A `for` loop: over a condition, or binding names to the cells of a value. */
export function prepareForStatement(statement: ForStatement, loop: LoopContext): PreparedStatement {
    const binding = forIteration(statement.condition);
    const condition = !binding && statement.condition
        ? loop.compileDirect(statement.condition) : undefined;
    // The names a binding writes never change, so each gets its write
    // site once here rather than a name lookup on every iteration.
    const bindValue = binding && binding.names[0] !== '#'
        ? loop.compileAssign(binding.names[0]) : undefined;
    const bindIndex = binding
        ? binding.names.slice(1).map(name =>
            name === '#' ? undefined : loop.compileAssign(name))
        : [];
    const reference: PreparedStatement = { stream: function* (context) {
        // Each loop owns its jumps. Branches share this carrier, while
        // protected try/catch/finally blocks retain exception unwinding.
        const loopControl: LoopControl | undefined = loop.options().directLoopControl !== false ? {} : undefined;
        let result: RankValue | undefined;
        let preparedBody: (() => Evaluation<RankValue | undefined>) | undefined;
        if (binding) {
            const spec = tensorIterationSpec(binding.iterable);
            const iterable = (yield* resume(loop.evaluate(spec?.source ?? binding.iterable)));
            const flat = loop.options().directIteration !== false && !spec
                && !isRankObject(iterable) && !(isRankArray(iterable) && iterable.shape.length > 1);
            const entries = flat ? iterationAtoms(loop.bindings, binding, iterable)
                : forEntries(loop.bindings, binding, iterable, loop.options().tensorCellCompilation !== false);
            let ordinal = 0n;
            for (const entry of entries) {
                checkpoint();
                if (flat) {
                    if (bindValue) bindValue(entry as RankValue);
                    if (bindIndex[0]) bindIndex[0](ordinal++);
                } else {
                    const cell = entry as ForEntry;
                    if (bindValue) bindValue(cell.value);
                    for (let position = 0; position < bindIndex.length; position += 1) {
                        bindIndex[position]?.(cell.indices[position]);
                    }
                }
                loop.point(statement, true);
                try {
                    // A body that finishes on its own needs no task; only
                    // one that suspends goes back to the driver.
                    const body = loop.options().loopPreparation !== false
                        ? (preparedBody ??= loop.prepareBody(statement.statements, context, true, loopControl))()
                        // Returning must close this iterator after the callee finishes.
                        : loop.execute(statement.statements,
                            { ...context, insideLoop: true, tailCallsAllowed: false, loopControl });
                    const value = 'done' in body
                        ? body.value : (yield { task: body }) as RankValue | undefined;
                    if (loopControl?.signal) {
                        const signal = loopControl.signal;
                        loopControl.signal = undefined;
                        if (signal === 'break') break;
                        continue;
                    }
                    result = value;
                } catch (error) {
                    if (error instanceof BreakSignal) break;
                    if (error instanceof ContinueSignal) continue;
                    throw error;
                }
            }
        } else {
            for (;;) {
                checkpoint();
                loop.point(statement, true);
                if (statement.condition) {
                    let test: RankValue;
                    if (condition) {
                        test = condition();
                    } else {
                        const task = loop.evaluate(statement.condition);
                        test = 'done' in task ? task.value : (yield { task }) as RankValue;
                    }
                    if (!expectBoolean(test)) break;
                }
                try {
                    const body = loop.options().loopPreparation !== false
                        ? (preparedBody ??= loop.prepareBody(statement.statements, context, false, loopControl))()
                        : loop.execute(statement.statements, { ...context, insideLoop: true, loopControl });
                    const value = 'done' in body
                        ? body.value : (yield { task: body }) as RankValue | undefined;
                    if (loopControl?.signal) {
                        const signal = loopControl.signal;
                        loopControl.signal = undefined;
                        if (signal === 'break') break;
                        continue;
                    }
                    result = value;
                } catch (error) {
                    if (error instanceof BreakSignal) break;
                    if (error instanceof ContinueSignal) continue;
                    throw error;
                }
            }
        }
        return result;
    } };
    const compiled = loop.compileLoop(statement, binding);
    return compiled ? { stream: context => compiled.run(context.insideFinally, context.insideGenerator, context.tailCallsAllowed !== false) ?? reference.stream!(context) } : reference;}

function* forEntries(
    bindings: BindingEnvironment, binding: ForBinding, value: RankValue, tensorCells: boolean,
): IterableIterator<ForEntry> {
    const spec = tensorIterationSpec(binding.iterable);
    if (spec) {
        if (!isRankArray(value)) throw new RankError('ranked for iteration expects an array');
        const frameAxes = tensorFrameAxes(value.shape, spec.axes, spec.cellRank);
        validateForBindings(binding.names, frameAxes.length);
        bindings.declareTypes(binding.names, [
            spec.cellRank === 0 ? typesOf(value.items) : new Set(['array']),
            ...frameAxes.map(() => new Set(['integer'])),
        ]);
        yield* tensorEntries(value, frameAxes, tensorCells);
        return;
    }

    if (isRankObject(value)) {
        validateForBindings(binding.names, 1);
        bindings.declareTypes(binding.names, [
            typesOf(value.entries.values()),
            new Set(['text']),
        ]);
        for (const [key, item] of value.entries) {
            yield { value: item, indices: [key] };
        }
        return;
    }
    if (isRankArray(value) && value.shape.length > 1) {
        validateForBindings(binding.names, 1);
        bindings.declareTypes(binding.names, [new Set(['array']), new Set(['integer'])]);
        yield* tensorEntries(value, [0], tensorCells);
        return;
    }

    const values = iterationAtoms(bindings, binding, value);
    // A binding without an index name has nowhere to put one, so the walk
    // neither counts nor carries it.
    if (binding.names.length === 1) {
        for (const item of values) yield { value: item, indices: NO_INDICES };
        return;
    }
    let index = 0n;
    for (const item of values) {
        yield { value: item, indices: [index] };
        index += 1n;
    }
}

/** The values a one-axis loop walks, after settling the types its names will take. */
export function iterationAtoms(
    bindings: BindingEnvironment, binding: ForBinding, value: RankValue,
    provenType?: 'integer' | 'text', directText = false,
): Iterable<RankValue> {
    validateForBindings(binding.names, 1);
    if (isRankArray(value)) {
        const types = provenType
            ? new Set(value.items.length ? [provenType] : []) : typesOf(value.items);
        bindings.declareTypes(binding.names, [types, new Set(['integer'])]);
    } else if (isRankQueue(value)) {
        const types = value instanceof RankDeque ? value.iterationTypes(typeName) : typesOf(value.items);
        bindings.declareTypes(binding.names, [types, new Set(['integer'])]);
    } else if (isRankSet(value)) {
        bindings.declareTypes(binding.names, [
            typesOf(value.entries.values()),
            new Set(['integer']),
        ]);
    } else if (isRankCounter(value)) {
        bindings.declareTypes(binding.names, [
            typesOf(Array.from(value.entries.values(), entry => entry.value)),
            new Set(['integer']),
        ]);
    } else if (typeof value === 'string') {
        bindings.declareTypes(binding.names, [new Set(['text']), new Set(['integer'])]);
    }
    if (directText && typeof value === 'string') return value;
    return iterationValues(value);
}

export interface ForBinding {
    readonly names: readonly string[];
    readonly iterable: Expression;
}

interface ForEntry {
    readonly value: RankValue;
    readonly indices: readonly RankValue[];
}

interface TensorIterationSpec {
    readonly source: Expression;
    readonly axes?: readonly number[];
    readonly cellRank: number;
}

export function forIteration(
    condition: Expression | undefined,
): ForBinding | undefined {
    if (!condition || !isBinaryExpression(condition) || condition.operator !== 'in') return undefined;
    const bindings = flattenApplication(condition.left);
    if (bindings.length < 1 || !bindings.every(binding =>
        isNameExpression(binding) || isAllAxisExpression(binding))) {
        return undefined;
    }
    return {
        names: bindings.map(binding => isNameExpression(binding) ? binding.name : '#'),
        iterable: condition.right,
    };
}

function tensorIterationSpec(expression: Expression): TensorIterationSpec | undefined {
    const parts = flattenApplication(expression);
    const rankWord = parts.at(-2);
    const rankValue = parts.at(-1);
    if (!rankWord || !rankValue || !isNameExpression(rankWord)
        || rankWord.name !== 'rank' || !isNumberLiteral(rankValue)
        || typeof rankValue.value !== 'bigint') return undefined;

    const cellRank = safeDimension(rankValue.value, 'rank');
    const beforeRank = parts.slice(0, -2);
    const axisPosition = beforeRank.findIndex(part => isNameExpression(part) && part.name === 'axis');
    if (axisPosition < 0) {
        if (beforeRank.length !== 1) return undefined;
        return { source: beforeRank[0], cellRank };
    }
    if (axisPosition !== 1 || beforeRank.length === 2) {
        throw new RankError('axis expects an array followed by one or more axis numbers');
    }
    const axisParts = beforeRank.slice(2);
    return {
        source: beforeRank[0],
        axes: axisParts.map(axis => safeDimension(integerLiteral(axis, 'axis'), 'axis')),
        cellRank,
    };
}

function validateForBindings(names: readonly string[], frameRank: number): void {
    if (names.length !== 1 && names.length !== frameRank + 1) {
        throw new RankError(
            `for expects one value name or ${frameRank + 1} value/index names, got ${names.length}`,
        );
    }
}

function* tensorEntries(source: RankArray, frameAxes: readonly number[], compiled: boolean): IterableIterator<ForEntry> {
    const frameShape = frameAxes.map(axis => source.shape[axis]);
    const frameSet = new Set(frameAxes);
    const cellAxes = source.shape.map((_, axis) => axis).filter(axis => !frameSet.has(axis));
    const cellShape = cellAxes.map(axis => source.shape[axis]);
    const copy = compiled && cellAxes.length > 0
        ? compileTensorCellCopy(frameAxes.length + cellAxes.length, cellAxes) : undefined;

    for (const frameCoordinates of coordinates(frameShape)) {
        const fullCoordinates = Array(source.shape.length).fill(0) as number[];
        frameAxes.forEach((axis, position) => {
            fullCoordinates[axis] = frameCoordinates[position];
        });
        const copied = copy?.(source, fullCoordinates, cellShape);
        const items: RankValue[] = copied ?? [];
        const cellSize = copied === undefined ? cellShape.reduce((product, dimension) => product * dimension, 1) : 0;
        for (let linear = 0; linear < cellSize; linear++) {
            if (cellShape.length !== cellAxes.length) {
                // A host callback can resize the shared cell shape. Preserve
                // the ordinary missing/extra coordinate behavior in that case.
                const cellCoordinates = coordinatesAt(cellShape, linear);
                cellAxes.forEach((axis, position) => {
                    fullCoordinates[axis] = cellCoordinates[position];
                });
            } else {
                let remaining = linear;
                for (let position = cellShape.length - 1; position >= 0; position--) {
                    fullCoordinates[cellAxes[position]] = remaining % cellShape[position];
                    remaining = Math.floor(remaining / cellShape[position]);
                }
            }
            items.push(source.items[arrayOffset(source.shape, fullCoordinates)]);
        }
        yield {
            value: cellShape.length === 0
                ? items[0]
                : ownedArray(items, cellShape),
            indices: frameCoordinates.map(BigInt),
        };
    }
}

function* coordinates(shape: readonly number[]): IterableIterator<number[]> {
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    for (let linear = 0; linear < size; linear += 1) {
        let remaining = linear;
        const result = Array(shape.length).fill(0) as number[];
        for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
            result[axis] = remaining % shape[axis];
            remaining = Math.floor(remaining / shape[axis]);
        }
        yield result;
    }
}

function iterationValues(value: RankValue): Iterable<RankValue> {
    if (value instanceof RankDeque || value instanceof RankHeap) return value.values();
    if (isRankSequence(value)) return sequenceValues(value, 'for');
    if (isRankArray(value)) return value.items;
    if (isRankQueue(value)) return value.items;
    if (isRankSet(value)) return value.entries.values();
    if (isRankCounter(value)) return Array.from(value.entries.values(), entry => entry.value);
    if (isRankMultiset(value)) return value.values();
    if (typeof value === 'string') return [...value];
    throw new RankError(`for expects text or a sequence, got ${typeName(value)}`);
}

function typesOf(values: Iterable<RankValue>): ReadonlySet<string> {
    return new Set([...values].map(typeName));
}
