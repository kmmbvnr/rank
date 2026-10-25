import { functionReference } from './function-reference.js';
import { rankedAddress } from '../ranked-address.js';
import { compileNumericApplication } from './application-numeric.js';
import { compileSequenceApplication } from './application-sequences.js';
import { compileStructureApplication } from './application-structures.js';
import type { ModuleApplication } from './application-module.js';
import { isPureLazyFunction, snapshotLazyOperand } from '../lazy-function.js';
import { queryDefault } from '../query-default.js';
import { demand, isRankPlan } from '../plan.js';
import {
    lastArrayUseProofs, applicationExpression as applicationParts, assertNever, flattenApplication, groupedExpression,
    isAllAxisExpression, isBinaryExpression, isMaterializeExpression, isUnaryExpression, isParenthesizedExpression, isApplicationExpression,
    isNameExpression, isNumberLiteral, isStringLiteral, isUnpackExpression, isFunctionOperator, renamedBuiltinCall,
    type KnownShape, type LastArrayUseProof, type DeclaredCallExpression, type ApplicationForm, type ArrayItem,
    type Expression, type Operation,
} from '@arrrank/language';
import { checkpoint, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { arithmeticRange } from '../range-plan.js';
import { MAX_HELD_CELLS } from '../array-storage.js';
import { currentDiagnostics } from '../diagnostics.js';
import { RankError } from '../errors.js';
import {
    runExecution, completed, flatMapResult, mapExecution, mapResult, resume, type Evaluation, type Execution,
} from '../execution.js';
import type { FastPaths } from '../fast-paths.js';
import type { FunctionInvocation } from '../function-invocation.js';
import type { BuiltinRegistry } from '../modules/builtins.js';
import { fenwickSum } from '../modules/algo.js';
import { materializeArray, uniqueLength } from '../modules/sequences.js';
import { numericUniqueSort } from '../numeric-collections.js';
import { formattedText } from '../modules/text.js';
import { type Operators } from '../operators.js';
import { type RankApplication } from '../rank-application.js';
import type { ReductionEvaluator } from '../reduction.js';
import type { ResourceOwnership } from '../resource-ownership.js';
import { ALL_AXIS } from '../selectors.js';
import { safeDimension } from '../tensor-index.js';
import { broadcastShape, rankedBroadcastShapes } from '../tensor-layout.js';
import { denseScalarItems, reshapeStoredArray } from '../owned-array.js';
import { callArguments, canApplySelectors, hasField, unpackApplicationItems } from '../value-selection.js';
import {
    MISSING, isNativeFunction, isRankArray, isRankFenwick, isRankLabel, isRankSequence, typeName, type NativeFunction, type RankValue,
} from '../value.js';

/** What evaluating application forms needs from the rest of evaluation. */
export interface ApplicationContext {
    evaluate(expression: Expression): Evaluation<RankValue>;
    argument(expression: Expression): Evaluation<RankValue>;
    stageArgument(expression: Expression): Evaluation<{ expression: Expression; value: RankValue }>;
    checkInput(expression: Expression, value: RankValue, source: string): void;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** Evaluation of an expression that is not an application, without classifying it again. */
    compile(expression: Expression, missing?: () => RankValue, tail?: boolean, classify?: boolean): () => Evaluation<RankValue>;
    evaluateArrayItem(item: ArrayItem): Execution<RankValue>;
    /** Builtin identity a name is bound to, or false for a user value; never runs user code. */
    operationOf(name: string): Operation | undefined | false;
    resolve(name: string): RankValue;
    findVariable(name: string): RankValue | undefined;
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
    private readonly moduleApplication: ModuleApplication = {
        apply: (...args) => this.apply(...args),
        applyAtRank: (...args) => this.applyAtRank(...args),
    };

    constructor(private readonly context: ApplicationContext) {}

    compileDeclaredCall(expression: DeclaredCallExpression, tail: boolean): () => Evaluation<RankValue> {
        const context = this.context;
        const lastUses = lastArrayUseProofs(expression, expression.arguments);
        return function* (): Execution<RankValue> {
            const fn = isNameExpression(expression.callee)
                ? context.resolve(expression.callee.name)
                : yield* resume(context.evaluate(expression.callee));
            if (!isNativeFunction(fn)) throw new RankError('Declared call expects a function');
            const args: RankValue[] = [];
            for (const [index, argument] of expression.arguments.entries()) {
                let value = argument;
                while (isParenthesizedExpression(value)) value = value.value;
                args.push(fn.callSignature?.parameters[index]?.kind === 'function' && isNameExpression(value)
                    ? context.resolve(value.name) : yield* resume(
                        expression.ranks.length || expression.axes.length ? context.evaluate(argument) : context.argument(argument)));
            }
            const data = expression.dataParameters.map(index => args[index]);
            const ranks = expression.ranks.map(rank => {
                const value = isUnaryExpression(rank) && rank.operator === '-'
                    ? -integerLiteral(rank.operand, 'rank') : integerLiteral(rank, 'rank');
                if (!Number.isSafeInteger(Number(value))) throw new RankError('rank is too large');
                return Number(value);
            });
            const axes = expression.axes.length ? expression.axes.map(axis => safeDimension(integerLiteral(axis, 'axis'), 'axis')) : undefined;
            if (!ranks.length && !axes && fn.monadicRank === 'all'
                && (!fn.dyadicRanks || fn.dyadicRanks.every(rank => rank === 'all'))) {
                context.functions.transferLastUses(fn, args, lastUses);
                if (tail && context.functions.transferTailCall(fn, args)) return MISSING;
                return yield* resume(context.functions.invoke(fn, args));
            }
            const resultShape = (fn: NativeFunction, cells: readonly (readonly number[])[]): KnownShape | undefined => {
                const shapes = args.map(value => isRankArray(value) ? value.shape : []);
                expression.dataParameters.forEach((index, i) => { shapes[index] = [...cells[i]]; });
                return fn.resultCellShape?.(shapes);
            };
            const withOperands = (fn: NativeFunction, fixed = args): NativeFunction => ({
                captureValues: () => [fn, ...fixed],
                snapshot: () => withOperands(fn.snapshot?.() ?? fn, fixed.map((value, index) =>
                    expression.dataParameters.includes(index) ? value : snapshotLazyOperand(value))),
                lazySafe: () => isPureLazyFunction(fn),
                kind: 'function', name: fn.name, arities: [data.length],
                monadicRank: fn.monadicRank, dyadicRanks: fn.dyadicRanks, arrayCells: true,
                monadicResultShape: shape => resultShape(fn, [shape]),
                dyadicResultShape: (left, right) => resultShape(fn, [left, right]),
                call: cells => {
                    const bound = [...fixed];
                    expression.dataParameters.forEach((index, i) => { bound[index] = cells[i]; });
                    return runExecution(context.functions.invoke(fn, bound));
                },
            });
            const ranked = withOperands(fn);
            if (data.length === 1) {
                if (ranks.length > 1) throw new RankError('rank expects one entry for one data operand');
                const rank = ranks[0] ?? axes?.length ?? (typeof fn.monadicRank === 'number' ? fn.monadicRank : 0);
                return yield* resume(context.rankApplication.applyUnaryAtRank(data[0], ranked, rank, axes));
            }
            if (axes) throw new RankError('axis expects one data operand');
            if (data.length === 2) {
                if (ranks.length > 2) throw new RankError('rank expects at most two entries for two data operands');
                return yield* resume(context.rankApplication.applyDyadicAtRank(data[0], data[1], ranked, ranks[0], ranks[1]));
            }
            throw new RankError('rank expects one or two data operands');
        };
    }

    /** The evaluation of one classified application form. */
    compileForm(
        expression: Expression, form: ApplicationForm, missing?: () => RankValue, tail = false,
    ): () => Evaluation<RankValue> {
        const context = this.context;
        const application = this;
        const parts = flattenApplication(expression);
        switch (form.kind) {
            case 'ranked-address': {
                const source = context.compile(form.source);
                const selectors = form.selectors.map(selector => isAllAxisExpression(selector)
                    ? () => completed(ALL_AXIS) : context.compile(selector));
                return function* (): Execution<RankValue> {
                    const receiver = yield* resume(source());
                    const values: RankValue[] = [];
                    for (const selector of selectors) values.push(yield* resume(selector()));
                    return rankedAddress(receiver, values, form.ranks, value => context.resources.ownFiles(value));
                };
            }
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
            case 'segment':
            case 'new-graph':
            case 'new-dsu':
            case 'new-filled':
            case 'new-heap':
            case 'named-segment':
            case 'graph-edges':
            case 'dsu-method':
            case 'functional-method':
            case 'multiset-method':
                return compileStructureApplication(context, this.moduleApplication, expression, form, missing, tail);
            case 'scan': {
                const scan = form;
                const axis = scan.axis === undefined ? undefined : safeDimension(integerLiteral(scan.axis, 'scan axis'), 'scan axis');
                const rank = scan.rank === undefined ? undefined : safeDimension(integerLiteral(scan.rank, 'scan rank'), 'scan rank');
                return function* (): Execution<RankValue> {
                    const source = yield* resume(context.evaluate(scan.source));
                    const seed = scan.seed === undefined
                        ? undefined
                        : yield* resume(context.evaluate(scan.seed));
                    return context.reductions.evaluateScan(
                        scan.operator,
                        source,
                        seed, axis, rank,
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
                        reduction.axes?.map(axis => safeDimension(integerLiteral(axis, 'reduce axis'), 'reduce axis')),
                    );
                };
            }
            case 'diagonal':
            case 'axis-matmul':
            case 'axis-covariance':
            case 'axis-correlation':
            case 'axis-quantile':
            case 'axis-metric':
            case 'axis-shuffle':
                return compileNumericApplication(context, this.moduleApplication, form);
            case 'sort-direction':
            case 'reshape':
            case 'array-combine-constructor':
            case 'window':
            case 'axis-shift':
            case 'axis-length':
            case 'axis-argsort':
            case 'axis-transpose':
                return compileSequenceApplication(context, this.moduleApplication, expression, form, missing, tail);

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
            case 'named-outer': {
                const namedOuter = form;
                return function* (): Execution<RankValue> {
                    const operation = (yield* resume(functionReference(namedOuter.operation, context)));
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
                        let operation = yield* resume(context.evaluate(explicitRank.parts[2]));
                        if (isNativeFunction(operation) && (operation.dyadicRanks || operation.arities.includes(2))) {
                            if (isFunctionOperator(explicitRank.parts[2])) {
                                // Completed scalar operands need no per-cell result assembly.
                                // Opaque readers and deferred arrays retain the ranked executor.
                                if (explicitRank.rightRank !== undefined
                                    && ['+', '-', '*', '/', '//', 'mod', '**'].includes(explicitRank.parts[2].operator)
                                    && [left, right].every(value => isRankArray(value)
                                        ? denseScalarItems(value) !== undefined
                                        : typeof value === 'bigint' || typeof value === 'number')) {
                                    const aligned = rankedBroadcastShapes(
                                        isRankArray(left) ? left.shape : [], isRankArray(right) ? right.shape : [],
                                        [Number(explicitRank.rank), Number(explicitRank.rightRank)],
                                    );
                                    const a = isRankArray(left) ? reshapeStoredArray(left, aligned.left) : left;
                                    const b = isRankArray(right) ? reshapeStoredArray(right, aligned.right) : right;
                                    if (a !== undefined && b !== undefined) {
                                        return context.operators.evaluateBinary(explicitRank.parts[2].operator, a, b);
                                    }
                                }
                                operation = { ...operation, arrayCells: true,
                                    // Only array results add axes. Text and sequences stay boxed.
                                    dyadicResultShape: (a, b) => broadcastShape(
                                        isRankArray(left) ? a : [], isRankArray(right) ? b : []),
                                };
                            }
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
            case 'repeat': {
                return function* (): Execution<RankValue> {
                    let state = yield* resume(context.evaluate(form.source));
                    const operation = yield* resume(functionReference(form.operation, context));
                    const count = yield* resume(context.evaluate(form.count));
                    const until = form.until ? yield* resume(functionReference(form.until, context)) : undefined;
                    if (!isNativeFunction(operation) || !operation.arities.includes(1)) {
                        throw new RankError('repeat requires a unary function', 'TypeError');
                    }
                    if (typeof count !== 'bigint') {
                        throw new RankError('repeat count must be an integer', 'TypeError');
                    }
                    if (count < 0n) throw new RankError('repeat count must be nonnegative', 'DomainError');
                    if (form.until && (until === undefined || !isNativeFunction(until) || !until.arities.includes(2))) {
                        throw new RankError('repeat till requires a binary predicate', 'TypeError');
                    }
                    for (let step = 0n; step < count; step++) {
                        checkpoint('repeating function');
                        const previous = state;
                        state = yield* resume(context.functions.invoke(operation, [state]));
                        if (until !== undefined && isNativeFunction(until)) {
                            const stop = yield* resume(context.functions.invoke(until, [previous, state]));
                            if (typeof stop !== 'boolean') {
                                throw new RankError('repeat till predicate must return a boolean', 'TypeError');
                            }
                            if (stop) break;
                        }
                    }
                    return state;
                };
            }
            case 'named-reduce':
            case 'named-scan': {
                const namedScan = form;
                const namedAxis = namedScan.axis === undefined ? undefined
                    : safeDimension(integerLiteral(namedScan.axis, 'scan axis'), 'scan axis');
                const rank = namedScan.rank === undefined ? undefined : safeDimension(integerLiteral(namedScan.rank, 'rank'), 'rank');
                const axes = namedScan.axes?.map(axis => safeDimension(integerLiteral(axis, 'reduce axis'), 'reduce axis'));
                return function* (): Execution<RankValue> {
                    const source = yield* resume(context.evaluate(namedScan.source));
                    const seed = namedScan.seed === undefined
                        ? undefined : yield* resume(context.evaluate(namedScan.seed));
                    const operation = yield* resume(functionReference(namedScan.operation, context));
                    if (!isNativeFunction(operation) || !operation.arities.includes(2)) {
                        throw new RankError(`${form.kind === 'named-reduce' ? 'reduce' : 'scan'} requires a binary operation`);
                    }
                    if (form.kind === 'named-reduce') {
                        return context.reductions.evaluateNamedReduction(operation, source, seed, rank, axes);
                    }
                    return context.reductions.evaluateNamedScan(operation, source, seed, namedAxis, rank);
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
                    return application.compileApplication(expression, parts, missing, tail, function* (): Execution<RankValue> {
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
                    });
                }
                return application.compileApplication(expression, parts, missing, tail);
            }
            default: return assertNever(form);
        }
    }

    private compileApplication(
        expression: Expression, parts: Expression[], missing?: () => RankValue, tail = false,
        ordinary = this.compileNativeApplication(expression, parts, missing, tail),
    ): () => Evaluation<RankValue> {
        const last = parts.at(-1);
        if (!last || !isNameExpression(last)) return ordinary;
        return () => {
            const fn = this.context.findVariable(last.name);
            // A nullary call supplies an operand to preceding native operations.
            if (!fn || !isNativeFunction(fn) || !fn.callSignature || fn.arities.includes(0) || fn.monadicRank !== 'all'
                || fn.dyadicRanks?.some(rank => rank !== 'all')) return ordinary();
            // Every postfix operation consumes the pending operands and leaves
            // one result. Preserve that result's syntax as an argument recipe;
            // evaluating its parts separately would feed plans to native calls
            // or compute a reduction before the parameter binder sees it.
            const prefix = parts.slice(0, -1);
            const operations = prefix.map((part, index) => {
                while (isParenthesizedExpression(part)) part = part.value;
                if (!index || !isNameExpression(part)) return false;
                const value = this.context.findVariable(part.name);
                const builtin = value === undefined ? this.context.operationOf(part.name) : undefined;
                const arities = value !== undefined && isNativeFunction(value) ? value.arities : builtin ? builtin.arities : undefined;
                return !!arities?.length && !arities.includes(0);
            });
            return flatMapResult(this.callOperands(prefix, expression, fn.arities.join() === '1', operations), operands =>
                flatMapResult(mapExecution(operands, part => this.context.argument(part)),
                    values => this.apply([...values, this.context.resolve(last.name)], missing, 0, [], tail,
                        lastArrayUseProofs(expression, operands))));
        };
    }

    private *callOperands(
        parts: Expression[], expression: Expression, monadic: boolean, operations: boolean[],
    ): Execution<Expression[]> {
        if (monadic && operations.some(Boolean)) return [applicationParts(parts, expression)];
        const operands: Expression[] = [];
        for (let index = 0; index < parts.length; index++) {
            const part = parts[index];
            const operation = operations[index];
            if (operation && isNamed(part, 'sum')) {
                const receiver = yield* resume(this.context.stageArgument(applicationParts(operands, expression)));
                const types = isRankPlan(receiver.value) ? receiver.value.result?.types : undefined;
                // Known result kinds settle method arity without reading data.
                // An unknown kind must be demanded for receiver dispatch; keep
                // the original recipe, not the value obtained by that demand.
                const fenwick = types?.length && !types.includes('fenwick') ? false
                    : types?.length === 1 ? true
                    : isRankFenwick(yield* resume(demand(receiver.value)));
                operands.splice(0, operands.length, receiver.expression, part);
                if (fenwick) {
                    const argument = parts[++index];
                    if (!argument) throw new RankError('fenwick sum expects one integer index');
                    operands.push(argument);
                }
            } else operands.push(part);
            if (operation) {
                operands.splice(0, operands.length, groupedExpression(applicationParts(operands, expression)));
            }
        }
        return operands;
    }

    private compileNativeApplication(
        expression: Expression, parts: Expression[], missing?: () => RankValue, tail = false,
    ): () => Evaluation<RankValue> {
        const context = this.context;
        const application = this;
        let selector = parts.length === 2 ? parts[1] : undefined;
        while (selector && isParenthesizedExpression(selector)) selector = selector.value;
        const material = selector && isMaterializeExpression(selector) ? selector : undefined;
        let range = material?.source;
        while (range && isParenthesizedExpression(range)) range = range.value;
        if (material && range && isBinaryExpression(range) && ['to', 'till'].includes(range.operator)) {
            return function* (): Execution<RankValue> {
                const receiver = yield* resume(context.evaluate(parts[0]));
                const source = yield* resume(context.evaluate(material.source));
                const proof = isRankSequence(source) ? arithmeticRange(source.plan) : undefined;
                const direct = isRankArray(receiver) && proof && proof.count <= MAX_HELD_CELLS
                    && privateLoopPolling() && !inspectionEnabled();
                if (direct) {
                    const diagnostics = currentDiagnostics();
                    if (diagnostics) diagnostics.rangeSelectorViews++;
                }
                return yield* resume(application.apply([receiver, direct ? source : materializeArray(source)], missing, 0, [], tail));
            };
        }
        const lastUses = lastArrayUseProofs(expression, parts.slice(0, -1));
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
                    if (!missing && simple && isNativeFunction(fn) && fn.arities.includes(arguments_.length)) {
                        context.functions.transferLastUses(fn, arguments_, lastUses);
                        const result = context.rankApplication.applyIntrinsicRank(fn, arguments_);
                        if ('done' in result) {
                            context.resources.ownFiles(result.value);
                            return result;
                        }
                        return application.finishApplication(result);
                    }
                    return application.apply([...arguments_, fn], missing, 0, [], tail, lastUses);
                };
            }
            return () => application.apply(directParts.map((part, index) => {
                const value = part();
                if (index === 0) checkRename?.(value);
                return value;
            }), missing, 0, [], tail, lastUses);
        }
        return () => flatMapResult(mapExecution(parts, part => {
            const task = isAllAxisExpression(part) ? completed(ALL_AXIS) : context.evaluate(part);
            return checkRename && part === parts[0] ? mapResult(task, value => {
                checkRename(value);
                return value;
            }) : task;
        }), values => application.apply(values, missing, 0, [], tail, lastUses));
    }

    /** Applies each function in `values` to the data before it, left to right; plain data is selection. */
    apply(
        values: RankValue[],
        missing?: () => RankValue,
        start = 0,
        pending: RankValue[] = [],
        tail = false,
        lastUses: readonly (LastArrayUseProof | undefined)[] = [],
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
            if (missing && index === values.length - 1 && arguments_.length === 2) {
                const name = context.builtins.is('sequences', 'find', value) ? 'find'
                    : context.builtins.is('core', 'choose', value) ? 'choose'
                    : context.builtins.is('numbers', 'floor', value) || context.builtins.is('algo', 'floor', value) ? 'floor' : undefined;
                const result = name && queryDefault(name, arguments_[0], arguments_[1]);
                if (result !== undefined && result !== false) return completed(result);
            }
            const next = values[index + 1];
            if (arguments_.length === 1 && isNativeFunction(next)
                && context.builtins.is('sequences', 'unique', value)
                && context.builtins.is('sequences', 'sort', next)) {
                const sorted = numericUniqueSort(arguments_[0]);
                if (sorted !== undefined) {
                    pending = [sorted];
                    index += 1;
                    continue;
                }
            }
            if (arguments_.length === 1 && isNativeFunction(next)
                && context.builtins.is('sequences', 'unique', value)
                && context.builtins.is('core', 'len', next)) {
                const count = uniqueLength(arguments_[0]);
                if (count !== undefined) {
                    pending = [count];
                    index += 1;
                    continue;
                }
            }
            if (index === values.length - 1 && arguments_.length === values.length - 1
                && arguments_.every((argument, i) => argument === values[i])) {
                context.functions.transferLastUses(value, arguments_, lastUses);
            }
            if (tail && index === values.length - 1 && context.resources.currentScopeEmpty()
                && context.functions.transferTailCall(value, arguments_)) return completed(MISSING);
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
    if (name.includes('axis') && isUnaryExpression(expression) && expression.operator === '-'
        && isNumberLiteral(expression.operand) && typeof expression.operand.value === 'bigint') return -expression.operand.value;
    if (!isNumberLiteral(expression) || typeof expression.value !== 'bigint') {
        throw new RankError(`${name} expects nonnegative integer literals`);
    }
    return expression.value;
}

export function isNamed(expression: Expression, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
}
