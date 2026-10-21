import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray, type RankGroupedTable, type RankIndex, type RankValue } from '../src/index.js';
import { RankArrowTable, columnFromValues } from '../src/arrow-table.js';
import { derivedArray, ownedArray, ownedObject } from '../src/array-storage.js';
import { newStructure } from '../src/collections.js';
import { completed } from '../src/execution.js';
import { ownedGroupedTable, rollingTable } from '../src/grouped-table.js';
import { materializeValue } from '../src/materialize.js';
import { type RankPlan } from '../src/plan.js';
import { isStoredValue } from '../src/stored-value.js';

const plan = (compute: () => RankValue): RankPlan => ({
    kind: 'plan', dependencies: new Map(), evaluate: () => completed(compute()),
});

it('completes shared rows once across rollup groups and preserves absent subtotal keys', () => {
    let calls = 0;
    const row = ownedObject([['id', 1n], ['value', plan(() => { calls++; return 4n; })]]);
    const source = ownedGroupedTable({ fields: ['id'], rollup: true, groups: [
        { keys: [1n], rows: [row] }, { keys: [undefined], rows: [row] },
    ] });
    expect(isStoredValue(source)).toBe(false);
    const ready = materializeValue(source) as RankGroupedTable;
    expect(calls).toBe(1);
    expect(ready.rollup).toBe(true);
    expect(ready.groups.map(group => group.keys)).toEqual([[1n], [undefined]]);
    expect(ready.groups[0].rows[0]).toBe(ready.groups[1].rows[0]);
    expect(ready.groups[0].rows[0].entries.get('value')).toBe(4n);
    expect(row.entries.get('value')).toHaveProperty('kind', 'plan');
    materializeValue(source);
    expect(calls).toBe(2);
});

it('completes a columnar grouping without constructing object rows or losing row positions', () => {
    const ids = columnFromValues('id', [1n, 1n]);
    const table = new RankArrowTable(2, [ids, { name: 'value', kind: 'values',
        cells: [plan(() => 2n), plan(() => 3n)] }]);
    const positions = [0, 1];
    const source = ownedGroupedTable({ fields: ['id'], groups: [],
        columnar: { table, groups: [{ keys: [1n], rows: positions }] } });
    const ready = materializeValue(source) as RankGroupedTable;
    expect(ready.groups).toEqual([]);
    expect(ready.columnar!.table).toBeInstanceOf(RankArrowTable);
    expect(ready.columnar!.table.columns[0]).toBe(ids);
    expect(ready.columnar!.groups[0].rows).toBe(positions);
    expect(ready.columnar!.table.columnArray('value').items).toEqual([2n, 3n]);
});

it('completes a rolling input before retention and does not repeat its reads through a ready binding', () => {
    let reads = 0;
    const rows = derivedArray([3], [], index => { reads++; return ownedObject([['id', BigInt(index + 1)]]); });
    const source = ownedGroupedTable({ fields: ['id'], groups: [],
        rolling: { width: 2, field: 'id' }, rollingSource: rows });
    const ready = materializeValue(source) as RankGroupedTable;
    expect(reads).toBe(3);
    expect(ready.rolling).toEqual(source.rolling);
    expect(ready.rollingSource!.itemAt).toBeUndefined();
    expect(materializeValue(ready)).toBe(ready);
    expect(reads).toBe(3);
});

it('owns sorted rolling rows instead of retaining writable source row fields', () => {
    const first = ownedObject([['id', 2n], ['value', 3n]]);
    const second = ownedObject([['id', 1n], ['value', 4n]]);
    const source = ownedArray([first, second]);
    const ready = materializeValue(rollingTable(source, 2n, 'id')) as RankGroupedTable;
    first.entries.set('value', 99n);
    expect((ready.rollingSource!.items[1] as typeof first).entries.get('value')).toBe(3n);
    expect((ready.rollingSource!.items[0] as typeof first).entries.get('value')).toBe(4n);
});

it('invalidates grouping storage evidence after a nested mutable value receives a plan', () => {
    const row = ownedObject([['value', 1n]]);
    const source = ownedGroupedTable({ fields: [], groups: [{ keys: [], rows: [row] }] });
    expect(isStoredValue(source)).toBe(true);
    row.entries.set('value', plan(() => 7n));
    expect(isStoredValue(source)).toBe(false);
    expect((materializeValue(source) as RankGroupedTable).groups[0].rows[0].entries.get('value')).toBe(7n);
});

it('publishes no partially completed group on failure and recomputes on retry', () => {
    let fail = true;
    let calls = 0;
    const row = ownedObject([['value', plan(() => { calls++; if (fail) throw new Error('group failed'); return 9n; })]]);
    const source = ownedGroupedTable({ fields: [], groups: [{ keys: [], rows: [row] }] });
    expect(() => materializeValue(source)).toThrowError('group failed');
    expect(source.groups[0].rows[0]).toBe(row);
    expect(row.entries.get('value')).toHaveProperty('kind', 'plan');
    fail = false;
    expect((materializeValue(source) as RankGroupedTable).groups[0].rows[0].entries.get('value')).toBe(9n);
    expect(calls).toBe(2);
});

describe.each([false, true])('grouped binding completion (compilation=%s)', compilation => {
    it.each(['', "'"])('applies binding and parameter modes to grouped values: %s', marker => {
        let calls = 0;
        const row = ownedObject([['value', plan(() => { calls++; return 7n; })]]);
        const source = ownedGroupedTable({ fields: [], groups: [{ keys: [], rows: [row] }] });
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source);
        try {
            runtime.execute(`Saved${marker} = Input`);
            expect(calls).toBe(marker ? 0 : 1);
            runtime.execute(`fun X${marker} ignore = 11`);
            expect(runtime.execute('Input ignore')).toBe(11n);
            expect(calls).toBe(marker ? 0 : 2);
        } finally { runtime.dispose(); }
    });

    it.each(['group by .id', 'rollup by .id', '2 rolling by .id'])(
        'recomputes a native grouping on each explicit demand: %s', operation => {
            let reads = 0;
            const rows: RankArray = { kind: 'array', shape: [3], items: [], itemAt(index) {
                reads++;
                return ownedObject([['id', BigInt(index + 1)], ['value', 2n]]);
            } };
            const runtime = new Interpreter(undefined, { compilation });
            runtime.variables.set('Input', rows);
            try {
                runtime.execute(`use tables\nGroups' = Input ${operation}`);
                expect(reads).toBe(0);
                runtime.execute('First = Groups');
                expect(reads).toBe(3);
                runtime.execute('Second = Groups');
                expect(reads).toBe(6);
                runtime.execute('Again = First');
                expect(reads).toBe(6);
            } finally { runtime.dispose(); }
        },
    );

    it('protects shared row contents through aliases after capture', () => {
        const nested = newStructure('index') as RankIndex;
        nested.entries.set('value', 1n);
        const row = ownedObject([['nested', nested]]);
        const source = ownedGroupedTable({ fields: [], groups: [{ keys: [], rows: [row] }] });
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source);
        runtime.variables.set('Alias', nested);
        try {
            runtime.execute("Saved' = Input");
            expect(() => runtime.execute('Alias "value" = 2')).toThrowError('read-only');
            expect(nested.entries.get('value')).toBe(1n);
        } finally { runtime.dispose(); }
    });
});
