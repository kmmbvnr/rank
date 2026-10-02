import { describe, expect, it } from 'vitest';
import type { RankIo } from '@arrrank/interpreter';
import { createReplSession } from '../src/repl-session.js';
import type { InspectedValue, Inspection } from '../src/value-inspection.js';
import { buildValueView } from '../src/value-view.js';

/** Runs `cells` as numbered cells and returns the session with the last cell's reference. */
async function run(cells: string[], io?: Partial<RankIo>) {
    const session = createReplSession(io ? { options: { io: io as RankIo } } : {});
    let last: Awaited<ReturnType<typeof session.execute>> | undefined;
    for (const [id, source] of cells.entries()) last = await session.execute(source, id, []);
    return { session, last: last!, ref: last!.valueRef! };
}

function opened(inspection: Inspection): InspectedValue {
    expect(inspection.status).toBe('ok');
    const { status: _status, ...value } = inspection as Extract<Inspection, { status: 'ok' }>;
    return value;
}

const texts = (cells: readonly (readonly { text: string }[])[]) => cells.map(row => row.map(cell => cell.text));

describe('value references', () => {
    it('tags the lines of a result and the execution with one reference', async () => {
        const { last, ref } = await run(['Values = 1 to 3', 'Values']);
        expect(typeof ref).toBe('number');
        expect(last.output.length).toBeGreaterThan(0);
        expect(last.output.every(line => line.ref === ref)).toBe(true);
    });

    it('gives a cell with no result no reference', async () => {
        const { last } = await run(['use sequences']);
        expect(last.valueRef).toBeUndefined();
        expect(last.output).toEqual([]);
    });

    it('goes stale when the cell reruns, and the new run has its own reference', async () => {
        const { session, ref } = await run(['Count = 1', 'Count + 1']);
        expect(opened(session.inspect(ref))).toMatchObject({ kind: 'scalar', text: '2' });
        const again = await session.execute('Count + 5', 1, []);
        expect(session.inspect(ref)).toEqual({ status: 'stale' });
        expect(opened(session.inspect(again.valueRef!))).toMatchObject({ kind: 'scalar', text: '6' });
    });

    it('goes stale for a cell that reruns into an error', async () => {
        const { session, ref } = await run(['Count = 1', 'Count + 1']);
        await session.execute('Missing', 1, []);
        expect(session.inspect(ref)).toEqual({ status: 'stale' });
    });

    it('goes stale when the document restarts', async () => {
        const { session, ref } = await run(['Count = 1', 'Count + 1']);
        session.resetExecution();
        expect(session.inspect(ref)).toEqual({ status: 'stale' });
        await session.execute('Count = 1', 0, []);
        const fresh = await session.execute('Count + 1', 1, []);
        expect(fresh.valueRef).not.toBe(ref);
        expect(session.inspect(ref)).toEqual({ status: 'stale' });
    });

    it('goes stale when load replaces the document', async () => {
        const { session, ref } = await run(['Count = 1', 'Count + 1']);
        session.replaceFile({ path: 'other.ra', source: 'Other = 1\n' });
        expect(session.inspect(ref)).toEqual({ status: 'stale' });
    });

    it('goes stale for cells at and after a rewind, and keeps earlier ones', async () => {
        const { session } = await run(['One = 1', 'One + 1', 'One + 2']);
        const early = await session.execute('One + 10', 1, []);
        const late = await session.execute('One + 20', 2, []);
        session.rewind(2);
        expect(session.inspect(early.valueRef!).status).toBe('ok');
        expect(session.inspect(late.valueRef!)).toEqual({ status: 'stale' });
    });

    it('answers stale for a reference that never existed', async () => {
        const { session } = await run(['1']);
        expect(session.inspect(9999)).toEqual({ status: 'stale' });
    });
});

describe('inspect: arrays', () => {
    it('reads a 3 by 4 array in full', async () => {
        const { session, ref } = await run(['use sequences', 'M = (1 to 12) (array 3 4) reshape', 'M']);
        const value = opened(session.inspect(ref));
        expect(value).toMatchObject({ kind: 'array', shape: [3, 4], fixed: [] });
        if (value.kind !== 'array') throw new Error('expected an array');
        expect(value.axes).toEqual([{ length: 3, offset: 0, count: 3 }, { length: 4, offset: 0, count: 4 }]);
        expect(texts(value.cells)).toEqual([['1', '2', '3', '4'], ['5', '6', '7', '8'], ['9', '10', '11', '12']]);
        expect(value.cells[0][0]).toEqual({ text: '1', type: 'integer' });
    });

    it('reads a window with an offset and a count on each axis', async () => {
        const { session, ref } = await run(['use sequences', 'M = (1 to 12) (array 3 4) reshape', 'M']);
        const value = opened(session.inspect(ref, { offset: [1, 2], count: [2, 2] }));
        if (value.kind !== 'array') throw new Error('expected an array');
        expect(value.axes).toEqual([{ length: 3, offset: 1, count: 2 }, { length: 4, offset: 2, count: 2 }]);
        expect(texts(value.cells)).toEqual([['7', '8'], ['11', '12']]);
    });

    it('clamps a window that runs past the edge, and an offset that starts beyond it', async () => {
        const { session, ref } = await run(['use sequences', 'M = (1 to 12) (array 3 4) reshape', 'M']);
        const past = opened(session.inspect(ref, { offset: [2, 3], count: [50, 50] }));
        if (past.kind !== 'array') throw new Error('expected an array');
        expect(texts(past.cells)).toEqual([['12']]);
        const beyond = opened(session.inspect(ref, { offset: [99, 99], count: [1, 1] }));
        if (beyond.kind !== 'array') throw new Error('expected an array');
        expect(beyond.axes[0].offset).toBe(2);
        expect(texts(beyond.cells)).toEqual([['12']]);
    });

    it('pages a vector as one cell per row', async () => {
        const { session, ref } = await run(['use sequences', 'V = (1 to 100) (array 100) reshape', 'V']);
        const value = opened(session.inspect(ref, { offset: [10], count: [3] }));
        if (value.kind !== 'array') throw new Error('expected an array');
        expect(value.axes).toEqual([{ length: 100, offset: 10, count: 3 }]);
        expect(texts(value.cells)).toEqual([['11'], ['12'], ['13']]);
    });

    it('defaults to a bounded window rather than the whole array', async () => {
        const { session, ref } = await run(['use sequences', 'V = (1 to 5000) (array 5000) reshape', 'V']);
        const value = opened(session.inspect(ref));
        if (value.kind !== 'array') throw new Error('expected an array');
        expect(value.cells).toHaveLength(20);
        expect(opened(session.inspect(ref, { count: [1_000_000] })) as { cells: unknown[] }).toMatchObject({ cells: expect.any(Array) });
        expect((opened(session.inspect(ref, { count: [1_000_000] })) as { cells: unknown[] }).cells).toHaveLength(1000);
    });

    it('slices a 3-D array over its leading axis', async () => {
        const { session, ref } = await run(['use sequences', 'T = (1 to 24) (array 2 3 4) reshape', 'T']);
        const first = opened(session.inspect(ref));
        const second = opened(session.inspect(ref, { fixed: [1] }));
        if (first.kind !== 'array' || second.kind !== 'array') throw new Error('expected arrays');
        expect(first).toMatchObject({ shape: [2, 3, 4], fixed: [0] });
        expect(texts(first.cells)[0]).toEqual(['1', '2', '3', '4']);
        expect(second.fixed).toEqual([1]);
        expect(texts(second.cells)).toEqual([['13', '14', '15', '16'], ['17', '18', '19', '20'], ['21', '22', '23', '24']]);
    });

    it('slices a 4-D array over two leading axes and clamps an index out of range', async () => {
        const { session, ref } = await run(['use sequences', 'T = (1 to 16) (array 2 2 2 2) reshape', 'T']);
        const value = opened(session.inspect(ref, { fixed: [1, 0] }));
        if (value.kind !== 'array') throw new Error('expected an array');
        expect(texts(value.cells)).toEqual([['9', '10'], ['11', '12']]);
        const clamped = opened(session.inspect(ref, { fixed: [7, 7] }));
        if (clamped.kind !== 'array') throw new Error('expected an array');
        expect(clamped.fixed).toEqual([1, 1]);
        expect(texts(clamped.cells)).toEqual([['13', '14'], ['15', '16']]);
    });

    it('types each cell and quotes nothing it cannot read', async () => {
        const { session, ref } = await run(['Mixed = array 1 2.5 "a" true', 'Mixed']);
        const value = opened(session.inspect(ref));
        if (value.kind !== 'array') throw new Error('expected an array');
        expect(value.cells.flat().map(cell => cell.type)).toEqual(['integer', 'real', 'text', 'boolean']);
    });
});

describe('inspect: tables', () => {
    const csv = (text: string) => ({ read: () => new TextEncoder().encode(text) });

    it('keeps the column names and reads a window of rows and columns', async () => {
        const { session, ref } = await run(
            ['use tables', 'T = "/in.csv" csv', 'T'],
            csv('id,name,cost\n1,A,10\n2,B,20\n3,C,30\n'),
        );
        const whole = opened(session.inspect(ref));
        expect(whole).toMatchObject({ kind: 'table', shape: [3, 3], columns: ['id', 'name', 'cost'] });
        if (whole.kind !== 'table') throw new Error('expected a table');
        expect(texts(whole.cells)).toEqual([['1', 'A', '10'], ['2', 'B', '20'], ['3', 'C', '30']]);
        const window = opened(session.inspect(ref, { offset: [1, 1], count: [1, 2] }));
        if (window.kind !== 'table') throw new Error('expected a table');
        expect(window.columns).toEqual(['name', 'cost']);
        expect(texts(window.cells)).toEqual([['B', '20']]);
    });

    it('shows an empty cell as missing', async () => {
        const { session, ref } = await run(['use tables', 'T = "/in.csv" csv', 'T'], csv('id,name\n1,A\n2,\n'));
        const value = opened(session.inspect(ref));
        if (value.kind !== 'table') throw new Error('expected a table');
        expect(value.cells[1][1]).toEqual({ text: '.NA', type: 'missing' });
    });
});

describe('inspect: sequences', () => {
    it('reports an unbounded sequence without reading any of it', async () => {
        const { session, ref } = await run(['use sequences', 'Primes = primes', 'Primes']);
        const value = opened(session.inspect(ref));
        expect(value).toMatchObject({ kind: 'sequence', size: { kind: 'infinite' }, forced: 0, items: [] });
    });

    it('leaves a sequence unconsumed: it reads the same after any number of inspections', async () => {
        const { session } = await run([
            'use sequences',
            'fun upto N\n for I in 1 to N\n  yield I\n end\nend',
            'Source = 5 upto',
        ]);
        const before = await session.execute('Source', 3, []);
        for (let times = 0; times < 3; times++) session.inspect(before.valueRef!);
        const total = await session.execute('Total = 0\nfor Item in Source\n Total += Item\nend\nTotal', 4, []);
        expect(total.output.map(line => line.text)).toEqual(['15']);
    });

    it('shows the items a generator has already yielded, windowed', async () => {
        const { session } = await run(['fun upto N\n for I in 1 to N\n  yield I\n end\nend']);
        const made = await session.execute('Source = 5 upto', 1, []);
        const value = opened(session.inspect(made.valueRef!));
        if (value.kind !== 'sequence') throw new Error('expected a sequence');
        expect(value).toMatchObject({ forced: 5, offset: 0, size: { kind: 'unknown' } });
        expect(value.items.map(item => item.text)).toEqual(['1', '2', '3', '4', '5']);
        const window = opened(session.inspect(made.valueRef!, { offset: [3], count: [10] }));
        if (window.kind !== 'sequence') throw new Error('expected a sequence');
        expect(window.items.map(item => item.text)).toEqual(['4', '5']);
    });

    it('reports a range by its exact size and invents no items', async () => {
        const { session, ref } = await run(['V = 1 to 100', 'V']);
        expect(opened(session.inspect(ref))).toMatchObject({
            kind: 'sequence', size: { kind: 'exact', value: '100' }, forced: 0, items: [] });
    });
});

describe('inspect: collections', () => {
    it('pages the fields of a record', async () => {
        const { session, ref } = await run(['A = record\n .x = 1\n .y = "two"\nend', 'A']);
        const value = opened(session.inspect(ref));
        expect(value).toMatchObject({ kind: 'entries', type: 'record', size: 2, offset: 0 });
        if (value.kind !== 'entries') throw new Error('expected entries');
        expect(value.entries.map(entry => [entry.key, entry.value.text, entry.value.type]))
            .toEqual([['x', '1', 'integer'], ['y', 'two', 'text']]);
        const second = opened(session.inspect(ref, { offset: [1], count: [5] }));
        if (second.kind !== 'entries') throw new Error('expected entries');
        expect(second.entries.map(entry => entry.key)).toEqual(['y']);
    });

    it('pages the elements of a set', async () => {
        const { session, ref } = await run(['use algo', 'S = new set\nS add 3\nS add 1\nS add 3', 'S']);
        const value = opened(session.inspect(ref));
        expect(value).toMatchObject({ kind: 'entries', type: 'set', size: 2 });
    });

    it('lists a counter with its counts', async () => {
        const { session, ref } = await run(['use algo', 'C = new counter\nC add 7\nC add 7\nC add 9', 'C']);
        const value = opened(session.inspect(ref));
        if (value.kind !== 'entries') throw new Error('expected entries');
        expect(value.entries.map(entry => [entry.key, entry.value.text])).toEqual([['7', '2'], ['9', '1']]);
    });
});

describe('inspect: scalars', () => {
    it('reports text, numbers and booleans as scalars with their type', async () => {
        const { session } = await run(['1']);
        const text = await session.execute('"hello"', 1, []);
        const real = await session.execute('2.5', 2, []);
        const flag = await session.execute('true', 3, []);
        expect(opened(session.inspect(text.valueRef!))).toEqual({ kind: 'scalar', type: 'text', text: 'hello', truncated: false });
        expect(opened(session.inspect(real.valueRef!))).toMatchObject({ kind: 'scalar', type: 'real', text: '2.5' });
        expect(opened(session.inspect(flag.valueRef!))).toMatchObject({ kind: 'scalar', type: 'boolean', text: 'true' });
    });
});

describe('value view model', () => {
    it('describes a window of a matrix with labels, a type line and scroll positions', async () => {
        const { session, ref } = await run(['use sequences', 'M = (1 to 12) (array 3 4) reshape', 'M']);
        const view = buildValueView('M', opened(session.inspect(ref, { offset: [1, 2], count: [2, 2] })));
        expect(view).toEqual({
            kind: 'grid', title: 'M', typeLine: 'array · integer · [3 4]',
            rowLabels: ['1', '2'], columnLabels: ['2', '3'], cells: [['7', '8'], ['11', '12']],
            scroll: { rows: { length: 3, offset: 1, count: 2 }, columns: { length: 4, offset: 2, count: 2 } },
            slice: [],
        });
    });

    it('records the slice over the leading axes of a 3-D array', async () => {
        const { session, ref } = await run(['use sequences', 'T = (1 to 24) (array 2 3 4) reshape', 'T']);
        const view = buildValueView('T', opened(session.inspect(ref, { fixed: [1] })));
        expect(view.kind === 'grid' && view.slice).toEqual([{ axis: 0, index: 1, length: 2 }]);
    });

    it('uses the column names of a table as labels', async () => {
        const csv = { read: () => new TextEncoder().encode('id,name\n1,A\n') };
        const { session, ref } = await run(['use tables', 'T = "/in.csv" csv', 'T'], csv);
        const view = buildValueView('T', opened(session.inspect(ref)));
        expect(view).toMatchObject({ kind: 'grid', columnLabels: ['id', 'name'], typeLine: 'table · [1 2]' });
    });

    it('claims no element type for a window of mixed cells', async () => {
        const { session, ref } = await run(['Mixed = array 1 "a"', 'Mixed']);
        expect(buildValueView('Mixed', opened(session.inspect(ref))).typeLine).toBe('array · [2]');
    });

    it('lists a record as keyed rows, and a sequence by what it has read', async () => {
        const { session, ref } = await run(['A = record\n .x = 1\nend', 'A']);
        expect(buildValueView('A', opened(session.inspect(ref)))).toMatchObject({ kind: 'list', typeLine: 'record · 1', rows: [['x', '1']] });
        const primes = await run(['use sequences', 'P = primes', 'P']);
        expect(buildValueView('P', opened(primes.session.inspect(primes.ref)))).toMatchObject({
            kind: 'list', typeLine: 'sequence · unbounded', rows: [], note: '0 read so far' });
    });

    it('shows a scalar as its text', async () => {
        const { session, ref } = await run(['40 + 2']);
        expect(buildValueView('Answer', opened(session.inspect(ref)))).toEqual({ kind: 'text', title: 'Answer', typeLine: 'integer', text: '42' });
    });
});
