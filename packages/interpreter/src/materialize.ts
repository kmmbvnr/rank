import type { CallParameter } from '@arrrank/language';
import { denseScalarItems, materializeCells, ownedArray, ownedObject, readArrayItem } from './array-storage.js';
import { demandValue } from './plan.js';
import { checkpoint } from './interrupt.js';
import { inheritSemanticArrayType } from './semantic-array-type.js';
import { materializeSequence } from './sequence.js';
import { MissingValueError, RankError } from './errors.js';
import { RankDeque, RankHeap, pushCollection } from './containers.js';
import { RankMultiset } from './multiset.js';
import { newStructure, addToCollection } from './collections.js';
import { ResourceMap } from './resource-summary.js';
import { recordContract } from './record-contract.js';
import { setValueKey } from './set.js';
import { isStoredValue } from './stored-value.js';
import { RankArrowTable, checkColumnValues, columnFromValues } from './arrow-table.js';
import { groupedTableValues, ownedGroupedTable, groupTable, rollingTable } from './grouped-table.js';
import { materializeSqlite, materializeSqliteExpression, materializeSqliteScope } from './modules/sqlite.js';
import {
    isRankArray, isRankSequence, isRankTuple, isRankRecord, isRankObject, isRankIndex,
    isRankQueue, isRankSet, isRankCounter, isRankMultiset, isRankTable, isRankTableAlias,
    isRankSqliteTable, isRankSqliteExpression, isRankSqliteScope, isRankGroupedTable, tuple, typeName, MISSING,
    checkCollectionElementType, type RankRecord, type RankCounter, type RankTuple, type RankValue,
} from './value.js';

interface Aggregate {
    readonly values: RankValue[];
    readonly force?: boolean;
    /** Mutable shells keep shared references and container cycles intact. */
    readonly create?: () => RankValue;
    readonly phase?: 0 | 1;
    finish(values: RankValue[], shell?: RankValue, nestedChanged?: boolean): RankValue;
}

interface Completion {
    readonly source: RankValue;
    readonly aggregate: Aggregate;
    readonly children: Map<number, Completion>;
    readonly parents: Completion[];
    changed: boolean;
    nestedChanged: boolean;
    result?: RankValue;
}

/** Complete the final value, including nested plans. Results of plans are not
 * cached: only aggregate identity is shared within this one binding. Copies are
 * published after completion, so a failure cannot partially alter the input. */
export function materializeValue(value: RankValue): RankValue {
    value = demandValue(value);
    if (isStoredValue(value)) return value;
    const known = new Map<RankValue, Completion>();
    const nodes: Completion[] = [];
    const pending: { node: Completion; index: number }[] = [];
    const enter = (input: RankValue): { value: RankValue; node?: Completion } => {
        let computed = demandValue(input);
        if (isRankSequence(computed)) computed = materializeSequence(computed);
        else if (isRankSqliteTable(computed)) computed = materializeSqlite(computed);
        else if (isRankSqliteExpression(computed)) computed = materializeSqliteExpression(computed);
        else if (isRankSqliteScope(computed)) computed = materializeSqliteScope(computed);
        else if (isRankGroupedTable(computed) && computed.sqliteSource) {
            const rows = materializeSqlite(computed.sqliteSource);
            computed = computed.rolling
                ? rollingTable(rows, BigInt(computed.rolling.width), computed.rolling.field)
                : groupTable(rows, computed.fields, computed.rollup);
        }
        if (isStoredValue(computed)) return { value: computed };
        const previous = known.get(computed);
        if (previous) return { value: computed, node: previous };
        const aggregate = aggregateValue(computed);
        if (!aggregate) return { value: computed };
        const node: Completion = { source: computed, aggregate, children: new Map(), parents: [],
            changed: aggregate.force === true, nestedChanged: false };
        known.set(computed, node);
        nodes.push(node);
        pending.push({ node, index: 0 });
        return { value: computed, node };
    };
    const root = enter(value);
    while (pending.length) {
        checkpoint('materializing binding');
        const frame = pending[pending.length - 1];
        const { node } = frame;
        if (frame.index === node.aggregate.values.length) { pending.pop(); continue; }
        const index = frame.index++;
        const original = node.aggregate.values[index];
        let child: ReturnType<typeof enter>;
        try { child = enter(original); }
        catch (error) {
            if (!isRankArray(node.source) || !(error instanceof MissingValueError) || !error.soft) throw error;
            child = { value: MISSING };
        }
        if (child.value !== original) { node.changed = true; node.nestedChanged = true; }
        node.aggregate.values[index] = child.value;
        if (child.node) {
            node.children.set(index, child.node);
            child.node.parents.push(node);
        }
    }
    if (!root.node) return root.value;

    // Propagate changed descendants through shared references, including cycles.
    const changed = nodes.filter(node => node.changed);
    for (let index = 0; index < changed.length; index++) {
        for (const parent of changed[index].parents) {
            parent.nestedChanged = true;
            if (!parent.changed) { parent.changed = true; changed.push(parent); }
        }
    }
    for (const node of nodes) {
        if (!node.changed) node.result = node.source;
        else if (node.aggregate.create) node.result = node.aggregate.create();
    }
    const valuesOf = (node: Completion): RankValue[] => {
        for (const [index, child] of node.children) node.aggregate.values[index] = child.result!;
        return node.aggregate.values;
    };
    // Immutable arrays/tuples can point to mutable shells. Only cycles consisting
    // entirely of structural values are invalid, as in their binding contracts.
    const active = new Set<Completion>();
    for (const node of nodes) {
        if (node.result !== undefined) continue;
        const stack = [{ node, leaving: false }];
        while (stack.length) {
            checkpoint('materializing binding');
            const frame = stack.pop()!;
            if (frame.node.result !== undefined) continue;
            if (frame.leaving) {
                frame.node.result = frame.node.aggregate.finish(valuesOf(frame.node), undefined, frame.node.nestedChanged);
                active.delete(frame.node);
                continue;
            }
            if (active.has(frame.node)) throw new RankError('cyclic structural values cannot be materialized', 'TypeError');
            active.add(frame.node);
            stack.push({ node: frame.node, leaving: true });
            for (const child of [...frame.node.children.values()].reverse()) {
                if (child.result === undefined) stack.push({ node: child, leaving: false });
            }
        }
    }
    // Populate maps/records before collections validate their element schemas.
    for (const phase of [0, 1]) for (const node of nodes) {
        if (!node.changed || !node.aggregate.create || (node.aggregate.phase ?? 0) !== phase) continue;
        checkpoint('materializing binding');
        node.aggregate.finish(valuesOf(node), node.result);
    }
    for (const node of nodes) {
        if (!node.changed || !isRankRecord(node.source) || !isRankRecord(node.result!)) continue;
        const result = node.result! as RankRecord;
        recordContract(result);
        for (const [name, contract] of node.source.fieldContracts ?? []) {
            if (result.entries.get(name) === node.source.entries.get(name)) result.fieldContracts!.set(name, contract);
        }
    }
    for (const node of nodes) {
        if (!node.changed || !isRankTable(node.result!)) continue;
        for (const column of node.result!.columns) {
            if (column.cells) checkColumnValues(column.name, column.cells);
        }
    }
    return root.node.result!;
}

/** Complete a write batch before publishing any cell, preserving sharing between
 * its values. Ready batches need no temporary aggregate or extra copies. */
export function materializeValues(values: readonly RankValue[]): readonly RankValue[] {
    if (values.every(isStoredValue)) return values;
    return (materializeValue(tuple(values)) as RankTuple).items;
}

function aggregateValue(value: RankValue): Aggregate | undefined {
    if (isRankGroupedTable(value)) return { values: [...groupedTableValues(value)], finish: values => {
        let index = 0;
        const next = () => values[index++];
        const rollingSource = value.rollingSource ? next() as typeof value.rollingSource : undefined;
        const table = value.columnar ? next() as RankArrowTable : undefined;
        const keys = (values: readonly (RankValue | undefined)[]) => values.map(value => value === undefined ? undefined : next());
        const groups = value.groups.map(group => ({ keys: keys(group.keys),
            rows: group.rows.map(() => next() as typeof group.rows[number]) }));
        const columnar = value.columnar ? { table: table!, groups: value.columnar.groups.map(group =>
            ({ ...group, keys: keys(group.keys) })) } : undefined;
        return ownedGroupedTable({ ...value, groups, rollingSource, columnar });
    } };
    if (isRankTableAlias(value)) return { values: [value.source],
        finish: ([source]) => ({ ...value, source: source as typeof value.source }) };
    if (isRankTable(value)) {
        const starts = new Map<number, number>();
        const cells: RankValue[] = [];
        value.columns.forEach((column, index) => {
            if (!column.cells) return;
            starts.set(index, cells.length);
            for (const cell of column.cells) {
                checkpoint('materializing binding');
                cells.push(cell ?? MISSING);
            }
        });
        return { values: cells, finish: values => {
            const columns = value.columns.map((column, index) => {
                const start = starts.get(index);
                if (start === undefined) return column;
                let cells: (RankValue | undefined)[] | undefined;
                column.cells!.forEach((original, row) => {
                    checkpoint('materializing binding');
                    const cell = values[start + row] === MISSING ? undefined : values[start + row];
                    if (cell === original) return;
                    cells ??= [...column.cells!];
                    cells[row] = cell;
                });
                if (!cells) return column;
                // Structural cells can reference empty mutable shells here.
                // Validate their schemas after the graph is fully populated.
                return cells.every(cell => typeof cell !== 'object')
                    ? columnFromValues(column.name, cells, column.kind)
                    : { name: column.name, kind: 'values' as const, cells };
            });
            const result = new RankArrowTable(value.length, columns);
            result.sortKeys = value.sortKeys;
            return result;
        } };
    }
    if (isRankArray(value)) {
        if (value.kind === 'bytes' || denseScalarItems(value) !== undefined) return undefined;
        const size = value.shape.reduce((product, dimension) => product * dimension, 1);
        const cells = materializeCells(size, index => { checkpoint('materializing binding'); return readArrayItem(value, index); });
        return { values: cells, force: true, finish: (values, _, nestedChanged) => {
            const result = ownedArray(values, value.shape, false, value.columnNames, {
                tableScopes: value.tableScopes, sortKeys: value.sortKeys,
            });
            return nestedChanged ? result : inheritSemanticArrayType(value, result);
        } };
    }
    if (isRankTuple(value)) return { values: [...value.items], finish: tuple };
    if (isRankRecord(value)) {
        const keys = [...value.entries.keys()];
        return { values: [...value.entries.values()], create: () => {
            const entries = new ResourceMap<RankValue>(value => value);
            return entries.resources.track({ kind: 'record', entries, types: new Map() } as RankRecord);
        }, finish: (values, shell) => {
            const record = shell as RankRecord;
            keys.forEach((name, index) => { record.entries.set(name, values[index]); record.types.set(name, typeName(values[index])); });
            return record;
        } };
    }
    if (isRankObject(value) || isRankIndex(value)) {
        const entries = [...value.entries];
        return { values: entries.map(([, value]) => value),
            create: () => isRankObject(value) ? ownedObject([]) : newStructure('index'),
            finish: (values, shell) => {
                if (isRankObject(shell!)) entries.forEach(([key], index) => shell.entries.set(String(key), values[index]));
                else if (isRankIndex(shell!)) entries.forEach(([key], index) => shell.entries.set(key, values[index]));
                return shell!;
            } };
    }
    if (isRankQueue(value)) return { values: [...value.items], phase: 1,
        create: () => new RankDeque(value instanceof RankDeque ? value.mode : 'queue'),
        finish: (values, shell) => { values.forEach(value => pushCollection(shell!, value)); return shell!; } };
    if (value instanceof RankHeap) return { values: [...value.values()], phase: 1,
        create: () => new RankHeap(value.descending),
        finish: (values, shell) => (shell as RankHeap).copyValuesFrom(value, values) };
    if (isRankSet(value)) return { values: [...value.entries.values()], phase: 1,
        create: () => newStructure('set'),
        finish: (values, shell) => { values.forEach(value => addToCollection(shell!, value)); return shell!; } };
    if (isRankCounter(value)) {
        const entries = [...value.entries.values()];
        return { values: entries.map(entry => entry.value), phase: 1, create: () => newStructure('counter'),
            finish: (values, shell) => {
                const counter = shell as RankCounter;
                values.forEach((value, index) => {
                    counter.elementType = checkCollectionElementType('counter', counter.elementType, value);
                    const key = setValueKey(value);
                    const previous = counter.entries.get(key);
                    if (previous) previous.count += entries[index].count;
                    else counter.entries.set(key, { value, count: entries[index].count });
                });
                return counter;
            } };
    }
    if (isRankMultiset(value)) return { values: [...value.values()], phase: 1,
        create: () => new RankMultiset(value.unique),
        finish: (values, shell) => { values.forEach(value => (shell as RankMultiset).add(value)); return shell!; } };
    return undefined;
}

/** Parameter modes apply before specialization, memo lookup or body execution.
 * Keep the original argument vector when no value changes: ownership transfers
 * and diagnostic summaries use its identity. */
export function materializeArguments(parameters: readonly CallParameter[], arguments_: RankValue[]): RankValue[] {
    let bound = arguments_;
    for (const parameter of parameters) {
        const value = arguments_[parameter.index];
        if (parameter.deferred || value === undefined) continue;
        const computed = materializeValue(value);
        if (computed === value) continue;
        if (bound === arguments_) bound = [...arguments_];
        bound[parameter.index] = computed;
    }
    return bound;
}
