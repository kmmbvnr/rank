import {
    type AddStatement, type AddressItem, type ApplicationForm, type ArrayAssignmentStatement, type AssignmentStatement,
    type Expression, type IndexAssignmentStatement, type PushStatement, type UnpackStatement,
} from '@arrrank/language';
import { arrayForWrite, readArrayItem } from '../array-storage.js';
import { addToCollection, expectAddCollection, removeFromCollection } from '../collections.js';
import { pushCollection } from '../containers.js';
import { MissingValueError, RankError } from '../errors.js';
import {
    completed, flatMapResult, mapExecution, mapResult, resume, type Evaluation, type Execution,
} from '../execution.js';
import { FlatRecords } from '../flat.js';
import { indexKey } from '../index-key.js';
import type { InterpreterOptions } from '../interpreter-options.js';
import { arraySize, type Operators } from '../operators.js';
import { assignRecordField } from '../record-contract.js';
import { RankPersistentSumSegment, RankRangeSumSegment } from '../segment.js';
import { tensorSelection } from '../selectors.js';
import type { PreparedStatement } from '../statement-control.js';
import { writeTable } from '../table-access.js';
import { sameShape } from '../tensor-index.js';
import {
    isRankArray, isRankFenwick, isRankGraph, isRankIndex, isRankLabel, isRankObject, isRankRecord, isRankSegment,
    isRankSequence, isRankTable,
    type RankCounter, type RankIndex, type RankSet, type RankValue,
} from '../value.js';

/** What preparing a write needs from evaluation and the binding environment. */
export interface AssignmentContext {
    evaluate(expression: Expression): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    compileAssign(name: string): (value: RankValue) => void;
    resolveVariable(name: string): RankValue;
    evaluateAddressParts(item: AddressItem): Evaluation<RankValue[]>;
    select(values: RankValue[]): RankValue;
    requireModule(module: string, operation: string): void;
    /** The scope's implicit structures, created on first use. */
    index(): RankIndex;
    set(): RankSet;
    counter(): RankCounter;
    options(): InterpreterOptions;
    readonly operators: Operators;
}

/** `Receiver push Value`: appends to a queue, heap or deque. */
export function preparePushStatement(statement: PushStatement, host: AssignmentContext): PreparedStatement {
    return { stream: function* (): Execution<RankValue | undefined> {
        const receiver = (yield* resume(host.evaluate(statement.receiver)));
        host.requireModule('algo', 'push');
        pushCollection(receiver, (yield* resume(host.evaluate(statement.value))));
        return undefined;
    } };
}

/** `add set X` and `add counter X`: the scope's implicit structure. */
export function prepareAddStatement(statement: AddStatement, host: AssignmentContext): PreparedStatement {
    return { stream: function* (): Execution<RankValue | undefined> {
        const value = (yield* resume(host.evaluate(statement.value)));
        if (statement.structure.startsWith('counter')) {
            addToCollection(host.counter(), value);
        } else {
            addToCollection(host.set(), value);
        }
        return undefined;
    } };
}

/** `index Keys = Value`: the scope's implicit index. */
export function prepareIndexAssignment(statement: IndexAssignmentStatement, host: AssignmentContext): PreparedStatement {
    return { stream: function* (): Execution<RankValue | undefined> {
        const index = host.index();
        const keys = yield* resume(mapExecution(statement.keys, key => host.evaluate(key)));
        index.entries.set(indexKey(keys), (yield* resume(host.evaluate(statement.value))));
        return undefined;
    } };
}

/** `A B C = Vector`: one name per cell of a rank-1 array. */
export function prepareUnpackStatement(statement: UnpackStatement, host: AssignmentContext): PreparedStatement {
    const writes = statement.names.map(name =>
        name === '#' ? undefined : host.compileAssign(name));
    return { stream: function* (): Execution<RankValue | undefined> {
        const result = (yield* resume(host.evaluate(statement.value)));
        if (!isRankArray(result) || result.shape.length !== 1) {
            throw new RankError('unpack expects a rank-1 array value');
        }
        const unpacked = result;
        if (unpacked.items.length !== statement.names.length) {
            throw new RankError(
                `unpack expects ${statement.names.length} values, got ${unpacked.items.length}`,
            );
        }
        for (let index = 0; index < writes.length; index += 1) {
            writes[index]?.(unpacked.items[index]);
        }
        return result;
    } };
}

/** `Name Selectors = Value` and `op=`: a write into what a name holds. */
export function prepareArrayAssignment(statement: ArrayAssignmentStatement, host: AssignmentContext): PreparedStatement {
    const general = function* (
        target: RankValue, selectors: RankValue[], evaluated?: RankValue,
    ): Execution<RankValue | undefined> {
        if (isRankTable(target)) {
            // A table is a value: a write makes a new version and rebinds the name.
            host.requireModule('tables', 'table assignment');
            const value = yield* resume(host.evaluate(statement.value));
            rebind(writeTable(target, selectors, value,
                statement.operator === '=' ? undefined : assignmentOperator(statement.operator),
                (operator, left, right) => host.operators.evaluateBinary(operator, left, right)));
            return value;
        }
        if (isRankIndex(target)) {
            const key = indexKey(selectors);
            const value = yield* resume(host.evaluate(statement.value));
            if (statement.operator === '=') target.entries.set(key, value);
            else {
                const previous = target.entries.get(key);
                if (previous === undefined) throw new MissingValueError('index key not found');
                target.entries.set(key, host.operators.evaluateBinary(
                    assignmentOperator(statement.operator), previous, value,
                ));
            }
            return undefined;
        }
        if (isRankFenwick(target)) {
            if (selectors.length !== 1 || typeof selectors[0] !== 'bigint') {
                throw new RankError('fenwick assignment expects one integer index');
            }
            const value = yield* resume(host.evaluate(statement.value));
            const result = statement.operator === '=' ? value : host.operators.evaluateBinary(
                assignmentOperator(statement.operator), target.at(selectors[0]), value,
            );
            if (typeof result !== 'bigint') {
                throw new RankError('fenwick values must be integers');
            }
            target.set(selectors[0], result);
            return result;
        }
        if (isRankSegment(target)) {
            if (selectors.length === 2
                && selectors.every(selector => typeof selector === 'bigint')
                && (target instanceof RankRangeSumSegment
                    || target instanceof RankPersistentSumSegment)) {
                const value = yield* resume(host.evaluate(statement.value));
                if (statement.operator === '=') {
                    target.setRange(selectors[0], selectors[1], value);
                } else if (statement.operator === '+=') {
                    target.addRange(selectors[0], selectors[1], value);
                } else {
                    throw new RankError('segment + range assignment supports = and +=');
                }
                return value;
            }
            if (selectors.length !== 1 || typeof selectors[0] !== 'bigint') {
                throw new RankError('segment assignment expects one integer index');
            }
            const value = yield* resume(host.evaluate(statement.value));
            const result = statement.operator === '=' ? value : host.operators.evaluateBinary(
                assignmentOperator(statement.operator), target.at(selectors[0]), value,
            );
            target.set(selectors[0], result);
            return result;
        }
        if (target instanceof FlatRecords) {
            if (selectors.length < 1 || selectors.length > 2 || typeof selectors[0] !== 'bigint') {
                throw new RankError('flat assignment expects an integer index and optional field');
            }
            const index = Number(selectors[0]);
            const previous = target.itemAt(index);
            const value = yield* resume(host.evaluate(statement.value));
            if (selectors.length === 2) {
                const field = selectors[1];
                if (!isRankLabel(field)) throw new RankError('flat assignment expects a field label');
                const result = assignRecordField(previous, field.name, statement.operator, value, host.operators);
                target.set(index, previous);
                return result;
            }
            if (statement.operator !== '=') throw new RankError('flat record assignment supports =');
            target.set(index, value);
            return value;
        }
        const field = selectors.at(-1);
        if (field !== undefined && isRankLabel(field) && field.name !== '#') {
            let receiver: RankValue = target;
            for (const selector of selectors.slice(0, -1)) {
                receiver = host.select([receiver, selector]);
            }
            if (isRankArray(receiver)) {
                host.requireModule('tables', 'table column assignment');
                if (receiver.shape.length !== 1) {
                    throw new RankError(
                        'table column assignment expects a rank-1 table',
                        'DimensionMismatch',
                    );
                }
                const result = yield* resume(host.evaluate(statement.value));
                let operands: RankValue[];
                if (isRankArray(result)) {
                    if (!sameShape(receiver.shape, result.shape)) {
                        throw new RankError(
                            `assignment shape mismatch: ${receiver.shape} and ${result.shape}`,
                            'DimensionMismatch',
                        );
                    }
                    operands = Array.from(
                        { length: arraySize(receiver.shape) },
                        (_, index) => readArrayItem(result, index),
                    );
                } else {
                    operands = Array(arraySize(receiver.shape)).fill(result) as RankValue[];
                }
                const rows = Array.from(
                    { length: arraySize(receiver.shape) },
                    (_, index) => readArrayItem(receiver, index),
                );
                if (!rows.every(isRankObject)) {
                    throw new RankError('table assignment expects object rows', 'TypeError');
                }
                const operator = statement.operator === '='
                    ? undefined : assignmentOperator(statement.operator);
                const replacements = operands.map((operand, index) => {
                    if (operator === undefined) return operand;
                    const previous = rows[index].entries.get(field.name);
                    if (previous === undefined) {
                        throw new MissingValueError(`missing object key: ${field.name}`);
                    }
                    return host.operators.evaluateBinary(operator, previous, operand);
                });
                for (let index = 0; index < rows.length; index += 1) {
                    rows[index].entries.set(field.name, replacements[index]);
                }
                return result;
            }
            if (!isRankRecord(receiver)) {
                throw new RankError('field assignment expects a record target');
            }
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
        if (target.itemAt !== undefined) {
            throw new RankError('cannot assign to a lazy array');
        }
        const selection = tensorSelection(target, selectors);
        // The compiled single-cell form hands its value over when the
        // shape rules have to decide what happens to it.
        const result = evaluated
            ?? (yield* resume(host.evaluate(statement.value)));
        const operator = statement.operator === '='
            ? undefined : assignmentOperator(statement.operator);
        let operands: RankValue[];
        if (isRankArray(result)) {
            if (!sameShape(selection.shape, result.shape)) {
                throw new RankError(
                    `assignment shape mismatch: ${selection.shape} and ${result.shape}`,
                    'DimensionMismatch',
                );
            }
            operands = Array.from(
                { length: arraySize(selection.shape) },
                (_, index) => readArrayItem(result, index),
            );
        } else {
            operands = Array(arraySize(selection.shape)).fill(result) as RankValue[];
        }
        const replacements = operands.map((operand, index) => operator === undefined
            ? operand
            : host.operators.evaluateBinary(
                operator,
                target.items[selection.offsetAt(index)],
                operand,
            ));
        for (let index = 0; index < replacements.length; index += 1) {
            target.items[selection.offsetAt(index)] = replacements[index];
        }
        return result;
    };
    // A write is where sharing has to be paid for: shared storage
    // becomes this name's own copy, which the name then keeps.
    const rebind = host.compileAssign(statement.name);
    const owned = (target: RankValue): RankValue => {
        const copy = arrayForWrite(target);
        if (copy === undefined) return target;
        rebind(copy);
        return copy;
    };
    const address = statement.indices.length === 1 ? statement.indices[0] : undefined;
    const directIndex = address && !address.all && !address.sign && !address.spread && address.value
        ? host.compileDirect(address.value) : undefined;
    const directValue = host.compileDirect(statement.value);
    if (directIndex && directValue) {
        // One integer index into a stored vector is the shape dynamic
        // programming writes in its inner loop. It needs no suspendable
        // task, no selector list and no tensor selection; anything that
        // does falls through to the general form with the selector it
        // already evaluated.
        const operator = statement.operator === '='
            ? undefined : assignmentOperator(statement.operator);
        return { stream: (): Evaluation<RankValue | undefined> => {
            const target = owned(host.resolveVariable(statement.name));
            const selector = directIndex();
            if (typeof selector === 'bigint' && typeof target === 'object'
                && target.kind === 'array' && target.shape.length === 1
                && target.itemAt === undefined) {
                const offset = Number(selector);
                if (offset >= 0 && offset < target.shape[0]) {
                    const value = directValue();
                    if (isRankArray(value)) return general(target, [selector], value);
                    target.items[offset] = operator === undefined ? value
                        : host.operators.evaluateBinary(operator, target.items[offset], value);
                    return completed(value);
                }
            }
            return general(target, [selector]);
        } };
    }
    return { stream: (): Evaluation<RankValue | undefined> => {
        const target = owned(host.resolveVariable(statement.name));
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
    const operator = statement.operator === '='
        ? undefined : assignmentOperator(statement.operator);
    const direct = host.compileDirect(statement.value);
    const write = host.compileAssign(statement.name);
    const stored = (value: RankValue): RankValue => isRankSequence(value)
        ? host.options().wrapStoredSequence?.(value) ?? value : value;
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
        const previous = operator === undefined ? undefined : host.resolveVariable(statement.name);
        return mapResult(host.evaluate(statement.value), value => {
            const result = stored(operator === undefined ? value : host.operators.evaluateBinary(operator, previous!, value));
            write(result);
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
        if (mutation.operation === 'add') addToCollection(receiver, value);
        else removeFromCollection(receiver, value);
        return undefined;
    } };
}

function assignmentOperator(operator: string): string {
    return operator.slice(0, -1);
}
