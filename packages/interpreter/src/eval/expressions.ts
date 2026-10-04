import { ArrayBindingContract } from '../array-binding-contract.js';
import { tuple } from '../value.js';
import {
    isTupleExpression, flattenApplication, isAliasedTableExpression, isAllAxisExpression, isApplicationExpression, isArrayExpression,
    isBinaryExpression, isBooleanLiteral, isKeyedGroupExpression, isKeyedJoinExpression, isKeyedReachExpression,
    isKeyedRollingExpression, isKeyedSortExpression, isLabelLiteral, isMaterializeExpression, isNameExpression,
    isNewStructureExpression, isNumberLiteral, isParenthesizedExpression, isRecordExpression,
    isRecordUpdateExpression, isStdinExpression, isStringLiteral, isTextBlockExpression, isUnaryExpression,
    isUnpackExpression, nameNeedsExecution, requiresDataOperand, applicationForm, findOperation,
    type AddressItem, type ArrayItem, type Expression,
} from '@arrrank/language';
import { nameMask } from '../array-mask.js';
import { allValid, createArraySnapshot, isPresentAt, maskedCells, ownedArray, readArrayItem, typedArray } from '../array-storage.js';
import type { BindingEnvironment } from '../binding-environment.js';
import { compileClauseExpression, isBoundCondition, type ClauseExpressionContext } from '../clause-expression.js';
import { newStructure } from '../collections.js';
import { dsuFrom } from '../dsu.js';
import { MissingValueError, RankError } from '../errors.js';
import {
    completed, flatMapResult, mapExecution, mapPair, mapResult, resume, type Evaluation, type Execution,
} from '../execution.js';
import type { FastPaths } from '../fast-paths.js';
import type { FunctionInvocation } from '../function-invocation.js';
import { graphConstructor } from '../graph.js';
import type { InterpreterOptions } from '../interpreter-options.js';
import { compileKeyedTableExpression } from '../keyed-table-expression.js';
import { BuiltinRegistry } from '../modules/builtins.js';
import { readStdin, stdinMode, stdinSequence } from '../modules/io.js';
import { keyedSort, sortByFields, sortFieldDescending } from '../modules/keyed-sort.js';
import { materializeCollection } from '../modules/sequences.js';
import { tableAlias } from '../modules/tables.js';
import {
    materializeSqlite, materializeSqliteExpression,
} from '../modules/sqlite.js';
import { expectInteger, type Operators } from '../operators.js';
import { assignRecordField, recordContract } from '../record-contract.js';
import type { ResourceOwnership } from '../resource-ownership.js';
import { ResourceMap } from '../resource-summary.js';
import { ALL_AXIS } from '../selectors.js';
import { materializeSequence, sequence } from '../sequence.js';
import { compileTableExpression } from '../table-query-expression.js';
import { maskSelection, unpackApplicationItems } from '../value-selection.js';
import {
    isNativeFunction, isRankArray, isRankRecord, isRankSequence, isRankSqliteExpression,
    isRankSqliteTable, isRankTable, isRankTableAlias, MISSING, typeName,
    type NativeFunction, type RankArray, type RankRecord, type RankSequence, type RankValue,
} from '../value.js';
import type { ApplicationEvaluator } from './application.js';
import { isNamed } from './application.js';

/** What evaluating expressions needs beyond the expression itself. */
export interface ExpressionContext {
    inputCall?(expression: Expression, run: () => Evaluation<RankValue>): Evaluation<RankValue>;
    readonly bindings: BindingEnvironment;
    resolve(name: string): RankValue;
    select(values: RankValue[], missing?: () => RankValue): RankValue;
    requireModule(module: string, operation: string): void;
    invoke(fn: NativeFunction, arguments_: RankValue[]): Evaluation<RankValue>;
    locate(error: unknown, expression: Expression): unknown;
    options(): InterpreterOptions;
    readonly operators: Operators;
    readonly resources: ResourceOwnership;
    readonly functions: FunctionInvocation;
    readonly builtins: BuiltinRegistry;
    readonly application: ApplicationEvaluator;
    readonly fastPaths: FastPaths;
}

/**
 * Expressions other than applications: literals, names, records, arrays,
 * operators, `default`, standard input and the keyed and table query forms.
 * Preparation is lazy and cached per syntax node, never per value, so an
 * error in an unexecuted branch keeps its timing.
 */
export class ExpressionEvaluator {
    private readonly prepared = new WeakMap<Expression, () => Evaluation<RankValue>>();

    constructor(private readonly context: ExpressionContext) {}

    /** The evaluation of an expression; its preparation is cached per syntax node. */
    evaluate(expression: Expression): Evaluation<RankValue> {
        return this.prepare(expression)();
    }

    private prepare(expression: Expression): () => Evaluation<RankValue> {
        let execute = this.prepared.get(expression);
        if (!execute) {
            const direct = this.compileDirect(expression);
            execute = direct
                ? () => completed(direct())
                : this.compile(expression);
            if (!direct && requiresDataOperand(expression)) {
                const evaluate = execute;
                execute = () => mapResult(evaluate(), value => this.checkDataOperand(expression, value));
            }
            this.prepared.set(expression, execute);
        }
        return execute;
    }

    // Arithmetic and conditions with direct operands cannot call
    // Rank functions. Keep those syntax trees synchronous to avoid allocating a task
    // for every atom of a counted loop. Bindings and values remain runtime work.
    compileDirect(expression: Expression): (() => RankValue) | undefined {
        const evaluate = this.compileDirectValue(expression);
        return evaluate && requiresDataOperand(expression)
            ? () => this.checkDataOperand(expression, evaluate()) : evaluate;
    }

    private checkDataOperand(expression: Expression, value: RankValue): RankValue {
        if (isNativeFunction(value)) throw this.context.locate(new RankError(
            'This function has no known signature here. Group its input with parentheses or introduce an intermediate variable.',
            'Syntax',
        ), expression);
        return value;
    }

    private compileDirectValue(expression: Expression): (() => RankValue) | undefined {
        const compiled = this.context.fastPaths.scalarExpression(expression, leaf => this.compileDirect(leaf));
        if (compiled) return compiled;
        if (isNewStructureExpression(expression)) return () => {
            if (expression.structure === 'graph') {
                this.context.requireModule('graph', 'new graph');
                return graphConstructor();
            }
            if (expression.structure === 'dsu') {
                this.context.requireModule('graph', 'new dsu');
                return dsuFrom();
            }
            this.context.requireModule('algo', 'new');
            return newStructure(expression.structure);
        };
        if (isNumberLiteral(expression) || isBooleanLiteral(expression) || isStringLiteral(expression)) {
            return () => expression.value;
        }
        if (isTextBlockExpression(expression)) {
            const value = expression.parts.join(expression.mode === 'lines' ? '\n' : '');
            return () => value;
        }
        if (isLabelLiteral(expression)) {
            if (expression.name === 'NA') return () => MISSING;
            return () => ({ kind: 'label', name: expression.name });
        }
        if (isNameExpression(expression)) {
            if (nameNeedsExecution(expression)) return undefined;
            const name = expression.name;
            let layout: Map<string, number> | undefined;
            let slot: number | undefined;
            return () => {
                const frame = this.context.bindings.current;
                if (frame) {
                    if (layout !== frame.layout || slot === undefined) {
                        layout = frame.layout;
                        slot = layout.get(name);
                    }
                    if (slot !== undefined) {
                        const value = frame.read(slot, name);
                        if (value !== undefined) {
                            return this.directNameValue(value);
                        }
                    }
                }
                return this.directNameValue(this.context.resolve(name));
            };
        }
        if (isParenthesizedExpression(expression)) return this.compileDirect(expression.value);
        if (isUnaryExpression(expression)) {
            const operand = this.compileDirect(expression.operand);
            return operand ? () => this.context.operators.evaluateUnary(expression.operator, operand()) : undefined;
        }
        if (isBinaryExpression(expression) && expression.operator !== 'default'
            && expression.operator !== '**'
            // `Values till not even` tests each item; its right side is no value.
            && !((expression.operator === 'to' || expression.operator === 'till') && isBoundCondition(expression.right))
            && !isNamed(expression.right, 'reduce')
            && !isNamed(expression.right, 'scan')
            && !isNamed(expression.right, 'segment')
            && !isNamed(expression.right, 'outer')) {
            const left = this.compileDirect(expression.left);
            const right = this.compileDirect(expression.right);
            const step = expression.step ? this.compileDirect(expression.step) : undefined;
            if (left && right && (expression.operator === 'and' || expression.operator === 'or')) {
                const operator = expression.operator;
                return () => {
                    const value = left();
                    return this.context.operators.decidesGuard(operator, value) ? value : this.context.operators.evaluateGuard(operator, value, right());
                };
            }
            if (left && right && (!expression.step || step)) {
                return () => this.context.operators.evaluateBinary(expression.operator, left(), right(), step?.());
            }
        }
        return undefined;
    }

    // Cache syntax decisions, never values or name bindings. Preparation stays
    // lazy so errors in unexecuted branches keep their existing timing.
    compile(
        expression: Expression,
        missing?: () => RankValue,
        tail = false,
        classify = true,
        allowScalar = true,
    ): () => Evaluation<RankValue> {
        const run = this.compileInner(expression, missing, tail, classify, allowScalar);
        return classify && this.context.inputCall
            && (isNameExpression(expression) || isApplicationExpression(expression) || isBinaryExpression(expression))
            ? () => this.context.inputCall!(expression, run) : run;
    }

    private compileInner(
        expression: Expression, missing: (() => RankValue) | undefined,
        tail: boolean, classify: boolean, allowScalar: boolean,
    ): () => Evaluation<RankValue> {
        const expressions = this;
        const bound = compileClauseExpression(expression, () => this.clauseContext());
        if (bound && isBinaryExpression(expression)) return bound;
        if (classify && (isApplicationExpression(expression) || isBinaryExpression(expression))) {
            const syntax = isBinaryExpression(expression) ? flattenApplication(expression.right) : flattenApplication(expression);
            const names = syntax.filter(isNameExpression).map(part => part.name);
            let signature: string | undefined;
            let compiled: (() => Evaluation<RankValue>) | undefined;
            return () => {
                const bindings = new Map(names.map(name => [name, this.operationOf(name)]));
                const next = names.map(name => {
                    const identity = bindings.get(name);
                    return identity === false ? '\0' : identity?.name ?? name;
                }).join(' ');
                if (!compiled || signature !== next) {
                    const form = applicationForm(expression, name => bindings.has(name)
                        ? bindings.get(name) : this.operationOf(name));
                    compiled = this.context.application.compileForm(expression, form, missing, tail);
                    signature = next;
                }
                return compiled();
            };
        }
        const scalar = allowScalar && this.context.fastPaths.scalarEvaluation(expression, source => () => this.evaluate(source));
        if (scalar) {
            let reference: (() => Evaluation<RankValue>) | undefined;
            return () => {
                if (this.context.options().scalarCompilation === false) {
                    reference ??= this.compile(expression, missing, tail, false, false);
                    return reference();
                }
                return scalar();
            };
        }
        if (isNewStructureExpression(expression)) {
            const create = this.compileDirect(expression)!;
            return () => completed(create());
        }
        if (isNumberLiteral(expression) || isBooleanLiteral(expression)) {
            return function* (): Execution<RankValue> { return expression.value; };
        }
        if (isStringLiteral(expression)) {
            return function* (): Execution<RankValue> { return expression.value; };
        }
        if (isLabelLiteral(expression)) {
            return function* (): Execution<RankValue> {
                return expression.name === 'NA' ? MISSING : { kind: 'label', name: expression.name };
            };
        }
        if (isStdinExpression(expression)) {
            return function* (): Execution<RankValue> {
                expressions.context.requireModule('io', 'stdin');
                const mode = stdinMode(expression.mode.name);
                if (!expression.count) return readStdin(expressions.context.options().input, mode);
                const count = yield* resume(expressions.evaluate(expression.count));
                return expressions.singlePass(stdinSequence(() => expressions.context.options().input, mode, count,
                    (expression.$cstNode?.range.start.line ?? 0) + 1));
            };
        }
        if (isTupleExpression(expression)) {
            return () => mapResult(mapExecution(expression.items, item => expressions.evaluateArrayItem(item)), items => {
                return tuple(items);
            });
        }
        if (isArrayExpression(expression)) {
            return function* (): Execution<RankValue> {
                let items: RankValue[];
                if (expression.range) {
                    const rangeValue = (yield* resume(expressions.evaluate(expression.range)));
                    if (isRankSequence(rangeValue)) {
                        if (rangeValue.plan.size.kind === 'infinite') {
                            throw new RankError('cannot materialize an infinite sequence');
                        }
                        const material = materializeSequence(rangeValue);
                        if (expression.dimensions.length === 0) return material;
                        items = material.items;
                    } else if (isRankArray(rangeValue)) {
                        if (expression.dimensions.length === 0) return rangeValue;
                        items = rangeValue.items;
                    } else {
                        throw new RankError('array range must be a sequence or array');
                    }
                } else {
                    items = yield* resume(mapExecution(expression.rows.length > 0
                        ? expression.rows.flatMap(row => row.items)
                        : expression.items, item => expressions.evaluateArrayItem(item)));
                }
                if (expression.dimensions.length === 0) return new ArrayBindingContract('array').check(array(items));
                const shape = yield* resume(expressions.arrayShape(expression.dimensions));
                const size = shape.reduce((product, dimension) => product * BigInt(dimension), 1n);
                if (expression.fill !== undefined) {
                    const fill = (yield* resume(expressions.evaluate(expression.fill)));
                    return new ArrayBindingContract('array fill').fill(
                        ownedArray(Array(Number(size)).fill(fill), shape, typeof fill !== 'object'), fill);
                }
                if (BigInt(items.length) !== size) {
                    throw new RankError(
                        `array shape ${shape.join(' ')} expects ${size} elements, got ${items.length}`,
                    );
                }
                return new ArrayBindingContract('array').check(ownedArray(items, shape));
            };
        }
        const tableQuery = compileTableExpression(expression, () => ({
            get localFrame() { return expressions.context.bindings.current; },
            set localFrame(frame) { expressions.context.bindings.current = frame; },
            requireModule: (module, operation) => expressions.context.requireModule(module, operation),
            evaluate: node => expressions.evaluate(node),
            select: values => expressions.context.select(values),
            binary: (operator, left, right) => expressions.context.operators.evaluateBinary(operator, left, right),
            resolve: name => expressions.context.resolve(name),
            findVariable: name => expressions.context.bindings.find(name),
            isStandardFunction: (module, name, value) => expressions.context.builtins.is(module, name, value),
            maskSelection,
        }));
        if (tableQuery) return tableQuery;
        const clause = compileClauseExpression(expression, () => this.clauseContext());
        if (clause) return clause;
        if (isRecordExpression(expression)) {
            return function* (): Execution<RankValue> {
                const entries = new ResourceMap<RankValue>(value => value);
                const record: RankRecord = entries.resources.track({
                    kind: 'record',
                    entries,
                    types: new Map(),
                });
                for (const field of expression.fields) {
                    if (record.entries.has(field.name)) {
                        throw new RankError(`duplicate record field: .${field.name}`);
                    }
                    const value = yield* resume(expressions.evaluate(field.value));
                    record.entries.set(field.name, value);
                    record.types.set(field.name, typeName(value));
                }
                recordContract(record);
                return record;
            };
        }
        if (isRecordUpdateExpression(expression)) {
            return function* (): Execution<RankValue> {
                const source = yield* resume(expressions.evaluate(expression.source));
                if (!isRankRecord(source)) throw new RankError('with expects a record', 'TypeError');
                const entries = new ResourceMap<RankValue>(value => value);
                const record: RankRecord = entries.resources.track({
                    kind: 'record',
                    entries,
                    types: new Map(source.types),
                    fieldContracts: new Map(recordContract(source).fields),
                });
                for (const [name, value] of source.entries) entries.set(name, value);
                const changed = new Set<string>();
                for (const field of expression.fields) {
                    if (changed.has(field.name)) throw new RankError(`duplicate record field: .${field.name}`);
                    changed.add(field.name);
                    const value = yield* resume(expressions.evaluate(field.value));
                    assignRecordField(record, field.name, field.operator, value, expressions.context.operators);
                }
                return record;
            };
        }
        if (isAliasedTableExpression(expression)) {
            return function* (): Execution<RankValue> {
                expressions.context.requireModule('tables', 'alias');
                let source = yield* resume(expressions.evaluate(expression.source));
                if (expression.field) {
                    source = expressions.context.select([source, { kind: 'label', name: expression.field.name }]);
                }
                return tableAlias(source, expression.name.name);
            };
        }
        if (isKeyedSortExpression(expression)) {
            return function* (): Execution<RankValue> {
                const operation = expression.operator.startsWith('argsort')
                    ? 'argsort by'
                    : 'sort by';
                expressions.context.requireModule('sequences', operation);
                const source = yield* resume(expressions.evaluate(expression.source));
                if (expression.fields.length > 0) {
                    return sortByFields(source, expression.fields.map(field =>
                        ({ name: field.field.name, direction: field.direction })), operation);
                }
                const sort = keyedSort(source, operation);
                if (!expression.key) throw new RankError(`${operation} requires a key`);
                const key = yield* resume(expressions.evaluate(expression.key));
                if (!isNativeFunction(key) || !key.arities.includes(1)) {
                    throw new RankError(`${operation} key must be a unary function`);
                }
                const keys: RankValue[][] = [];
                for (const item of sort.items) {
                    const value = yield* resume(expressions.context.invoke(key, [item]));
                    expressions.context.resources.ownFiles(value);
                    keys.push([value]);
                }
                return sort.finish(keys, [sortFieldDescending(expression.direction)]);
            };
        }
        if (isKeyedGroupExpression(expression) || isKeyedRollingExpression(expression)
            || isKeyedJoinExpression(expression) || isKeyedReachExpression(expression)) {
            return compileKeyedTableExpression(expression, {
                requireModule: (module, operation) => this.context.requireModule(module, operation),
                evaluate: value => this.evaluate(value),
            })!;
        }
        if (isNameExpression(expression)) {
            return () => {
                const value = expressions.context.resolve(expression.name);
                if (!isNativeFunction(value) || !value.arities.includes(0)) return completed(nameMask(value));
                if (tail && expressions.context.resources.currentScopeEmpty()) {
                    expressions.context.functions.throwTailCall(value, []);
                }
                return mapResult(expressions.context.invoke(value, []), result => {
                    expressions.context.resources.ownFiles(result);
                    return result;
                });
            };
        }
        if (isParenthesizedExpression(expression)) {
            if (tail) return this.compile(expression.value, missing, true);
            return () => expressions.evaluate(expression.value);
        }
        if (isUnpackExpression(expression)) {
            return function* (): Execution<RankValue> {
                throw new RankError('unpack requires a surrounding application');
            };
        }
        if (isUnaryExpression(expression)) {
            return function* (): Execution<RankValue> {
                return expressions.context.operators.evaluateUnary(expression.operator, (yield* resume(expressions.evaluate(expression.operand))));
            };
        }
        if (isBinaryExpression(expression)) {
            if (expression.operator === '**' && isUnaryExpression(expression.left)
                && (expression.left.operator === '+' || expression.left.operator === '-')) {
                const left = expression.left;
                return function* (): Execution<RankValue> {
                    const powered = expressions.context.operators.evaluateBinary(
                        '**',
                        (yield* resume(expressions.evaluate(left.operand))),
                        (yield* resume(expressions.evaluate(expression.right))),
                    );
                    return expressions.context.operators.evaluateUnary(left.operator, powered);
                };
            }
            if (expression.operator === 'default') {
                const absent = MISSING;
                let left: (() => Evaluation<RankValue>) | undefined;
                return function* (): Execution<RankValue> {
                    try {
                        // Prepare on first use to preserve operand/error ordering.
                        left ??= expressions.compile(expression.left, () => absent);
                        const value = yield* resume(left());
                        if (isRankArray(value)) {
                            const masked = maskedCells(value);
                            let evaluated: RankValue | undefined;
                            if (masked) {
                                if (allValid(masked.validity, masked.values.length)) return value;
                                const fallback = evaluated = yield* resume(expressions.evaluate(expression.right));
                                if (typeof fallback === 'number') {
                                    const out = masked.values.slice();
                                    for (let index = 0; index < out.length; index += 1) {
                                        if (!isPresentAt(masked.validity, index)) out[index] = fallback;
                                    }
                                    return typedArray(out, value.shape);
                                }
                            }
                            let items: readonly RankValue[];
                            try {
                                items = value.items;
                            } catch (error) {
                                if (!(error instanceof MissingValueError)) throw error;
                                // A missing cell takes the fallback; the other cells keep their values.
                                const size = value.shape.reduce((product, length) => product * length, 1);
                                items = Array.from({ length: size }, (_, index) => {
                                    try {
                                        return readArrayItem(value, index);
                                    } catch (cellError) {
                                        if (!(cellError instanceof MissingValueError)) throw cellError;
                                        return absent;
                                    }
                                });
                            }
                            const unknown = (item: RankValue) => item === absent || item === MISSING;
                            if (!items.some(unknown)) return value;
                            const fallback = evaluated ?? (yield* resume(expressions.evaluate(expression.right)));
                            return createArraySnapshot(
                                items.map(item => unknown(item) ? fallback : item),
                                value.shape,
                            );
                        }
                        if (value !== absent && value !== MISSING) return value;
                    } catch (error) {
                        if (!(error instanceof MissingValueError)) throw error;
                    }
                    return (yield* resume(expressions.evaluate(expression.right)));
                };
            }
            if (expression.operator === 'and' || expression.operator === 'or') {
                const operator = expression.operator;
                const right = () => expressions.evaluate(expression.right);
                return () => flatMapResult(expressions.evaluate(expression.left), left =>
                    expressions.context.operators.decidesGuard(operator, left) ? completed(left)
                        : mapResult(right(), value => expressions.context.operators.evaluateGuard(operator, left, value)));
            }
            if (!expression.step) {
                const right = () => expressions.evaluate(expression.right);
                const operation = (left: RankValue, right: RankValue) =>
                    expressions.context.operators.evaluateBinary(expression.operator, left, right);
                return () => mapPair(expressions.evaluate(expression.left), right, operation);
            }
            return function* (): Execution<RankValue> { return expressions.context.operators.evaluateBinary(
                expression.operator,
                (yield* resume(expressions.evaluate(expression.left))),
                (yield* resume(expressions.evaluate(expression.right))),
                (yield* resume(expressions.evaluate(expression.step!))),
            ); };
        }
        if (isMaterializeExpression(expression)) {
            return function* (): Execution<RankValue> {
                const source = (yield* resume(expressions.evaluate(expression.source)));
                if (isRankTableAlias(source) && isRankSqliteTable(source.source)) {
                    return materializeSqlite(source.source);
                }
                if (isRankSqliteTable(source)) return materializeSqlite(source);
                if (isRankTable(source)) return source.toRows();
                if (isRankSqliteExpression(source)) return materializeSqliteExpression(source);
                if (isRankSequence(source)) return materializeSequence(source);
                const collection = materializeCollection(source);
                if (collection) return collection;
                throw new RankError('postfix array expects a sequence, queue, stack, deque, set, multiset, table or SQLite table');
            };
        }
        if (isAllAxisExpression(expression)) {
            return function* (): Execution<RankValue> { throw new RankError('# is only valid inside tensor addressing'); };
        }
        return function* (): Execution<RankValue> { throw new RankError(`cannot evaluate ${expression.$type}`); };
    }

    /** Binding identity, including aliases; no user function is executed by classification. */
    operationOf(name: string): ReturnType<typeof findOperation> | false {
        const value = this.context.bindings.find(name);
        if (value === undefined) return findOperation(name);
        return isNativeFunction(value) ? BuiltinRegistry.operationOf(value) ?? false : false;
    }

    *evaluateArrayItem(item: ArrayItem): Execution<RankValue> {
        const value = (yield* resume(this.evaluate(item.value)));
        if (!item.sign) return value;
        return this.context.operators.evaluateUnary(item.sign, value);
    }

    evaluateAddressItem(item: AddressItem): Evaluation<RankValue> {
        if (item.all) return completed(ALL_AXIS);
        if (!item.value) throw new RankError('missing array selector');
        const result = this.evaluate(item.value);
        const sign = item.sign;
        return sign ? mapResult(result, value => this.context.operators.evaluateUnary(sign, value)) : result;
    }

    evaluateAddressParts(item: AddressItem): Evaluation<RankValue[]> {
        if (!item.spread) return mapResult(this.evaluateAddressItem(item), value => [value]);
        if (!item.value) throw new RankError('missing unpack expression');
        return mapResult(this.evaluate(item.value), value => unpackApplicationItems(value));
    }

    private *arrayDimension(item: ArrayItem): Execution<number> {
        const dimension = expectInteger((yield* resume(this.evaluateArrayItem(item))));
        return checkedArrayDimension(dimension);
    }

    /** `array shape N M` takes one integer per dimension; `array shape Shape` takes one vector. */
    private *arrayShape(items: readonly ArrayItem[]): Execution<number[]> {
        if (items.length === 1) {
            const value = yield* resume(this.evaluateArrayItem(items[0]!));
            if (!isRankArray(value)) return [checkedArrayDimension(expectInteger(value))];
            if (value.shape.length !== 1) throw new RankError('array shape expects a vector of dimensions');
            return Array.from({ length: value.shape[0]! },
                (_, index) => checkedArrayDimension(expectInteger(value.itemAt?.(index) ?? value.items[index]!)));
        }
        return yield* resume(mapExecution(items, item => this.arrayDimension(item)));
    }

    // Rank source cannot pass a nullary function by name: the name calls it.
    // A host callback can still supply one through a parameter or public binding.
    clauseContext(): ClauseExpressionContext {
        const expressions = this;
        return {
            get localFrame() { return expressions.context.bindings.current; },
            set localFrame(frame) { expressions.context.bindings.current = frame; },
            evaluate: node => expressions.evaluate(node),
            binary: (operator, left, right) => expressions.context.operators.evaluateBinary(operator, left, right),
            findVariable: name => expressions.context.bindings.find(name),
        };
    }

    private directNameValue(value: RankValue): RankValue {
        if (!isNativeFunction(value) || !value.arities.includes(0)) return nameMask(value);
        const result = value.call([]);
        this.context.resources.ownFiles(result);
        return result;
    }

    private singlePass(plan: RankSequence['plan']): RankSequence {
        const source = sequence({ ...plan, singlePass: true });
        return this.context.options().wrapSinglePassSequence?.(source) ?? source;
    }
}

function array(items: RankValue[]): RankArray {
    return ownedArray(items);
}

export function checkedArrayDimension(dimension: bigint): number {
    if (dimension < 0n) throw new RankError(`array dimension must be nonnegative: ${dimension}`);
    if (dimension > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`array dimension is too large: ${dimension}`);
    }
    return Number(dimension);
}
