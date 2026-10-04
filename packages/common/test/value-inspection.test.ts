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

    it('types each cell', async () => {
        const { session, ref } = await run(['Reals = array 1.5 2.5', 'Reals']);
        const value = opened(session.inspect(ref));
        if (value.kind !== 'array') throw new Error('expected an array');
        expect(value.cells.flat().map(cell => cell.type)).toEqual(['real', 'real']);
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
    it('shows only the front of an unbounded native sequence', async () => {
        const { session, ref } = await run(['use sequences', 'Primes = primes', 'Primes']);
        const value = opened(session.inspect(ref));
        expect(value).toMatchObject({ kind: 'sequence', size: { kind: 'infinite' }, forced: 100 });
        if (value.kind !== 'sequence') throw new Error('expected a sequence');
        expect(value.items.slice(0, 4).map(item => item.text)).toEqual(['2', '3', '5', '7']);
        expect(value.finished).toBeUndefined();
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

    it('shows the front of a range with its exact size, however long it is', async () => {
        const { session, ref } = await run(['V = 1 to 10000000000000', 'V']);
        const value = opened(session.inspect(ref, { count: [3] }));
        expect(value).toMatchObject({ kind: 'sequence', size: { kind: 'exact', value: '10000000000000' }, forced: 100 });
        if (value.kind !== 'sequence') throw new Error('expected a sequence');
        expect(value.items.map(item => item.text)).toEqual(['1', '2', '3']);
    });

    it('shows the front of a computed sequence', async () => {
        const { session, ref } = await run(['N = 1 to 10000000000000', 'N mod 3 equal 0 or N mod 5 equal 0']);
        const value = opened(session.inspect(ref, { count: [4] }));
        if (value.kind !== 'sequence') throw new Error('expected a sequence');
        expect(value.items.map(item => item.text)).toEqual(['false', 'false', 'true', 'false']);
    });
});

describe('reading ahead of a sequence', () => {
    const every = ['fun stream\n for I in 1 to 1000000000\n  yield I * 2\n end\nend'];
    const forced = (session: Awaited<ReturnType<typeof run>>['session'], ref: number) => {
        const value = opened(session.inspect(ref, { count: [1000] }));
        if (value.kind !== 'sequence') throw new Error('expected a sequence');
        return value;
    };

    it('reads more of an endless generator, a bounded number at a time', async () => {
        const { session } = await run(every);
        const made = await session.execute('N = stream', 2, []);
        const before = forced(session, made.valueRef!).forced;
        const more = session.extend(made.valueRef!, 50);
        expect(more).toMatchObject({ status: 'ok', added: 50, finished: false });
        const after = forced(session, made.valueRef!);
        expect(after.forced).toBe(before + 50);
        expect(after.finished).toBe(false);
        expect(after.items.slice(0, 5).map(item => item.text)).toEqual(['2', '4', '6', '8', '10']);
    });

    it('never asks for more than the limit in one go', async () => {
        const { session } = await run(every);
        const made = await session.execute('N = stream', 2, []);
        const more = session.extend(made.valueRef!, 1_000_000);
        expect(more).toMatchObject({ status: 'ok' });
        expect(more.status === 'ok' && more.added).toBeLessThanOrEqual(1000);
    });

    it('stops at the end of a finite generator and says it ended', async () => {
        const { session } = await run(['fun upto N\n for I in 1 to N\n  yield I\n end\nend']);
        const made = await session.execute('Source = 5 upto', 1, []);
        expect(session.extend(made.valueRef!, 100)).toMatchObject({ status: 'ok', added: 0, finished: true });
        expect(session.extend(made.valueRef!, 100)).toMatchObject({ status: 'ok', added: 0, finished: true });
    });

    it('consumes nothing: the values wait on the tape for the next reader', async () => {
        const { session } = await run(every);
        const made = await session.execute('N = stream', 2, []);
        session.extend(made.valueRef!, 30);
        const total = await session.execute('N till 25 sum', 3, []);
        expect(total.output.map(line => line.text)).toEqual(['156']);
    });

    it('gives up on a generator that never yields again, and closes it', async () => {
        const { session } = await run([
            // Shows its first twenty values at once, then loops without yielding another.
            'fun stuck\n for I in 1 to 30\n  yield I\n end\n for J in 1 to 1000000000000\n  if J less 0\n   yield J\n  end\n end\nend']);
        const made = await session.execute('S = stuck', 2, []);
        const result = session.extend(made.valueRef!, 50);
        expect(result).toMatchObject({ status: 'ok', stopped: 'time' });
        expect(result.status === 'ok' && result.added).toBeGreaterThan(0);
        // The generator was closed, as Ctrl-C would: the values read stay, and nothing more comes.
        expect(session.extend(made.valueRef!, 5)).toMatchObject({ status: 'ok', added: 0, finished: true });
    }, 30_000);

    it('answers stale for a released reference and unsupported for what keeps no tape', async () => {
        const { session } = await run(['V = 1 to 100', 'V']);
        expect(session.extend(99999, 10)).toEqual({ status: 'stale' });
        const range = await session.execute('V', 3, []);
        expect(session.extend(range.valueRef!, 10)).toEqual({ status: 'unsupported' });
        const scalar = await session.execute('1 + 1', 4, []);
        expect(session.extend(scalar.valueRef!, 10)).toEqual({ status: 'unsupported' });
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
            slice: [], shape: [3, 4], windowAxes: [0, 1],
        });
    });

    it('records the slice over the leading axes of a 3-D array', async () => {
        const { session, ref } = await run(['use sequences', 'T = (1 to 24) (array 2 3 4) reshape', 'T']);
        const view = buildValueView('T', opened(session.inspect(ref, { fixed: [1] })));
        expect(view.kind === 'grid' && view.slice).toEqual([{ axis: 0, index: 1, length: 2 }]);
    });

    describe('choosing the axes of the window', () => {
        const cube = () => run(['use sequences', 'T = (1 to 24) (array 2 3 4) reshape', 'T']);
        const grid = (view: ReturnType<typeof buildValueView>) => {
            if (view.kind !== 'grid') throw new Error('expected a grid');
            return view;
        };

        it('lays any two axes down the rows and across the columns, holding the third', async () => {
            const { session, ref } = await cube();
            // Rows on axis 0, columns on axis 2, axis 1 held at 1: cell (r, c) is r * 12 + 1 * 4 + c + 1.
            const view = grid(buildValueView('T', opened(session.inspect(ref, { axes: [0, 2], fixed: [0, 1] }))));
            expect(view.cells).toEqual([['5', '6', '7', '8'], ['17', '18', '19', '20']]);
            expect(view.windowAxes).toEqual([0, 2]);
            expect(view.slice).toEqual([{ axis: 1, index: 1, length: 3 }]);
            expect(view.scroll.rows.length).toBe(2);
            expect(view.scroll.columns?.length).toBe(4);
        });

        it('transposes when the row axis comes after the column axis', async () => {
            const { session, ref } = await cube();
            const view = grid(buildValueView('T', opened(session.inspect(ref, { axes: [2, 1] }))));
            // Rows on axis 2 (4), columns on axis 1 (3), axis 0 held at 0: cell (r, c) is c * 4 + r + 1.
            expect(view.cells).toEqual([['1', '5', '9'], ['2', '6', '10'], ['3', '7', '11'], ['4', '8', '12']]);
            expect(view.slice).toEqual([{ axis: 0, index: 0, length: 2 }]);
        });

        it('reads windows along the chosen axes', async () => {
            const { session, ref } = await cube();
            const view = grid(buildValueView('T', opened(session.inspect(ref, {
                axes: [1, 0], fixed: [0, 0, 3], offset: [1, 1], count: [2, 1] }))));
            // Axis 2 held at 3: cell (r, c) is c * 12 + r * 4 + 4.
            expect(view.cells).toEqual([['20'], ['24']]);
            expect(view.scroll.rows).toMatchObject({ length: 3, offset: 1, count: 2 });
            expect(view.scroll.columns).toMatchObject({ length: 2, offset: 1, count: 1 });
        });

        it('keeps the defaults for a repeated or missing axis, and ignores axes for a vector', async () => {
            const { session, ref } = await cube();
            const same = grid(buildValueView('T', opened(session.inspect(ref, { axes: [1, 1] }))));
            expect(same.windowAxes).toEqual([1, 2]);
            const out = grid(buildValueView('T', opened(session.inspect(ref, { axes: [9, -4] }))));
            expect(out.windowAxes).toEqual([2, 0]);
            const vector = await run(['V = array 1 2 3', 'V']);
            const flat = grid(buildValueView('V', opened(vector.session.inspect(vector.ref, { axes: [0, 1] }))));
            expect(flat.windowAxes).toEqual([0]);
            expect(flat.cells).toEqual([['1'], ['2'], ['3']]);
        });

        it('heads the columns with names only along the last axis', async () => {
            const { session, ref } = await run(['M = array shape 2 3 fill 1', 'M']);
            const named = opened(session.inspect(ref, { axes: [1, 0] }));
            if (named.kind !== 'array') throw new Error('expected an array');
            expect(named.windowAxes).toEqual([1, 0]);
            expect(named.axes.map(axis => axis.length)).toEqual([3, 2]);
        });
    });

    it('uses the column names of a table as labels', async () => {
        const csv = { read: () => new TextEncoder().encode('id,name\n1,A\n') };
        const { session, ref } = await run(['use tables', 'T = "/in.csv" csv', 'T'], csv);
        const view = buildValueView('T', opened(session.inspect(ref)));
        expect(view).toMatchObject({ kind: 'grid', columnLabels: ['id', 'name'], typeLine: 'table · [1 2]' });
    });

    it('lists a tuple by position, each item with its own type', async () => {
        const { session, ref } = await run(['Pair = tuple 1 "a"', 'Pair']);
        const value = opened(session.inspect(ref));
        if (value.kind !== 'entries') throw new Error('expected entries');
        expect(value.type).toBe('tuple');
        expect(value.entries.map(entry => [entry.key, entry.value.text, entry.value.type]))
            .toEqual([['0', '1', 'integer'], ['1', 'a', 'text']]);
        expect(buildValueView('Pair', value)).toMatchObject({ kind: 'list', typeLine: 'tuple · 2', rows: [['0', '1'], ['1', 'a']] });
    });

    it('lists a record as keyed rows, and a sequence by what it has read', async () => {
        const { session, ref } = await run(['A = record\n .x = 1\nend', 'A']);
        expect(buildValueView('A', opened(session.inspect(ref)))).toMatchObject({ kind: 'list', typeLine: 'record · 1', rows: [['x', '1']] });
        const primes = await run(['use sequences', 'P = primes', 'P']);
        expect(buildValueView('P', opened(primes.session.inspect(primes.ref)))).toMatchObject({
            kind: 'list', typeLine: 'sequence · unbounded', rows: expect.arrayContaining([['0', '2']]), note: '100 read so far' });
    });

    it('shows a scalar as its text', async () => {
        const { session, ref } = await run(['40 + 2']);
        expect(buildValueView('Answer', opened(session.inspect(ref)))).toEqual({ kind: 'text', title: 'Answer', typeLine: 'integer', text: '42' });
    });
});
