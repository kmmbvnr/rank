import { ownedArray, readArrayItem } from './array-storage.js';
import { RankDeque } from './containers.js';
import { MissingValueError, RankError } from './errors.js';
import { indexKey } from './index-key.js';
import { requireModule } from './modules/shared.js';
import {
    filterSqlite, projectSqlite, sliceSqlite, sliceTextSqlite, sqliteColumn, sqliteScope, sqliteScopedColumn,
    sqliteTable,
} from './modules/sqlite.js';
import { projectAliasedField, projectField, projectFields } from './modules/tables.js';
import { arraySize, rangeBounds } from './operators.js';
import {
    atArray, isCollectionSelector, isIntegerCollectionSelector, isTensorAddress, selectAxis, sliceArray,
    tensorSelection,
} from './selectors.js';
import { atSequence, filterSequence, isPositionalMask, positionalSelection, sequence } from './sequence.js';
import { setValueKey } from './set.js';
import { applyTable, canApplyTable } from './table-access.js';
import { sameShape } from './tensor-index.js';
import {
    isRankTuple, isRankArray, isRankCounter, isRankErrorValue, isRankFenwick, isRankGraph, isRankGroupedTable,
    isRankIndex, isRankLabel, isRankMultiset, isRankObject, isRankQueue, isRankRecord, isRankSegment,
    isRankSequence, isRankSequenceMask, isRankSqliteDatabase, isRankSqliteExpression, isRankSqliteScope,
    isRankSqliteTable, isRankTable, isRankTableAlias, MISSING,
    type RankArray, type RankSequence, type RankValue,
} from './value.js';

// Selection: what `Value Selector ...` means once every part is a value. A
// value followed by selectors is addressed; a function after its data is
// called on arguments gathered here. Neither calls Rank code.

/**
 * Address a value by the selectors after it. Tables, SQLite sources and column
 * lists are read through their modules, which must be open; anything else is
 * ordinary selection.
 */
export function selectValues(modules: ReadonlySet<string>, values: RankValue[], missing?: () => RankValue): RankValue {
    if (isRankTuple(values[0]) && values.length > 1) {
        if (typeof values[1] !== 'bigint') throw new RankError('tuple positions require an integer index', 'TypeError');
        const items = values[0].items;
        const index = Number(values[1] < 0n ? BigInt(items.length) + values[1] : values[1]);
        if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) throw new MissingValueError('tuple index out of bounds');
        return values.length === 2 ? items[index] : selectValues(modules, [items[index], ...values.slice(2)], missing);
    }
    if (isScopedSelectorChain(values)) {
        if (values.length === 3 && isRankArray(values[0])) {
            const scope = isRankLabel(values[1]) ? values[1].name : values[1] as string;
            const field = isRankLabel(values[2]) ? values[2].name : values[2] as string;
            return projectAliasedField(values[0], scope, field, missing);
        }
        let selected = values[0];
        for (const selector of values.slice(1)) {
            selected = selectValues(modules, [selected, selector], missing);
        }
        return selected;
    }
    if (values.length === 2 && isRankTableAlias(values[0])) {
        return selectValues(modules, [values[0].source, values[1]], missing);
    }
    if (isRankTable(values[0]) && canApplyTable(values)) {
        requireModule(modules, 'tables', 'table addressing');
        return applyTable(values[0], values, missing, rest => selectValues(modules, rest, missing));
    }
    if (values.length === 2 && isRankSqliteDatabase(values[0]) && isRankLabel(values[1])) {
        requireModule(modules, 'tables', 'SQLite table selection');
        return sqliteTable(values[0], values[1].name);
    }
    if (values.length === 2 && isRankSqliteTable(values[0])) {
        requireModule(modules, 'tables', 'SQLite table operation');
        const table = values[0];
        const selector = values[1];
        if (isRankLabel(selector) || typeof selector === 'string') {
            if (table.scopes?.has(isRankLabel(selector) ? selector.name : selector)) {
                return sqliteScope(table, isRankLabel(selector) ? selector.name : selector);
            }
            return sqliteColumn(table, isRankLabel(selector) ? selector.name : selector);
        }
        if (isRankArray(selector) && isTableFieldList(selector, true)) {
            return projectSqlite(table, selector.items.map(item =>
                isRankLabel(item) ? item.name : item as string));
        }
        if (isRankSqliteExpression(selector)) return filterSqlite(table, selector);
    }
    if (values.length === 2 && isRankSqliteScope(values[0])
        && (isRankLabel(values[1]) || typeof values[1] === 'string')) {
        return sqliteScopedColumn(values[0], isRankLabel(values[1]) ? values[1].name : values[1]);
    }
    if (values.length === 2 && isRankArray(values[0]) && isRankArray(values[1])
        && isTableFieldList(values[1], modules.has('tables'))) {
        requireModule(modules, 'tables', 'table column selection');
        return projectFields(values[0], values[1]);
    }
    if (values.length === 2 && isRankArray(values[0])
        && (typeof values[1] === 'string' || isRankLabel(values[1]))) {
        requireModule(modules, 'tables', 'table projection');
        const field = typeof values[1] === 'string' ? values[1] : values[1].name;
        return projectField(values[0], field, missing);
    }
    return applySelectors(values, missing);
}

export function applySelectors(values: RankValue[], missing?: () => RankValue): RankValue {
    if (isRankTable(values[0]) && canApplyTable(values)) {
        return applyTable(values[0], values, missing, rest => applySelectors(rest, missing));
    }
    const sqlite = sqliteRangeSelection(values);
    if (sqlite !== undefined) return sqlite;
    // `Walk .order i`: read the field, then address what it holds.
    if (values.length > 2 && isRankLabel(values[1]) && hasField(values[0], values[1].name)) {
        return applySelectors([applySelectors(values.slice(0, 2)), ...values.slice(2)], missing);
    }
    if (values.length === 2 && isRankGroupedTable(values[0]) && isRankLabel(values[1])) {
        throw new RankError('grouped tables require a select block', 'TypeError');
    }
    // Reading one cell out of an array is the most common application in the
    // language. The branch that serves it sits seventeen type guards down, and
    // every guard reloads `kind` from a receiver whose shape varies, so the
    // whole chain runs uncached. Answer that one case up front.
    if (values.length === 2 && typeof values[1] === 'bigint') {
        const receiver = values[0];
        if (typeof receiver === 'object' && receiver.kind === 'array') {
            const size = receiver.shape.length === 1 ? receiver.shape[0] : -1;
            if (size >= 0) {
                if (values[1] < 0n) throw new MissingValueError('array index out of bounds on axis 0');
                const position = Number(values[1]);
                if (position >= size) {
                    throw new MissingValueError(`array index out of bounds on axis 0: ${values[1]}`);
                }
                return readArrayItem(receiver, position);
            }
        }
    }
    if (values.length === 2 && isRankErrorValue(values[0]) && isRankLabel(values[1])) {
        const [error, field] = values;
        if (field.name === 'Kind') return error.errorKind;
        if (field.name === 'Message') return error.message;
        if (field.name === 'Trace') return error.trace;
        if (field.name === 'Cause') {
            if (error.cause === undefined) throw new MissingValueError('error has no cause');
            return error.cause;
        }
        if (field.name === 'Value') {
            if (error.value === undefined) throw new MissingValueError('error has no value');
            return error.value;
        }
        throw new RankError(`unknown error field: .${field.name}`);
    }
    if (values.length === 2 && isRankRecord(values[0]) && isRankLabel(values[1])) {
        const [record, field] = values;
        const value = record.entries.get(field.name);
        if (value === undefined) {
            throw new MissingValueError(`missing record field: .${field.name}`);
        }
        return value;
    }
    if (values.length === 2 && isRankGraph(values[0])) {
        return values[0].neighbors(values[1]);
    }
    if (values.length === 2 && typeof values[0] === 'string' && typeof values[1] === 'bigint') {
        const atoms = [...values[0]];
        const index = values[1];
        if (index < 0n) throw new MissingValueError('text index out of bounds');
        if (index >= BigInt(atoms.length)) {
            throw new MissingValueError(`text index out of bounds: ${index}`);
        }
        return atoms[Number(index)];
    }
    if (values.length === 2 && typeof values[0] === 'string'
        && isCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (values.length === 2 && isRankSequence(values[0]) && typeof values[1] === 'bigint') {
        return atSequence(values[0], values[1]);
    }
    if (values.length === 2 && (isRankSequence(values[0]) || isRankArray(values[0])) && isPositionalMask(values[1])) {
        return positionalSelection(values[0], values[1]);
    }
    if (values.length === 2 && isRankSequence(values[0]) && isRankSequenceMask(values[1])) {
        const [source, selector] = values;
        // The mask's own source can take its test; any other value reads it by position.
        if (selector.source === source) return filterSequence(source, selector.predicate);
        return positionalSelection(source, selector);
    }
    if (values.length === 2 && isRankSequence(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (isRankIndex(values[0]) && values.length === 2
        && (isRankArray(values[1]) || isRankSequence(values[1]))) {
        // Gather: an index addressed by many keys answers with one value per key.
        const source = values[0];
        const keys = values[1];
        const read = (key: RankValue): RankValue => {
            const value = source.entries.get(indexKey([key]));
            if (value !== undefined) return value;
            if (missing) return missing();
            throw new MissingValueError('missing keyed value');
        };
        if (isRankSequence(keys)) {
            if (keys.plan.size.kind === 'infinite') {
                throw new RankError('an index cannot be gathered by an infinite sequence');
            }
            return ownedArray([...keys.plan.iterate()].map(read));
        }
        return ownedArray(Array.from(keys.items, read), keys.shape);
    }
    if (isRankIndex(values[0])) {
        const value = values[0].entries.get(indexKey(values.slice(1)));
        if (value === undefined) {
            // Missing keys under default are ordinary sparse reads, not exceptions.
            if (missing) return missing();
            throw new MissingValueError('missing keyed value');
        }
        return value;
    }
    if (isRankCounter(values[0]) && values.length === 2) {
        return values[0].entries.get(setValueKey(values[1]))?.count ?? 0n;
    }
    if (isRankFenwick(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') {
        return values[0].at(values[1]);
    }
    if (isRankSegment(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') {
        return values[0].at(values[1]);
    }
    if (isRankMultiset(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') {
        return values[0].at(values[1]);
    }
    if (isRankObject(values[0])) {
        // A list of keys reads each one, in the order listed.
        if (values.length === 2 && isRankArray(values[1]) && values[1].shape.length === 1) {
            const object = values[0];
            const keys = values[1];
            return ownedArray(Array.from({ length: keys.shape[0] }, (_, index) => {
                const key = readArrayItem(keys, index);
                if (typeof key !== 'string') throw new RankError('object addressing expects text keys');
                const value = object.entries.get(key);
                if (value === undefined) throw new MissingValueError(`missing object key: ${key}`, true);
                return value;
            }));
        }
        if (values.length !== 2 || (typeof values[1] !== 'string' && !isRankLabel(values[1]))) {
            throw new RankError('object addressing expects one text key or an array of them');
        }
        const key = isRankLabel(values[1]) ? values[1].name : values[1];
        const value = values[0].entries.get(key);
        if (value === undefined) throw new MissingValueError(`missing object key: ${key}`, true);
        return value;
    }
    if (isRankQueue(values[0]) && values.length === 2 && typeof values[1] === 'bigint') {
        const position = values[1];
        if (position < 0n) throw new MissingValueError('queue index out of bounds');
        if (values[0] instanceof RankDeque) {
            const item = values[0].at(Number(position));
            if (item === undefined) throw new MissingValueError(`queue index out of bounds: ${position}`);
            return item;
        }
        if (position >= BigInt(values[0].items.length)) {
            throw new MissingValueError(`queue index out of bounds: ${position}`);
        }
        return values[0].items[Number(position)];
    }
    if (values.length === 2 && isRankQueue(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (isRankArray(values[0]) && values.length > 1
        && values.slice(1).every(value => typeof value === 'bigint')) {
        const source = values[0];
        const indices = values.slice(1) as bigint[];
        if (source.shape.length > 0 && indices.length > source.shape.length) {
            const selected = atArray(source, indices.slice(0, source.shape.length));
            if (typeof selected === 'bigint' || typeof selected === 'number'
                || typeof selected === 'boolean' || isRankLabel(selected)) {
                throw new RankError(`${indices.length} selectors exceed array rank ${source.shape.length}`, 'DimensionMismatch');
            }
            return applySelectors([selected, ...indices.slice(source.shape.length)], missing);
        }
        return atArray(source, indices);
    }
    if (values.length === 2 && isRankArray(values[0])
        && isIntegerCollectionSelector(values[1])) {
        return selectAxis(values[0], 0, values[1]);
    }
    if (isRankArray(values[0]) && isTensorAddress(values.slice(1))) {
        const source = values[0];
        const selection = tensorSelection(source, values.slice(1));
        return sliceArray(source, selection);
    }
    const last = values.at(-1);
    if (values.length > 2 && last !== undefined && isRankLabel(last) && last.name !== '#') {
        const receiver = applySelectors(values.slice(0, -1), missing);
        return applySelectors([receiver, last], missing);
    }
    // `Rows 0 .attributes Keys`: a field read inside an address addresses what it returns.
    const field = values.findIndex((value, index) => index > 1 && isRankLabel(value) && value.name !== '#');
    if (field > 0 && field < values.length - 1) {
        const receiver = applySelectors(values.slice(0, field + 1), missing);
        return applySelectors([receiver, ...values.slice(field + 1)], missing);
    }
    if (values.length === 2 && isRankSequence(values[0]) && isRankArray(values[1])) {
        return sequenceMaskSelection(values[0], values[1]);
    }
    if (values.length !== 2 || !isRankArray(values[0]) || !isRankArray(values[1])) {
        throw new RankError('value application requires a sequence and one selector');
    }

    return maskSelection(values[0], values[1]);
}

/** A boolean array mask over a finite sequence of exactly its length. */
function sequenceMaskSelection(source: RankSequence, selector: RankArray): RankSequence {
    const size = source.plan.size;
    if (size.kind === 'infinite') {
        throw new RankError('cannot apply finite array mask to an infinite sequence', 'DimensionMismatch');
    }
    if (selector.shape.length !== 1) {
        throw new RankError(`sequence mask must be rank 1, got rank ${selector.shape.length}`, 'DimensionMismatch');
    }
    if (!selector.items.every(item => typeof item === 'boolean' || item === MISSING)) {
        throw new RankError('array selector must be a boolean mask');
    }
    if (size.kind === 'exact' && BigInt(selector.shape[0]) !== size.value) {
        throw new RankError(`mask shape [${selector.shape[0]}] does not match sequence size ${size.value}`, 'DimensionMismatch');
    }
    const mask = selector.items;
    return sequence({
        name: 'sequence mask selection',
        size: { kind: 'unknown' },
        *iterate() {
            let index = 0;
            for (const item of source.plan.iterate()) {
                if (index >= mask.length) {
                    throw new RankError(`mask shape [${mask.length}] does not match sequence size`, 'DimensionMismatch');
                }
                if (mask[index] === true) yield item;
                index += 1;
            }
            if (index !== mask.length) {
                throw new RankError(`mask shape [${mask.length}] does not match sequence size ${index}`, 'DimensionMismatch');
            }
        },
    });
}

/** The atoms a boolean mask keeps, as a lazy selection even when nothing is kept. */
export function maskSelection(source: RankArray, selector: RankArray): RankSequence {
    const sourceSize = arraySize(source.shape);
    if (!sameShape(source.shape, selector.shape)) {
        throw new RankError(`mask shape mismatch: ${source.shape} and ${selector.shape}`);
    }
    if (!selector.items.every(item => typeof item === 'boolean' || item === MISSING)) {
        throw new RankError('array selector must be a boolean mask');
    }

    // A cell with no value is not selected, as in SQL.
    const mask = selector.items;
    return sequence({
        name: 'array mask selection',
        size: { kind: 'unknown' },
        *iterate() {
            for (let index = 0; index < sourceSize; index += 1) {
                if (mask[index] === true) yield readArrayItem(source, index);
            }
        },
    });
}

export function callArguments(
    fn: Extract<RankValue, { kind: 'function' }>,
    values: RankValue[],
    select: (values: RankValue[]) => RankValue = applySelectors,
): RankValue[] {
    // `Model .weights matmul`: a label naming a field of the value before it
    // reads that field; it is not the function's own argument.
    const fields = readFields(values);
    if (fields.length < values.length && fn.arities.includes(fields.length)) return fields;
    if (fn.arities.includes(values.length)) return values;

    const arities = [...fn.arities].sort((left, right) => right - left);
    for (const arity of arities) {
        if (arity < 1 || values.length <= arity) continue;
        const firstLength = values.length - arity + 1;
        const firstParts = values.slice(0, firstLength);
        if (!canApplySelectors(firstParts)) continue;
        let first: RankValue;
        try {
            first = select(firstParts);
        } catch (error) {
            if (error instanceof RankError) {
                error.message += `\nWhile preparing arguments for ${fn.name}: the first ${firstLength} values were interpreted as a receiver and its selectors.`
                    + '\nTo pass independently computed arguments, group each argument with parentheses.';
            }
            throw error;
        }
        return [first, ...values.slice(firstLength)];
    }

    return values;
}

/** Folds each `Record .field` pair whose record has that field into the field's value. */
function readFields(values: RankValue[]): RankValue[] {
    const result: RankValue[] = [];
    for (const value of values) {
        const receiver = result.at(-1);
        if (isRankLabel(value) && receiver !== undefined && hasField(receiver, value.name)) {
            result[result.length - 1] = applySelectors([receiver, value]);
        } else result.push(value);
    }
    return result;
}

/** A record or object names its fields. Tables are left alone: functions such
 * as `Rows .when datetime` take a table and a column label as two arguments. */
export function hasField(value: RankValue, name: string): boolean {
    return (isRankRecord(value) || isRankObject(value)) && value.entries.has(name);
}

/** `Rows (0 until 10)` on SQLite: the range slices the query instead of reading its rows. */
function sqliteRangeSelection(values: RankValue[]): RankValue | undefined {
    if (values.length !== 2 || !isRankSequence(values[1])) return undefined;
    const bounds = rangeBounds(values[1]);
    if (!bounds) return undefined;
    const { start, end, inclusive } = bounds;
    if (isRankSqliteExpression(values[0])) return sliceTextSqlite(values[0], start, end, inclusive);
    if (isRankSqliteTable(values[0])) return sliceSqlite(values[0], start, inclusive ? end + 1n : end);
    return undefined;
}

export function canApplySelectors(values: RankValue[]): boolean {
    if (values.length === 2 && (isRankSqliteExpression(values[0]) || isRankSqliteTable(values[0]))
        && isRankSequence(values[1]) && rangeBounds(values[1]) !== undefined) return true;
    if (isScopedSelectorChain(values)) return true;
    if (isRankTable(values[0])) return canApplyTable(values);
    if (values.length === 2 && isRankTableAlias(values[0])) {
        return canApplySelectors([values[0].source, values[1]]);
    }
    if (values.length === 2 && isRankSqliteScope(values[0])) {
        return isRankLabel(values[1]) || typeof values[1] === 'string';
    }
    if (values.length === 2 && isRankGroupedTable(values[0]) && isRankLabel(values[1])) return true;
    if (values.length === 2 && isRankSqliteTable(values[0])) {
        return isRankLabel(values[1]) || typeof values[1] === 'string'
            || isRankSqliteExpression(values[1])
            || (isRankArray(values[1]) && isTableFieldList(values[1], true));
    }
    if (values.length < 2) return false;
    if (values.length === 2 && isRankGraph(values[0])) return true;
    if (values.length === 2 && typeof values[0] === 'string'
        && typeof values[1] === 'bigint') return true;
    if (values.length === 2 && typeof values[0] === 'string'
        && isCollectionSelector(values[1])) return true;
    if (values.length === 2 && isRankSequence(values[0])
        && typeof values[1] === 'bigint') return true;
    if (values.length === 2 && isRankSequence(values[0])
        && isRankSequenceMask(values[1])) return true;
    if (values.length === 2 && (isRankSequence(values[0]) || isRankArray(values[0]))
        && isPositionalMask(values[1])) return true;
    if (values.length === 2 && isRankSequence(values[0])
        && isIntegerCollectionSelector(values[1])) return true;
    if (values.length === 2 && isRankArray(values[0]) && isRankArray(values[1])) {
        return isTableFieldList(values[1])
            || values[1].items.every(item => typeof item === 'bigint')
            || (sameShape(values[0].shape, values[1].shape)
                && values[1].items.every(item => typeof item === 'boolean'));
    }
    if (values.length === 2 && isRankArray(values[0])
        && (typeof values[1] === 'string' || isRankLabel(values[1]))) return true;
    if (isRankArray(values[0]) && isRankSequence(values[1])) return true;
    if (isRankIndex(values[0]) && values.length > 1) return true;
    if (isRankCounter(values[0]) && values.length === 2) return true;
    if (isRankFenwick(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') return true;
    if (isRankSegment(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') return true;
    if (isRankMultiset(values[0]) && values.length === 2
        && typeof values[1] === 'bigint') return true;
    if (isRankObject(values[0]) && values.length === 2
        && (typeof values[1] === 'string'
            || (isRankArray(values[1]) && values[1].shape.length === 1
                && values[1].items.every(item => typeof item === 'string')))) return true;
    if (isRankRecord(values[0]) && values.length === 2
        && isRankLabel(values[1])) return true;
    if (isRankQueue(values[0]) && values.length === 2 && typeof values[1] === 'bigint') return true;
    if (isRankQueue(values[0]) && isIntegerCollectionSelector(values[1])) return true;
    if (isRankArray(values[0]) && values.length > 1
        && values.slice(1).every(value => typeof value === 'bigint')) return true;
    if (isRankArray(values[0]) && isTensorAddress(values.slice(1))) return true;
    const last = values.at(-1);
    if (values.length > 2 && last !== undefined && isRankLabel(last) && last.name !== '#') {
        return canApplySelectors(values.slice(0, -1));
    }
    return false;
}

function isScopedSelectorChain(values: readonly RankValue[]): boolean {
    if (values.length < 3 || !values.slice(1).every(value =>
        isRankLabel(value) || typeof value === 'string')) return false;
    const source = values[0];
    const first = values[1];
    const name = isRankLabel(first) ? first.name : first as string;
    return (isRankSqliteTable(source) && source.scopes?.has(name) === true)
        || (isRankArray(source) && source.tableScopes?.includes(name) === true);
}

/**
 * The cells an `unpack` spreads: the items of a tuple or rank-1 array. A tensor gives its slices along
 * one axis, the leading one unless `axis` names another, each slice without that axis.
 */
export function unpackApplicationItems(value: RankValue, axis?: number): RankValue[] {
    if (isRankTuple(value)) {
        if (axis !== undefined) throw new RankError('unpack axis expects an array', 'TypeError');
        return [...value.items];
    }
    if (!isRankArray(value)) {
        throw new RankError('unpack expects an array or tuple value', 'TypeError');
    }
    const rank = value.shape.length;
    if (axis === undefined && rank === 1) {
        return Array.from(
            { length: value.shape[0] },
            (_, index) => readArrayItem(value, index),
        );
    }
    const along = axis ?? 0;
    if (along >= rank) throw new RankError(`unpack axis out of bounds: ${along}`, 'DimensionMismatch');
    return Array.from({ length: value.shape[along] }, (_, index) => selectAxis(value, along, BigInt(index)));
}

function isTableFieldList(value: RankValue, includeEmpty = true): boolean {
    return isRankArray(value) && value.shape.length === 1
        && ((includeEmpty && value.items.length === 0)
            || value.items.some(item => typeof item === 'string' || isRankLabel(item)));
}
