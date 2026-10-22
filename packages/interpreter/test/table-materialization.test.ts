import { describe, expect, it } from 'vitest';
import { Interpreter, MISSING, type RankArray, type RankIndex, type RankObject, type RankRecord, type RankTableAlias, type RankValue } from '../src/index.js';
import { RankArrowTable, columnFromValues } from '../src/arrow-table.js';
import { ownedArray, ownedObject } from '../src/array-storage.js';
import { newStructure } from '../src/collections.js';
import { completed } from '../src/execution.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { materializeValue } from '../src/materialize.js';
import { type RankPlan } from '../src/plan.js';
import { sequence } from '../src/sequence.js';
import { isStoredValue } from '../src/stored-value.js';

const plan = (compute: () => RankValue): RankPlan => ({
    kind: 'plan', dependencies: new Map(), evaluate: () => completed(compute()),
});

it('keeps proven scalar tables and their native columns after unrelated deferred storage', () => {
    const table = new RankArrowTable(2, [columnFromValues('id', [1n, undefined]),
        columnFromValues('large', [1n << 100n, 2n])]);
    const container = newStructure('index') as RankIndex;
    container.entries.set('later', plan(() => 3n));
    expect(isStoredValue(table)).toBe(true);
    expect(materializeValue(table)).toBe(table);
    expect(materializeValue(new RankArrowTable(0, []))).toBeInstanceOf(RankArrowTable);
});

it('completes shared nested table cells without changing ready columns, gaps or ordering metadata', () => {
    let calls = 0;
    const child = ownedObject([['value', plan(() => { calls++; return 7n; })]]);
    const id = columnFromValues('id', [1n, 2n, 3n]);
    const table = new RankArrowTable(3, [id, { name: 'payload', kind: 'values', cells: [child, undefined, child] }]);
    table.sortKeys = [[1n], [2n], [3n]];
    const result = materializeValue(table) as RankArrowTable;
    expect(calls).toBe(1);
    expect(result).not.toBe(table);
    expect(result.names).toEqual(['id', 'payload']);
    expect(result.length).toBe(3);
    expect(result.columns[0]).toBe(id);
    expect(result.sortKeys).toBe(table.sortKeys);
    expect(result.cell(0, 1)).toBe(result.cell(2, 1));
    expect(result.cell(1, 1)).toBeUndefined();
    expect((result.cell(0, 1) as RankObject).entries.get('value')).toBe(7n);
    expect(child.entries.get('value')).toHaveProperty('kind', 'plan');
    materializeValue(table);
    expect(calls).toBe(2);
});

it('stores completed scalar columns in their native representation and preserves absent cells', () => {
    const table = new RankArrowTable(3, [{ name: 'value', kind: 'values',
        cells: [plan(() => 3n), undefined, plan(() => 5n)] }]);
    const result = materializeValue(table) as RankArrowTable;
    expect(result.columns[0].kind).toBe('integer');
    expect(result.columns[0].vector!.nullCount).toBe(1);
    expect([result.cell(0, 0), result.cell(1, 0), result.cell(2, 0)]).toEqual([3n, undefined, 5n]);
    expect(isStoredValue(result)).toBe(true);
});

it('turns a completed missing cell into an absent field beside nested values', () => {
    const table = new RankArrowTable(2, [{ name: 'payload', kind: 'values', cells: [
        plan(() => ownedObject([['value', 1n]])), plan(() => MISSING),
    ] }]);
    const ready = materializeValue(table) as RankArrowTable;
    expect(ready.cell(1, 0)).toBeUndefined();
    expect((ready.toRows().items[1] as RankObject).entries.has('payload')).toBe(false);
});

it('invalidates table storage evidence when a shared nested value receives a plan', () => {
    const child = ownedObject([['value', 1n]]);
    const table = new RankArrowTable(1, [{ name: 'payload', kind: 'values', cells: [child] }]);
    expect(isStoredValue(table)).toBe(true);
    child.entries.set('value', plan(() => 9n));
    expect(isStoredValue(table)).toBe(false);
    const result = materializeValue(table) as RankArrowTable;
    expect((result.cell(0, 0) as RankObject).entries.get('value')).toBe(9n);
    expect(child.entries.get('value')).toHaveProperty('kind', 'plan');
});

it('leaves the original table unchanged after failure and recomputes on retry', () => {
    let fail = true;
    let calls = 0;
    const deferred = plan(() => { calls++; if (fail) throw new Error('cell failed'); return 4n; });
    const column = { name: 'value', kind: 'values' as const, cells: [deferred] };
    const table = new RankArrowTable(1, [column]);
    expect(() => materializeValue(table)).toThrowError('cell failed');
    expect(table.columns[0]).toBe(column);
    expect(table.cell(0, 0)).toBe(deferred);
    fail = false;
    expect((materializeValue(table) as RankArrowTable).cell(0, 0)).toBe(4n);
    expect(calls).toBe(2);
});

it('checks completed nested record schemas after populating their fields', () => {
    const record = (value: RankValue): RankRecord => ({ kind: 'record',
        entries: new Map([['value', value]]), types: new Map([['value', 'plan']]) });
    const first = record(plan(() => 1n));
    const second = record(plan(() => 'wrong'));
    const table = new RankArrowTable(2, [{ name: 'payload', kind: 'values', cells: [first, second] }]);
    expect(() => materializeValue(table)).toThrowError('table column .payload .value');
    expect(first.entries.get('value')).toHaveProperty('kind', 'plan');
    expect(second.entries.get('value')).toHaveProperty('kind', 'plan');
});

it('rejects an infinite nested table cell without consuming it', () => {
    let entered = false;
    const infinite = sequence({ name: 'infinite cell', size: { kind: 'infinite' },
        *iterate() { entered = true; while (true) yield 1n; } });
    const table = new RankArrowTable(1, [{ name: 'value', kind: 'values', cells: [infinite] }]);
    expect(() => materializeValue(table)).toThrowError(/infinite/);
    expect(entered).toBe(false);
});

it('cancels table completion atomically and recomputes its cells on retry', () => {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    let calls = 0;
    const deferred = plan(() => { calls++; if (calls === 1) Atomics.store(signal, 0, 1); return 6n; });
    const cells = Array(2048).fill(deferred);
    const table = new RankArrowTable(cells.length, [{ name: 'value', kind: 'values', cells }]);
    expect(() => withInterrupt(signal, () => materializeValue(table))).toThrow(InterruptedError);
    const before = calls;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(cells.length);
    expect(table.columns[0].cells).toBe(cells);
    expect(cells.every(value => value === deferred)).toBe(true);
    Atomics.store(signal, 0, 0);
    const ready = materializeValue(table) as RankArrowTable;
    expect(ready.cell(0, 0)).toBe(6n);
    expect(ready.cell(cells.length - 1, 0)).toBe(6n);
    expect(calls).toBe(before + cells.length);
});

it('completes a deep native table graph without using the host call stack', () => {
    let source: RankValue = plan(() => 5n);
    for (let depth = 0; depth < 2048; depth++) {
        source = new RankArrowTable(1, [{ name: 'next', kind: 'values', cells: [source] }]);
    }
    let ready = materializeValue(source);
    for (let depth = 0; depth < 2048; depth++) ready = (ready as RankArrowTable).cell(0, 0)!;
    expect(ready).toBe(5n);
});

it('completes an aliased source while preserving its role and nested schema', () => {
    const row = ownedObject([['id', 1n]]);
    const source = ownedArray([plan(() => row)]);
    const alias: RankTableAlias = { kind: 'table-alias', name: 'role', source };
    const ready = materializeValue(alias) as RankTableAlias;
    expect(ready.name).toBe('role');
    expect(ready.source.kind).toBe('array');
    expect((ready.source as RankArray).items).toEqual([row]);
    expect(source.items[0]).toHaveProperty('kind', 'plan');
    expect(isStoredValue(ready)).toBe(true);
});

describe.each([false, true])('table binding completion (compilation=%s)', compilation => {
    it.each(['', "'"])('applies binding mode to nested native table values: %s', marker => {
        let calls = 0;
        const table = new RankArrowTable(1, [{ name: 'value', kind: 'values',
            cells: [plan(() => { calls++; return 8n; })] }]);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', table);
        try {
            runtime.execute(`Saved${marker} = Input`);
            expect(calls).toBe(marker ? 0 : 1);
            const saved = runtime.variables.get('Saved') as RankArrowTable;
            expect(saved).toBeInstanceOf(RankArrowTable);
            expect(saved.cell(0, 0)).toEqual(marker ? table.cell(0, 0) : 8n);
            runtime.execute('Ready = Saved');
            expect(calls).toBe(1);
            expect(runtime.variables.get('Ready')).toBeInstanceOf(RankArrowTable);
        } finally { runtime.dispose(); }
    });

    it.each(['', "'"])('completes ordinary parameters before entering the body: %s', marker => {
        let calls = 0;
        const table = new RankArrowTable(1, [{ name: 'value', kind: 'values',
            cells: [plan(() => { calls++; return 8n; })] }]);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', table);
        try {
            runtime.execute(`fun X${marker} ignore = 11`);
            expect(runtime.execute('Input ignore')).toBe(11n);
            expect(calls).toBe(marker ? 0 : 1);
        } finally { runtime.dispose(); }
    });

    it('protects shared mutable cells through every alias and completes into an independent record', () => {
        const child: RankRecord = { kind: 'record', entries: new Map([['value', plan(() => 8n)]]),
            types: new Map([['value', 'plan']]) };
        const table = new RankArrowTable(1, [{ name: 'payload', kind: 'values', cells: [child] }]);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', table);
        runtime.variables.set('Alias', child);
        try {
            runtime.execute("Saved' = Input");
            expect(() => runtime.execute('Alias .value = 2')).toThrowError('read-only');
            runtime.execute('Ready = Saved');
            const ready = runtime.variables.get('Ready') as RankArrowTable;
            const record = ready.cell(0, 0) as RankRecord;
            expect(record).not.toBe(child);
            expect(record.entries.get('value')).toBe(8n);
            runtime.variables.set('ReadyCell', record);
            runtime.execute('ReadyCell .value = 2');
            expect(record.entries.get('value')).toBe(2n);
            expect(() => runtime.execute('ReadyCell .value = "wrong"')).toThrowError('record field');
        } finally { runtime.dispose(); }
    });
});
