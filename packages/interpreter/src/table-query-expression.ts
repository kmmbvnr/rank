import {
    findOperation, flattenApplication, isLabelLiteral, isNameExpression, isNumberLiteral, isRecordField,
    isTableFilterExpression, isTableSelectExpression, isTableWriteExpression, isTableWritePreviewExpression,
    type Expression,
} from '@arrrank/language';
import { derivedArray, ownedArray, readArrayItem } from './array-storage.js';
import { resume, mapExecution, type Evaluation, type Execution } from './execution.js';
import { RankError } from './errors.js';
import { LocalFrame } from './frame.js';
import { ResourceMap } from './resource-summary.js';
import { positionalSelection } from './sequence.js';
import { selectAxis } from './selectors.js';
import { TABLE_INPUT, collectionExpression, frameAxes, readsFields, tableExpression } from './table-expression.js';
import { compareOrderedValues, orderedKind } from './ordered.js';
import { selectGroupedColumnar, selectColumns, filterTable } from './table-ops.js';
import { selectGroupedTable, selectTable, type GroupAggregateSpec, type GroupAggregateOperation } from './modules/tables.js';
import { executeSqliteWrite, sqliteWindowNumber, sqliteWrite } from './modules/sqlite.js';
import {
    isNativeFunction, isRankArray, isRankGroupedTable, isRankObject, isRankRecord, isRankSequence, isRankSequenceMask,
    isRankSqliteTable, isRankTable, isRankTableAlias, type RankArray, type RankRecord, type RankSequence, type RankValue,
    typeName,
    MISSING,
} from './value.js';

export interface TableExpressionContext {
    localFrame: LocalFrame | undefined;
    requireModule(module: string, operation: string): void;
    evaluate(expression: Expression): Evaluation<RankValue>;
    select(values: RankValue[]): RankValue;
    binary(operator: string, left: RankValue, right: RankValue): RankValue;
    resolve(name: string): RankValue;
    findVariable(name: string): RankValue | undefined;
    isStandardFunction(module: string, name: string, value: RankValue): boolean;
    maskSelection(source: RankArray, mask: RankArray): RankSequence;
}

/** Compile table and collection query forms without depending on the Interpreter facade. */
export function compileTableExpression(
    expression: Expression, makeContext: () => TableExpressionContext,
): (() => Evaluation<RankValue>) | undefined {
    if (isTableFilterExpression(expression) || isTableSelectExpression(expression)) {
        const context = makeContext();
        return function* (): Execution<RankValue> {
                // Filtering a plain collection is ordinary selection, so it needs
                // no table vocabulary. A condition naming a column is a table query.
                const conditions = !isTableFilterExpression(expression) ? []
                    : expression.condition ? [expression.condition] : expression.conditions;
                // Syntax only proposes the collection form; the source settles it.
                // A mask over a table column names no field, so the condition
                // alone cannot tell the two apart.
                let collection = isTableFilterExpression(expression)
                    && expression.sourceFields.length === 0 && !conditions.some(readsFields);
                if (!collection) {
                    context.requireModule('tables', isTableFilterExpression(expression) ? 'filter' : 'select');
                }
                let source = yield* resume(context.evaluate(expression.source));
                // A table source keeps the table form even when its condition
                // names no column: only that path returns rows that are still a
                // table. A plain collection needs no table vocabulary.
                if (collection && isTableSource(source)) {
                    collection = false;
                    context.requireModule('tables', 'filter');
                }
                for (const field of expression.sourceFields) {
                    source = context.select([source, { kind: 'label', name: field.name }]);
                }
                if (isRankTableAlias(source)) source = source.source;
                if (isRankGroupedTable(source)) {
                    if (!isTableSelectExpression(expression) || expression.columns
                        || expression.fields.length > 0) {
                        throw new RankError('grouped tables require a select block', 'TypeError');
                    }
                    const specs: GroupAggregateSpec[] = expression.entries.map(entry => {
                        if (!isRecordField(entry)) {
                            throw new RankError('grouped select expects named aggregates', 'TypeError');
                        }
                        const parts = flattenApplication(entry.value);
                        const field = (parts.length >= 2 && isLabelLiteral(parts[0]))
                            ? parts[0].name : undefined;
                        const operationNode = parts[parts.length - 1];
                        const aggregateNames = [
                            'count', 'sum', 'min', 'max', 'mean', 'median', 'std',
                            'variance', 'var', 'skewness', 'skew', 'mode', 'quantile', 'percentile',
                        ];
                        let parameter: RankValue | undefined;
                        if (parts.length === 3 && isLabelLiteral(parts[0])) {
                            if (isNumberLiteral(parts[1])) {
                                parameter = parts[1].value;
                            }
                        }
                        if ((parts.length !== 1 && field === undefined)
                            || !isNameExpression(operationNode)
                            || !aggregateNames.includes(operationNode.name)
                            || (field === undefined && operationNode.name !== 'count')) {
                            throw new RankError('grouped select expects count or .field aggregate', 'TypeError');
                        }
                        const operation = operationNode.name as GroupAggregateOperation;
                        context.requireModule(operation === 'count' ? 'sequences'
                            : ['sum', 'min', 'max'].includes(operation) ? 'core' : 'stats', operation);
                        return { name: entry.name, operation, field, parameter };
                    });
                    if (source.columnar) return selectGroupedColumnar(source, specs);
                    return selectGroupedTable(source, specs);
                }
                if (collection) {
                    if (!isRankArray(source) && !isRankSequence(source)) {
                        throw new RankError('filter expects an array, sequence or table', 'TypeError');
                    }
                } else if ((!isRankArray(source) || source.shape.length !== 1) && !isRankSqliteTable(source)
                    && !isRankTable(source)) {
                    throw new RankError('filter/select expects a rank-1 table or SQLite view', 'TypeError');
                }
                const previous = context.localFrame;
                const frame = new LocalFrame(previous);
                frame.set(TABLE_INPUT, source);
                context.localFrame = frame;
                const contextual = (node: Expression): Evaluation<RankValue> => {
                    if (collection) {
                        // A bare name is a predicate when it names an operation
                        // and the mask itself when it names data, so a computed
                        // mask reads the same bare as it does parenthesized.
                        const bound = isNameExpression(node)
                            ? context.findVariable(node.name) : undefined;
                        if (bound !== undefined && !isNativeFunction(bound)) {
                            return context.evaluate(node);
                        }
                        return context.evaluate(collectionExpression(node));
                    }
                    const lowered = tableExpression(node, name => {
                        const value = context.resolve(name);
                        if (!isNativeFunction(value)) return undefined;
                        const operation = findOperation(value.name);
                        if (!operation || operation.effects?.length
                            || !context.isStandardFunction(operation.module, operation.name, value)) {
                            throw new RankError('table expressions accept only pure standard-library functions', 'TypeError');
                        }
                        if (isRankSqliteTable(source) && ['sum', 'len'].includes(operation.name)) {
                            throw new RankError('SQLite aggregates inside filter/select expressions are not supported yet', 'TypeError');
                        }
                        return value.arities;
                    });
                    return context.evaluate(lowered);
                };
                try {
                    if (isTableFilterExpression(expression)) {
                        let mask = yield* resume(contextual(conditions[0]));
                        for (const condition of conditions.slice(1)) {
                            mask = context.binary('and', mask, yield* resume(contextual(condition)));
                        }
                        if (collection) {
                            if (!isRankArray(mask) && !isRankSequenceMask(mask) && !booleanSequence(mask)) {
                                throw new RankError('filter requires a boolean mask over the filtered value', 'TypeError');
                            }
                            // A predicate with a cell rank yields one value per frame cell,
                            // so the mask selects along the frame rather than over atoms.
                            if (isRankArray(source) && isRankArray(mask)
                                && mask.shape.length < source.shape.length
                                && arraySize(mask.shape) !== arraySize(source.shape)) {
                                const axes = conditions.length === 1 ? frameAxes(conditions[0]) : [];
                                if (axes.length > 1 || mask.shape.length > 1) {
                                    throw new RankError('filter does not support a frame of two or more axes yet', 'TypeError');
                                }
                                const axis = axes[0] ?? 0;
                                if (axis >= source.shape.length) {
                                    throw new RankError(`array has no axis ${axis}`, 'DimensionMismatch');
                                }
                                if (mask.shape[0] !== source.shape[axis]) {
                                    throw new RankError(`filter mask length ${mask.shape[0]} does not match axis `
                                        + `${axis} of shape ${source.shape.join(' ')}`, 'DimensionMismatch');
                                }
                                return selectAxis(source, axis, mask);
                            }
                            // An empty mask would read as an empty index list and select an array.
                            if (isRankArray(source) && isRankArray(mask)) return context.maskSelection(source, mask);
                            // A plain boolean sequence is positional; generic sequence addressing
                            // treats it as indices and would read the entire mask first.
                            if (isRankSequence(source) && isRankSequence(mask) && !isRankSequenceMask(mask)) {
                                return positionalSelection(source, mask);
                            }
                            // Selection already defines every mask shape a collection allows.
                            return context.select([source, mask]);
                        }
                        if (isRankTable(source)) {
                            if (!isRankArray(mask)) {
                                throw new RankError('filter requires a boolean mask with one value per row', 'TypeError');
                            }
                            return filterTable(source, mask);
                        }
                        if (isRankArray(source)) {
                            if (!isRankArray(mask) || mask.shape.length !== 1
                                || mask.shape[0] !== source.shape[0]
                                || !mask.items.every(value => typeof value === 'boolean' || value === MISSING)) {
                                throw new RankError('filter requires a boolean mask with one value per row', 'TypeError');
                            }
                            const selected = selectAxis(source, 0, mask) as RankArray;
                            if (source.columnNames) Object.defineProperty(selected, 'columnNames', { value: source.columnNames });
                            if (source.tableScopes) Object.defineProperty(selected, 'tableScopes', { value: source.tableScopes });
                            return selected;
                        }
                        return context.select([source, mask]);
                    }
                    if (expression.columns) {
                        const columns = yield* resume(context.evaluate(expression.columns));
                        return isRankTable(source) && isRankRecord(columns)
                            ? selectColumns(source, columns) : selectTable(source, columns);
                    }
                    const entries = new ResourceMap<RankValue>(value => value);
                    const record: RankRecord = entries.resources.track({ kind: 'record', entries, types: new Map() });
                    const add = (name: string, value: RankValue): void => {
                        if (entries.has(name)) throw new RankError(`duplicate select field: .${name}`, 'TypeError');
                        entries.set(name, value);
                        record.types.set(name, typeName(value));
                    };
                    for (const field of expression.fields) {
                        add(field.name, context.select([source, { kind: 'label', name: field.name }]));
                    }
                    for (const entry of expression.entries) {
                        const window = isRecordField(entry) && isNameExpression(entry.value)
                            && (entry.value.name === 'rownumber' || entry.value.name === 'ranknumber')
                            ? entry.value.name : undefined;
                        let value: RankValue;
                        if (window && isRankSqliteTable(source)) {
                            value = sqliteWindowNumber(source, window);
                        } else if (window === 'rownumber' && isRankTable(source)) {
                            value = ownedArray(Array.from({ length: source.length }, (_, index) => BigInt(index + 1)), [source.length], true);
                        } else if (window === 'ranknumber' && isRankTable(source)) {
                            value = ranksOf(source.sortKeys, source.length);
                        } else if (window === 'rownumber' && isRankArray(source)) {
                            value = derivedArray(source.shape, [source], index => BigInt(index + 1), true);
                        } else if (window === 'ranknumber' && isRankArray(source)) {
                            const keys = source.sortKeys;
                            if (!keys) throw new RankError('ranknumber requires sort by before select', 'TypeError');
                            const ranks: bigint[] = [];
                            let rank = 1n;
                            for (let index = 0; index < keys.length; index += 1) {
                                if (index > 0 && keys[index].some((key, column) => {
                                    const previous = keys[index - 1][column];
                                    return key === undefined || previous === undefined
                                        ? key !== previous
                                        : compareOrderedValues(key, previous, orderedKind(key)) !== 0;
                                })) rank = BigInt(index + 1);
                                ranks.push(rank);
                            }
                            value = derivedArray(source.shape, [source], index => ranks[index], true);
                        } else {
                            value = yield* resume(contextual(entry.value));
                        }
                        if (isRecordField(entry)) add(entry.name, value);
                        else {
                            const previous = frame.get(entry.name);
                            if (previous !== undefined && typeName(previous) !== typeName(value)) {
                                throw new RankError(`select local ${entry.name} cannot change type`, 'TypeError');
                            }
                            frame.define(entry.name, value, new Set([typeName(value)]));
                        }
                    }
                    return isRankTable(source) ? selectColumns(source, record) : selectTable(source, record);
                } finally {
                    context.localFrame = previous;
                }
            };
        }
    if (isTableWriteExpression(expression) || isTableWritePreviewExpression(expression)) {
        const context = makeContext();
            const write = isTableWritePreviewExpression(expression) ? expression.write : expression;
            const mode = isTableWritePreviewExpression(expression) ? expression.mode : undefined;
            return function* (): Execution<RankValue> {
                context.requireModule('tables', 'insert');
                let source = yield* resume(context.evaluate(write.source));
                for (const field of write.sourceFields) {
                    source = context.select([source, { kind: 'label', name: field.name }]);
                }
                if (!isRankSqliteTable(source)) throw new RankError('write expects a SQLite table', 'TypeError');
                const operation = write.values.length > 0 ? 'insert'
                    : write.entries.length > 0 ? 'update' : 'delete';
                const values = operation === 'insert'
                    ? yield* resume(mapExecution(write.values, value => context.evaluate(value))) : [];
                const fields: RankRecord = { kind: 'record', entries: new Map(), types: new Map() };
                if (operation === 'update') {
                    const previous = context.localFrame;
                    const frame = new LocalFrame(previous);
                    frame.set(TABLE_INPUT, source);
                    context.localFrame = frame;
                    try {
                        for (const entry of write.entries) {
                            const lowered = tableExpression(entry.value, name => {
                                const value = context.resolve(name);
                                if (!isNativeFunction(value)) return undefined;
                                const info = findOperation(value.name);
                                if (!info || info.effects?.length
                                    || !context.isStandardFunction(info.module, info.name, value)) {
                                    throw new RankError('update expressions accept pure standard-library functions', 'TypeError');
                                }
                                return value.arities;
                            });
                            const value = yield* resume(context.evaluate(lowered));
                            if (isRecordField(entry)) {
                                if (fields.entries.has(entry.name)) throw new RankError('duplicate update field', 'TypeError');
                                fields.entries.set(entry.name, value);
                            } else frame.define(entry.name, value, new Set([typeName(value)]));
                        }
                    } finally { context.localFrame = previous; }
                }
                return executeSqliteWrite(sqliteWrite(source, operation, values, fields), mode);
            };
        }
    return undefined;
}

/** Competition ranks from the keys of the preceding `sort by`: ties share a rank. */
/** A lazy sequence of booleans, such as `mod 3 equal 0 or mod 5 equal 0` builds; its first item decides. */
function booleanSequence(value: RankValue): boolean {
    if (!isRankSequence(value)) return false;
    for (const item of value.plan.iterate()) return typeof item === 'boolean';
    return true;
}

function ranksOf(keys: readonly (readonly (RankValue | undefined)[])[] | undefined, length: number): RankArray {
    if (!keys) throw new RankError('ranknumber requires sort by before select', 'TypeError');
    const ranks: bigint[] = [];
    let rank = 1n;
    for (let index = 0; index < keys.length; index += 1) {
        if (index > 0 && keys[index].some((key, column) => {
            const previous = keys[index - 1][column];
            return key === undefined || previous === undefined
                ? key !== previous
                : compareOrderedValues(key, previous, orderedKind(key)) !== 0;
        })) rank = BigInt(index + 1);
        ranks.push(rank);
    }
    if (ranks.length !== length) throw new RankError('ranknumber requires sort by before select', 'TypeError');
    return ownedArray(ranks, [length], true);
}

function arraySize(shape: readonly number[]): number {
    return shape.reduce((product, dimension) => product * dimension, 1);
}

/** A table is a column table, a SQLite view or a rank-1 array of object rows. */
function isTableSource(value: RankValue): boolean {
    if (isRankSqliteTable(value) || isRankTable(value)) return true;
    if (!isRankArray(value) || value.kind !== 'array' || value.shape.length !== 1) return false;
    if (value.columnNames !== undefined) return true;
    return value.shape[0] > 0 && isRankObject(readArrayItem(value, 0));
}
