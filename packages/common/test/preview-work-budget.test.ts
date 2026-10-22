import { createReplSession } from '../src/repl-session.js';
import { ValueViewer } from '../src/value-viewer.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, DemandBudgetExhausted, InterruptedError, RankError, withInterrupt, checkInterrupt, type RankArray, type RankSequence } from '@arrrank/interpreter';
import { DEMAND_LIMIT, preview } from '../src/preview.js';
import { inspectValue, viewLabel } from '../src/value-inspection.js';
import { SequenceReplay } from '../src/sequence-replay.js';

const busy = `fun N busy
 Total = 0
 for I in 0 till N
  Total += I
 end
 return Total
end`;

describe.each([false, true])('bounded producing previews (compilation=%s)', compilation => {
    it('bounds a scalar reduction that keeps producing inputs, then recomputes afresh', () => {
        let reads = 0;
        let closes = 0;
        const source: RankSequence = { kind: 'sequence', plan: {
            name: 'productive sentinel', size: { kind: 'unknown' },
            *iterate() {
                try {
                    for (let i = 0; ; i++) {
                        if (i > DEMAND_LIMIT) throw Error('preview escaped its work budget');
                        reads++;
                        yield 1n;
                    }
                } finally { closes++; }
            },
        } };
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Input', source);
            runtime.execute("Total' = Input sum");
            expect(reads).toBe(0);
            const total = runtime.variables.get('Total')!;
            expect(preview(total)).toEqual({ text: '...', note: 'preview demand budget exhausted' });
            const first = reads;
            expect(first).toBeGreaterThan(0);
            expect(first).toBeLessThan(DEMAND_LIMIT);
            expect(preview(total)).toEqual({ text: '...', note: 'preview demand budget exhausted' });
            expect(reads).toBe(first * 2);
            expect(closes).toBe(2);
            expect(runtime.execute('use sequences\nInput take 3 sum')).toBe(3n);
            expect(closes).toBe(3);
        } finally { runtime.dispose(); }
    });

    it('bounds raw array previews, inspection cells and the first-cell label', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(busy);
            const array: RankArray = { kind: 'array', shape: [2],
                itemAt: () => runtime.execute('20000 busy')!, get items() { throw Error('must not collect'); },
            };
            expect(preview(array)).toEqual({ text: '...', note: 'preview demand budget exhausted' });
            expect(() => inspectValue(array, { count: [2] })).toThrow(DemandBudgetExhausted);
            expect(viewLabel(array)).toBe('c [2]');
            expect(runtime.execute('10 busy')).toBe(45n);
        } finally { runtime.dispose(); }
    });

    it('marks a budget-stopped resource closed without replaying the host exception', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const replay = new SequenceReplay();
        let starts = 0;
        let closes = 0;
        try {
            runtime.execute(busy);
            const source: RankSequence = { kind: 'sequence', plan: {
                name: 'costly resource', size: { kind: 'unknown' }, singlePass: true,
                *iterate() {
                    starts++;
                    try { yield 1n; runtime.execute('20000 busy'); yield 2n; }
                    finally { closes++; }
                },
            } };
            const wrapped = replay.wrap(source);
            expect(replay.extend(wrapped, 3, { budget: 100 })).toMatchObject({ added: 1, stopped: 'budget', finished: true });
            expect(replay.forced(wrapped)?.items).toEqual([1n]);
            expect(closes).toBe(1);
            let failure: unknown;
            try { replay.preview(() => Array.from(wrapped.plan.iterate())); }
            catch (error) { failure = error; }
            expect(failure).not.toBeInstanceOf(DemandBudgetExhausted);
            expect(failure).toBeInstanceOf(Error);
            expect((failure as Error).message).toContain('rerun its producing cell');
            replay.extend(wrapped, 3);
            expect(starts).toBe(1);
        } finally { runtime.dispose(); replay.dispose(); }
    });
});


it('bounds total window work when many cheap cells are requested', () => {
    let reads = 0;
    const array: RankArray = { kind: 'array', shape: [1000, 1000],
        itemAt() { reads++; return 1n; }, get items() { throw Error('must not collect'); },
    };
    expect(() => inspectValue(array, { count: [1000, 1000] })).toThrow(DemandBudgetExhausted);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(DEMAND_LIMIT);
});

it('shows language cell failures but propagates host cancellation', () => {
    const array: RankArray = { kind: 'array', shape: [1],
        itemAt() { throw new RankError('bad cell'); }, get items() { throw Error('must not collect'); },
    };
    expect(inspectValue(array, {})).toMatchObject({ cells: [[{ text: 'bad cell', type: 'error' }]] });
    const cancelled: RankArray = { kind: 'array', shape: [1], items: [], itemAt() { checkInterrupt(); return 1n; } };
    const flag = new Int32Array(new SharedArrayBuffer(4));
    flag[0] = 1;
    expect(() => withInterrupt(flag, () => inspectValue(cancelled, {}))).toThrow(InterruptedError);
});


it('keeps the computed sequence head when a finite preview reaches its work limit', () => {
    let reads = 0;
    let closes = 0;
    const source: RankSequence = { kind: 'sequence', plan: {
        name: 'finite productive source', size: { kind: 'exact', value: 100000n },
        *iterate() {
            try { for (let i = 0; i < 100000; i++) { reads++; yield BigInt(i); } }
            finally { closes++; }
        },
    } };
    expect(preview(source)).toMatchObject({ note: 'preview demand budget exhausted' });
    const first = reads;
    expect(first).toBeLessThan(DEMAND_LIMIT + 1);
    expect(preview(source).text).toMatch(/^0 1 2 3 4 /);
    expect(reads).toBe(first * 2);
    expect(closes).toBe(2);
});


describe.each([false, true])('inspection work limit in the notebook (compilation=%s)', compilation => {
    it('shows the work limit in the viewer and keeps the session usable', async () => {
        const session = createReplSession({ options: { compilation } });
        try {
            await session.execute(busy, 0, []);
            await session.execute("Slow' = (array 20000) busy rank 0", 1, []);
            const result = await session.execute('Slow', 2, []);
            expect(result.valueRef).toBeDefined();
            expect(result.output.some(line => line.text.includes('preview demand budget exhausted'))).toBe(true);
            const viewer = new ValueViewer('Slow', 2, request => session.inspect(result.valueRef!, request),
                () => ({ rows: 20, columns: 80 }));
            expect(await viewer.load()).toBe(true);
            expect(viewer.view).toMatchObject({ kind: 'text', text: 'Inspection work limit reached' });
            expect(await viewer.load()).toBe(true);
            const after = await session.execute('10 busy', 3, []);
            expect(after.output.some(line => line.error)).toBe(false);
            expect(after.output.some(line => line.text === '45')).toBe(true);
        } finally { session.dispose(); }
    });
});
