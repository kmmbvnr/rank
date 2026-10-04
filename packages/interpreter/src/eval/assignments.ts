import { unpackApplicationItems } from '../value-selection.js';
import {
    type AddressItem, type ApplicationForm, type ArrayAssignmentStatement, type AssignmentStatement,
    applicationExpression, flattenApplication, isApplicationExpression, isNameExpression, isNumberLiteral,
    isUnpackExpression, type Expression, type PushStatement, type UnpackStatement,
} from '@arrrank/language';
import { arrayForWrite, readArrayItem } from '../array-storage.js';
import { addToCollection, expectAddCollection, removeFromCollection } from '../collections.js';
import { pushCollection } from '../containers.js';
import { RankError } from '../errors.js';
import {
    completed, flatMapResult, mapExecution, mapResult, resume, type Evaluation, type Execution,
} from '../execution.js';
import { FlatRecords } from '../flat.js';
import { structureWrite } from '../modules/algo.js';
import { flatRecordWrite } from '../modules/sequences.js';
import { tableColumnWrite } from '../modules/tables.js';
import type { InterpreterOptions } from '../interpreter-options.js';
import { arraySize, type Operators } from '../operators.js';
import { assignRecordField } from '../record-contract.js';
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
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    compileAssign(name: string): (value: RankValue) => void;
    resolveVariable(name: string): RankValue;
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
        // `Queue push unpack Items` appends each item; a plain value is appended as one element.
        const spread = unpackSource(statement.value);
        if (isUnpackExpression(spread.source)) {
            const items = unpackApplicationItems(yield* resume(host.evaluate(spread.source.value)), spread.axis);
            for (const item of items) pushCollection(receiver, item);
        } else pushCollection(receiver, (yield* resume(host.evaluate(statement.value))));
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
        for (let index = 0; index < writes.length; index += 1) writes[index]?.(unpacked[index]);
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
        const checked = host.checkArrayWrite(statement.name, target, replacements, replacements.map((_, index) => selection.offsetAt(index)));
        const destination = owned(target) as typeof target;
        for (let index = 0; index < replacements.length; index += 1) {
            destination.items[selection.offsetAt(index)] = checked[index];
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
            let target = host.resolveVariable(statement.name);
            const selector = directIndex();
            if (typeof selector === 'bigint' && typeof target === 'object'
                && target.kind === 'array' && target.shape.length === 1
                && target.itemAt === undefined) {
                const offset = Number(selector);
                if (offset >= 0 && offset < target.shape[0]) {
                    const value = directValue();
                    if (isRankArray(value)) return general(target, [selector], value);
                    const replacement = operator === undefined ? value
                        : host.operators.evaluateBinary(operator, target.items[offset], value);
                    const [checked] = host.checkArrayWrite(statement.name, target, [replacement]);
                    target = owned(target) as typeof target;
                    target.items[offset] = checked;
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
