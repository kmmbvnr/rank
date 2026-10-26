import { checkpoint, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { rankedAddressSelection } from '../ranked-address.js';
import { unpackApplicationItems } from '../value-selection.js';
import {
    deferredBindingReferences, rankedAddressAssignmentForm, type AddressItem, type ApplicationForm, type ArrayAssignmentStatement, type AssignmentStatement,
    applicationExpression, flattenApplication, isApplicationExpression, isLabelLiteral, isNameExpression, isNumberLiteral,
    isUnpackExpression, numericUpdateExpression, statementResultDiscarded, type Expression, type PushStatement, type UnpackStatement,
} from '@arrrank/language';
import { hasDeferredSelectionCopy, prepareStoredScalarView } from '../integer-view.js';
import { materializeValue, materializeValues } from '../materialize.js';
import { demandValue } from '../plan.js';
import { computedArrayUpdate } from '../computed-array-update.js';
import { materializeTensorMap } from '../tensor-map.js';
import { numericSortInPlace } from '../numeric-collections.js';
import { materializeSequence } from '../sequence.js';
import { arrayForWrite, privateArrayCopy, readArrayItem, writableIntegerCells, writeIntegerSelection, accumulateIntegerSelection, reduceIntegerUpdates,
    hasWritableBooleanCells, fillBooleanSelection, writeArrayCell } from '../array-storage.js';
import { addToCollection, expectAddCollection, removeFromCollection } from '../collections.js';
import { expectPushCollection, pushCollection } from '../containers.js';
import { RankError } from '../errors.js';
import { checkValueMutable } from '../value-protection.js';
import {
    completed, flatMapResult, mapExecution, mapResult, resume, type Evaluation, type Execution,
} from '../execution.js';
import { FlatRecords } from '../flat.js';
import { structureWrite } from '../modules/algo.js';
import { flatRecordWrite } from '../modules/sequences.js';
import { tableColumnWrite } from '../modules/tables.js';
import type { InterpreterOptions } from '../interpreter-options.js';
import { arraySize, type Operators } from '../operators.js';
import { assignRecordField } from '../record-write.js';
import { tensorSelection } from '../selectors.js';
import type { PreparedStatement } from '../statement-control.js';
import { writeTable } from '../table-access.js';
import { sameShape } from '../tensor-index.js';
import {
    isRankArray, isRankGraph, isRankLabel, isRankRecord, isRankSequence, isRankTable,
    type RankValue,
} from '../value.js';

/** What preparing a write needs from evaluation and the binding environment. */
export interface AssignmentContext {
    evaluate(expression: Expression): Evaluation<RankValue>;
    defer(expression: Expression): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    compileAssign(name: string): (value: RankValue) => void;
    protect(names: readonly string[], plan: AssignmentStatement): () => void;
    resolveVariable(name: string): RankValue;
    isStandardFunction(module: string, name: string): boolean;
    canConsumeBinding(): boolean;
    checkArrayWrite(name: string, target: RankValue, values: readonly RankValue[], offsets?: readonly number[]): readonly RankValue[];
    evaluateAddressParts(item: AddressItem): Evaluation<RankValue[]>;
    select(values: RankValue[]): RankValue;
    requireModule(module: string, operation: string): void;
    options(): InterpreterOptions;
    readonly operators: Operators;
}

/**
 * `M axis 1` after what is unpacked picks the axis to slice along: the source expression without that
 * tail, and the axis. Anything else is the whole expression with the leading axis.
 */
function unpackSource(expression: Expression): { source: Expression; axis?: number } {
    if (!isApplicationExpression(expression)) return { source: expression };
    const parts = flattenApplication(expression);
    const [marker, number] = parts.slice(-2);
    if (parts.length < 3 || !isNameExpression(marker) || marker.name !== 'axis' || !isNumberLiteral(number)
        || typeof number.value !== 'bigint') return { source: expression };
    if (number.value < 0n || number.value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError('unpack axis must be a nonnegative integer', 'RangeError');
    }
    const rest = parts.slice(0, -2);
    return { source: rest.length === 1 ? rest[0] : applicationExpression(rest, expression), axis: Number(number.value) };
}

/** `Receiver push Value`: appends to a queue, heap or deque; `push unpack Items` appends each item. */
export function preparePushStatement(statement: PushStatement, host: AssignmentContext): PreparedStatement {
    return { stream: function* (): Execution<RankValue | undefined> {
        const receiver = (yield* resume(host.evaluate(statement.receiver)));
        host.requireModule('algo', 'push');
        expectPushCollection(receiver);
        // `Queue push unpack Items` appends each item; a plain value is appended as one element.
        const spread = unpackSource(statement.value);
        if (isUnpackExpression(spread.source)) {
            const items = unpackApplicationItems(yield* resume(host.evaluate(spread.source.value)), spread.axis);
            for (const item of items) pushCollection(receiver, materializeValue(item));
        } else pushCollection(receiver, materializeValue(yield* resume(host.evaluate(statement.value))));
        return undefined;
    } };
}

/** `A B C = Vector`: one name per cell of a rank-1 array, or per slice of a tensor (`= M axis 1` picks the axis). */
export function prepareUnpackStatement(statement: UnpackStatement, host: AssignmentContext): PreparedStatement {
    const writes = statement.names.map(name =>
        name === '#' ? undefined : host.compileAssign(name));
    const { source, axis } = unpackSource(statement.value);
    return { stream: function* (): Execution<RankValue | undefined> {
        const result = (yield* resume(host.evaluate(source)));
        const unpacked = unpackApplicationItems(result, axis);
        if (unpacked.length !== statement.names.length) {
            throw new RankError(`unpack expects ${statement.names.length} values, got ${unpacked.length}`);
        }
        const values = unpacked.map((value, index) => writes[index] ? materializeValue(value) : value);
        for (let index = 0; index < writes.length; index += 1) writes[index]?.(values[index]);
        return result;
    } };
}

/** `Name Selectors = Value` and `op=`: a write into what a name holds. */
export function prepareArrayAssignment(statement: ArrayAssignmentStatement, host: AssignmentContext): PreparedStatement {
    const recipe = !statement.accumulate && statementResultDiscarded(statement) ? numericUpdateExpression(statement.value) : undefined;
    const fused = recipe && computedArrayUpdate(recipe, statement.operator);
    let ranks: readonly (number | '#')[] | undefined;
    try { ranks = rankedAddressAssignmentForm(statement)?.ranks; }
    catch (error) { throw new RankError(error instanceof Error ? error.message : String(error), 'Syntax'); }
    if (statement.accumulate && !['+=', '-=', '*='].includes(statement.operator)) {
        throw new RankError('.accumulate supports only +=, -= and *= on numeric arrays', 'Syntax');
    }
    const general = function* (
        target: RankValue, selectors: RankValue[], evaluated?: RankValue,
    ): Execution<RankValue | undefined> {
        if (ranks && (!isRankArray(target) || isRankTable(target) || target instanceof FlatRecords)) {
            throw new RankError('ranked assignment expects a tensor array', 'TypeError');
        }
        if (ranks && selectors.some(selector => isRankLabel(selector) && selector.name !== '#')) {
            throw new RankError('ranked assignment expects tensor axis selectors', 'TypeError');
        }
        if (statement.accumulate && (!isRankArray(target) || target.kind !== 'array' || isRankTable(target) || target instanceof FlatRecords)) {
            throw new RankError('.accumulate expects a numeric array target', 'TypeError');
        }
        if (isRankTable(target)) {
            // A table is a value: a write makes a new version and rebinds the name.
            host.requireModule('tables', 'table assignment');
            const value = yield* resume(host.evaluate(statement.value));
            rebind(writeTable(target, selectors, value,
                statement.operator === '=' ? undefined : assignmentOperator(statement.operator),
                (operator, left, right) => host.operators.evaluateBinary(operator, left, right)));
            return value;
        }
        if (statement.accumulate && selectors.some(selector => isRankLabel(selector) && selector.name !== '#')) {
            throw new RankError('.accumulate expects numeric array cells', 'TypeError');
        }
        const lastSelector = selectors.at(-1);
        if (target instanceof FlatRecords || lastSelector !== undefined && isRankLabel(lastSelector) && lastSelector.name !== '#') target = owned(target);
        const write = target instanceof FlatRecords
            ? flatRecordWrite(target, selectors, statement.operator, host.operators)
            : structureWrite(target, selectors, statement.operator, host.operators);
        if (write) return write(yield* resume(host.evaluate(statement.value)));
        const field = selectors.at(-1);
        if (field !== undefined && isRankLabel(field) && field.name !== '#') {
            let receiver: RankValue = target;
            for (const selector of selectors.slice(0, -1)) {
                receiver = host.select([receiver, selector]);
            }
            if (isRankArray(receiver)) {
                host.requireModule('tables', 'table column assignment');
                const writeColumn = tableColumnWrite(receiver, field.name, statement.operator, host.operators);
                return writeColumn(yield* resume(host.evaluate(statement.value)));
            }
            if (!isRankRecord(receiver)) {
                throw new RankError('field assignment expects a record target');
            }
            checkValueMutable(receiver);
            return assignRecordField(
                receiver,
                field.name,
                statement.operator,
                yield* resume(host.evaluate(statement.value)),
                host.operators,
            );
        }
        if (!isRankArray(target) || target.kind !== 'array') {
            throw new RankError('array assignment expects an array target');
        }
        if (target.itemAt !== undefined && !hasDeferredSelectionCopy(target)) {
            throw new RankError('cannot assign to a lazy array');
        }
        const selection = ranks ? rankedAddressSelection(target, selectors, ranks) : tensorSelection(target, selectors);
        if (fused && evaluated === undefined && host.options().compilation !== false) {
            const update = fused(target, selection, host);
            if (update) {
                host.checkArrayWrite(statement.name, target, [update.representative]);
                if (update.write(owned(target) as typeof target)) return undefined;
            }
        }
        // The compiled single-cell form hands its value over when the
        // shape rules have to decide what happens to it.
        let result = demandValue(evaluated
            ?? (yield* resume(host.evaluate(statement.value))));
        if (isRankSequence(result)) result = materializeSequence(result);
        const operator = statement.operator === '='
            ? undefined : assignmentOperator(statement.operator);
        let operands: RankValue[] | undefined;
        let compactOperands: Int32Array | undefined;
        const count = arraySize(selection.shape);
        if (isRankArray(result)) {
            if (!sameShape(selection.shape, result.shape)) {
                throw new RankError(
                    `assignment shape mismatch: ${selection.shape} and ${result.shape}`,
                    'DimensionMismatch',
                );
            }
            // The complete RHS is demanded before any replacement is written.
            // Consume native arithmetic as a batch instead of reading its lazy
            // cells individually; aliases still observe the pre-write storage.
            const completed = materializeTensorMap(result) ?? result;
            const view = privateLoopPolling()
                ? prepareStoredScalarView(completed, true) : undefined;
            if (count > 0 && statement.accumulate && host.options().compilation !== false
                && !inspectionEnabled() && privateLoopPolling()
                && view?.linear && view.validateUniform && view.kinds?.join() === 'integer'
                && count >= 4 * arraySize(target.shape) && writableIntegerCells(target)) {
                const { offset, stride } = view.linear;
                const first = view.items[offset] as bigint;
                view.validateUniform(first);
                host.checkArrayWrite(statement.name, target, [first]);
                const updates = reduceIntegerUpdates(arraySize(target.shape), count, selection.offsetAt,
                    index => view.items[offset + index * stride] as bigint, statement.operator === '*=');
                writeIntegerSelection(owned(target) as typeof target, updates.offsets.length,
                    index => updates.offsets[index], updates.operands, statement.operator as '+=' | '-=' | '*=');
                return result;
            }
            if (count > 0 && view?.linear && (!view.validate || view.validateUniform)
                && view.kinds?.length === 1 && ['integer', 'real'].includes(view.kinds[0])) {
                // Uniform stored numeric cells establish a binding's scalar
                // contract once. Still snapshot the RHS before any mutation.
                const { offset, stride } = view.linear;
                view.validateUniform?.(view.compact ? BigInt(view.compact[offset]) : view.items[offset]);
                if (view.compact && !statement.accumulate) compactOperands = new Int32Array(count);
                else operands = new Array<RankValue>(count);
                for (let start = 0; start < count; start += 4096) {
                    const end = Math.min(count, start + 4096);
                    checkpoint('preparing accumulated array updates', end - start);
                    for (let index = start; index < end; index++) {
                        if (compactOperands) compactOperands[index] = view.compact![offset + index * stride];
                        else operands![index] = view.compact
                            ? BigInt(view.compact[offset + index * stride]) : view.items[offset + index * stride];
                    }
                }
            } else operands = Array.from(
                { length: count },
                (_, index) => readArrayItem(completed, index),
            );
        }
        if (count > 0 && host.options().compilation !== false && !inspectionEnabled()
            && (target.shape.length === 1 || statement.accumulate || ranks !== undefined)
            && (statement.operator === '=' || statement.operator === '+=' || statement.operator === '-=' || statement.operator === '*=')
            && (typeof result === 'bigint' || compactOperands || operands?.every(value => typeof value === 'bigint'))) {
            const cells = writableIntegerCells(target);
            if (cells) {
                // Every replacement is an integer; the binding owns validation,
                // independently of the physical storage proof above.
                host.checkArrayWrite(statement.name, target, [typeof result === 'bigint' ? result
                    : compactOperands ? BigInt(compactOperands[0]) : operands![0]]);
                let values: bigint | readonly bigint[] | Int32Array = typeof result === 'bigint' ? result : compactOperands ?? operands as bigint[];
                let operation = statement.operator;
                if (!statement.accumulate && !selection.unique && operation !== '=') {
                    // Gather before scatter: repeated addresses all read the
                    // original destination, and the last replacement wins.
                    const replacements: bigint[] = [];
                    for (let i = 0; i < count; i++) {
                        checkpoint('preparing array write');
                        const old = cells[selection.offsetAt(i)];
                        const rhs = typeof values === 'bigint' ? values : values instanceof Int32Array ? BigInt(values[i]) : values[i];
                        replacements.push(operation === '+=' ? old + rhs : operation === '-=' ? old - rhs : old * rhs);
                    }
                    values = replacements;
                    operation = '=';
                }
                const destination = owned(target) as typeof target;
                if (statement.accumulate) {
                    accumulateIntegerSelection(destination, count, selection.offsetAt, values as bigint | readonly bigint[], operation as '+=' | '-=' | '*=');
                } else writeIntegerSelection(destination, count, selection.offsetAt, values, operation as '=' | '+=' | '-=' | '*=', selection.linear);
                return result;
            }
        }
        if (compactOperands) operands = Array.from(compactOperands, BigInt);
        if (count > 0 && host.options().compilation !== false && host.options().booleanSelectionCompilation !== false
            && privateLoopPolling()
            && target.shape.length === 1 && statement.operator === '='
            && typeof result === 'boolean' && hasWritableBooleanCells(target)) {
            host.checkArrayWrite(statement.name, target, [result]);
            fillBooleanSelection(owned(target) as typeof target, count, selection.offsetAt, result);
            return result;
        }
        if (statement.accumulate) {
            // Reduce updates before writing: -= subtracts their sum, while *=
            // multiplies their product. RHS/selector aliases still see a snapshot.
            const updates = new Map<number, RankValue>();
            const reduction = statement.operator === '*=' ? '*' : '+';
            for (let index = 0; index < count; index++) {
                checkpoint('accumulating array updates');
                const offset = selection.offsetAt(index);
                const operand = operands ? operands[index] : result;
                if (typeof operand !== 'bigint' && typeof operand !== 'number') {
                    throw new RankError('.accumulate expects numeric updates', 'TypeError');
                }
                const previous = updates.get(offset);
                updates.set(offset, previous === undefined ? operand
                    : host.operators.evaluateBinary(reduction, previous, operand));
            }
            const offsets = [...updates.keys()];
            const replacements = offsets.map(offset => {
                const old = demandValue(readArrayItem(target, offset));
                if (typeof old !== 'bigint' && typeof old !== 'number') {
                    throw new RankError('.accumulate expects numeric array cells', 'TypeError');
                }
                return materializeValue(host.operators.evaluateBinary(operator!, old, updates.get(offset)!));
            });
            const checked = host.checkArrayWrite(statement.name, target, replacements, offsets);
            const destination = owned(target) as typeof target;
            for (let index = 0; index < offsets.length; index++) {
                checkpoint('writing accumulated array updates');
                writeArrayCell(destination, offsets[index], checked[index]);
            }
            return result;
        }
        operands ??= Array(count).fill(result) as RankValue[];
        const replacements = materializeValues(operands.map((operand, index) => operator === undefined
            ? operand
            : host.operators.evaluateBinary(
                operator,
                demandValue(readArrayItem(target, selection.offsetAt(index))),
                demandValue(operand),
            )));
        const checked = host.checkArrayWrite(statement.name, target, replacements, replacements.map((_, index) => selection.offsetAt(index)));
        const destination = owned(target) as typeof target;
        for (let index = 0; index < replacements.length; index += 1) {
            writeArrayCell(destination, selection.offsetAt(index), checked[index]);
        }
        return result;
    };
    // A write is where sharing has to be paid for: shared storage
    // becomes this name's own copy, which the name then keeps.
    const rebind = host.compileAssign(statement.name);
    const owned = (target: RankValue, offset?: number): RankValue => {
        const copy = isRankArray(target) && hasDeferredSelectionCopy(target)
            ? privateArrayCopy(target) : arrayForWrite(target, offset);
        if (copy === undefined) return target;
        rebind(copy);
        return copy;
    };
    const address = !ranks && statement.indices.length === 1 ? statement.indices[0] : undefined;
    const directIndex = address && !address.all && !address.sign && !address.spread && address.value
        ? host.compileDirect(address.value) : undefined;
    const directValue = host.compileDirect(statement.value);
    if (directIndex && directValue && !statement.accumulate) {
        // One integer index into a stored vector is the shape dynamic
        // programming writes in its inner loop. It needs no suspendable
        // task, no selector list and no tensor selection; anything that
        // does falls through to the general form with the selector it
        // already evaluated.
        const operator = statement.operator === '='
            ? undefined : assignmentOperator(statement.operator);
        return { stream: (): Evaluation<RankValue | undefined> => {
            let target = host.resolveVariable(statement.name);
            const selector = directIndex();
            if (typeof selector === 'bigint' && typeof target === 'object'
                && target.kind === 'array' && target.shape.length === 1
                && target.itemAt === undefined) {
                const offset = Number(selector);
                if (offset >= 0 && offset < target.shape[0]) {
                    const value = directValue();
                    if (typeof value === 'object') return general(target, [selector], value);
                    const replacement = materializeValue(operator === undefined ? value
                        : host.operators.evaluateBinary(operator, demandValue(readArrayItem(target, offset)), value));
                    const [checked] = host.checkArrayWrite(statement.name, target, [replacement]);
                    target = owned(target, offset) as typeof target;
                    writeArrayCell(target, offset, checked);
                    return completed(value);
                }
            }
            return general(target, [selector]);
        } };
    }
    return { stream: (): Evaluation<RankValue | undefined> => {
        let target = host.resolveVariable(statement.name);
        // Selectors that all complete hand straight over to the general
        // form, so the usual case adds no second generator to drive.
        return flatMapResult(
            mapExecution(statement.indices, index => host.evaluateAddressParts(index)),
            selectors => general(target, selectors.flat()),
        );
    } };
}

/** `Name = Value` and `Name op= Value`. */
export function prepareAssignment(statement: AssignmentStatement, host: AssignmentContext): PreparedStatement {
    if (statement.accumulate) throw new RankError('.accumulate requires indexed array assignment', 'Syntax');
    const operator = statement.operator === '='
        ? undefined : assignmentOperator(statement.operator);
    const direct = statement.deferred ? undefined : host.compileDirect(statement.value);
    const write = host.compileAssign(statement.name);
    const protectedNames = statement.deferred ? deferredBindingReferences(statement).map(read => read.name) : [];
    const stored = (value: RankValue): RankValue => {
        return statement.deferred ? value : materializeValue(value);
    };
    const parts = operator === undefined && !statement.deferred && !statement.name.includes('.')
        && isApplicationExpression(statement.value) ? flattenApplication(statement.value) : [];
    const selfSort = (parts.length === 2 || parts.length === 3 && isLabelLiteral(parts[2])
        && ['ascending', 'descending'].includes(parts[2].name))
        && isNameExpression(parts[0]) && parts[0].name === statement.name
        && isNameExpression(parts[1]) && parts[1].name === 'sort';
    if (direct) {
        return { run: () => {
            const result = stored(operator === undefined ? direct() : host.operators.evaluateBinary(
                operator, host.resolveVariable(statement.name), direct(),
            ));
            write(result);
            return result;
        } };
    }
    return { stream: () => {
        if (selfSort && host.options().compilation !== false && host.canConsumeBinding()
            && host.isStandardFunction('sequences', 'sort')) {
            const sorted = numericSortInPlace(host.resolveVariable(statement.name),
                parts.length === 3 && isLabelLiteral(parts[2]) && parts[2].name === 'descending');
            if (sorted) { write(sorted); return completed(sorted); }
        }
        const previous = operator === undefined ? undefined : host.resolveVariable(statement.name);
        return mapResult(statement.deferred ? host.defer(statement.value) : host.evaluate(statement.value), value => {
            const result = stored(operator === undefined ? value : host.operators.evaluateBinary(operator, previous!, value));
            const protect = statement.deferred ? host.protect(protectedNames, statement) : undefined;
            write(result);
            protect?.();
            return result;
        });
    } };
}

/** `Receiver add X` and `Receiver remove X` on a collection or graph. */
export function prepareCollectionMutation(
    mutation: Extract<ApplicationForm, { kind: 'collection-mutation' }>, host: AssignmentContext,
): PreparedStatement {
    return { stream: function* (): Execution<RankValue | undefined> {
        const target = yield* resume(host.evaluate(mutation.receiver));
        if (isRankGraph(target)) {
            host.requireModule('graph', mutation.operation);
            if (mutation.operation !== 'add') {
                throw new RankError('graph does not support remove');
            }
            const values = yield* resume(mapExecution(
                mutation.arguments ?? [mutation.value],
                value => host.evaluate(value),
            ));
            target.add(values);
            return undefined;
        }
        // The receiver decides first. Asking for `use algo` before
        // knowing the value can take the mutation blames a module for
        // what is really a receiver that is not a collection at all.
        const receiver = mutation.operation === 'add'
            ? expectAddCollection(target) : target;
        host.requireModule('algo', mutation.operation);
        const value = yield* resume(host.evaluate(mutation.value));
        if (mutation.operation === 'add') addToCollection(receiver, materializeValue(value));
        else removeFromCollection(receiver, value);
        return undefined;
    } };
}

function assignmentOperator(operator: string): string {
    return operator.slice(0, -1);
}
