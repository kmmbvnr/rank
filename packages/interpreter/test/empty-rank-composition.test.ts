import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankFile } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { completed, runExecution } from '../src/execution.js';
import { native } from '../src/modules/shared.js';
import { RankApplication } from '../src/rank-application.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import { framedArray } from '../src/framed-array.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { MemoryIo } from './support.js';

const setup = `use io
use numbers
use sequences
fun X empty
 X print
 return array shape 0 fill 0
end
fun X vector
 "new" print
 return array 0 0
end
fun A B both rank 0 0
 "new" print
 return array A B
end
fun A B zero rank 1 1
 "new" print
 return 0
end
Rows' = (array 1 2) empty rank 0`;

describe.each([false, true])('empty ranked composition (compilation=%s)', compilation => {
    it.each([
        ['Rows isqrt', [2, 0], ['1', '2']],
        ['Rows log', [2, 0], ['1', '2']],
        ['Rows vector rank 0', [2, 0, 2], ['1', '2']],
        ['(Rows vector rank 0) 1', [0, 2], ['2']],
        ['Rows vector axis 1 0 rank 0', [0, 2, 2], ['1', '2']],
        ['(Rows vector axis 1 0 rank 0) # 1 #', [0, 2], ['2']],
        ['Rows transpose sum rank 1', [0], ['1', '2']],
        ['Rows transpose vector rank 1', [0, 2], ['1', '2']],
        ['Rows (array 10) both', [2, 0, 2], ['1', '2']],
        ['Rows max (array 10)', [2, 0], ['1', '2']],
        ['(array 10 20) Rows find', [2, 0], ['1', '2']],
        ['Rows (Rows + 1) both', [2, 0, 2], ['1', '1', '2', '2']],
        ['Rows transpose (array 10) zero', [0], ['1', '2']],
    ] as const)('observes upstream producers without calling the empty new frame: %s', (expression, shape, pass) => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`${setup}\nPlan' = ${expression}`);
            expect(output).toEqual([]);
            runtime.execute('Saved = Plan');
            const saved = runtime.variables.get('Saved')!;
            if (!isRankArray(saved)) throw Error('expected stored array');
            expect(saved.shape).toEqual(shape);
            expect(output).toEqual(pass);
            runtime.execute('Again = Plan');
            expect(output).toEqual([...pass, ...pass]);
            expect(runtime.execute('Saved sum')).toBe(0n);
            expect(output).toEqual([...pass, ...pass]);
        } finally { runtime.dispose(); }
    });

    it.each(['Rows isqrt', 'Rows vector rank 0', 'Rows transpose sum rank 1'])('keeps an unselected result shape query free of producer calls: %s', expression => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`${setup}\nPlan' = ${expression}`);
            runtime.execute('Plan shape');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('keeps a genuinely empty logical broadcast frame empty', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`${setup}
Solo' = (array 1) empty rank 0
Saved = Solo (array shape 0 1 fill 0) both`);
            expect(runtime.variables.get('Saved')).toMatchObject({ shape: [0, 0, 2] });
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it.each(['Values', '((array -1 9) isqrt)'])('does not force a nonempty whole operand for an empty target frame: %s', expression => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`use io
use numbers
use sequences
fun X constant
 X print
 return 0
end
Values' = (array 1 2) constant rank 0
Saved = ${expression} (array shape 0 fill 0) find`);
            expect(runtime.variables.get('Saved')).toMatchObject({ shape: [0] });
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('preserves reordered upstream frames before appended result axes', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`${setup}
Cube' = ((1 to 6) reshape 2 3) empty rank 0
Mapped' = Cube vector axis 2 1 0 rank 0
Saved = Mapped`);
            expect(runtime.variables.get('Saved')).toMatchObject({ shape: [0, 3, 2, 2] });
            expect(output).toEqual(['1', '4', '2', '5', '3', '6']);
            output.length = 0;
            runtime.execute('Picked = Mapped # 2 1 #');
            expect(runtime.variables.get('Picked')).toMatchObject({ shape: [0, 2] });
            expect(output).toEqual(['6']);
        } finally { runtime.dispose(); }
    });
});

it('does not retain upstream prefixes after cancellation in a zero-scalar traversal', () => {
    let calls = 0;
    const source = framedArray([2000], () => {
        calls++;
        return ownedArray([], [0]);
    }, { shape: [0], ownFiles() {}, mismatch: () => Error('shape changed') });
    const app = new RankApplication((fn, args) => completed(fn.call(args)), () => {}, new Map(), () => undefined);
    const never = { ...native('never', 1, () => { throw Error('new callback called'); }), monadicResultShape: () => [2] };
    const result = runExecution(app.applyUnaryAtRank(source, never, 0));
    if (!isRankArray(result)) throw Error('expected result');
    const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 1 };
    expect(() => withInterrupt(signal, () => result.items)).toThrow(InterruptedError);
    const partial = calls;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(2000);
    expect(result.items).toEqual([]);
    expect(calls - partial).toBe(2000);
});

it('starts a fresh upstream observation after an empty ranked result fails', () => {
    const calls: number[] = [];
    let fail = true;
    const source = framedArray([3], index => {
        calls.push(index);
        if (fail && index === 1) throw Error('upstream failed');
        return ownedArray([], [0]);
    }, { shape: [0], ownFiles() {}, mismatch: () => Error('shape changed') });
    const app = new RankApplication((fn, args) => completed(fn.call(args)), () => {}, new Map(), () => undefined);
    const never = { ...native('never', 1, () => { throw Error('new callback called'); }), monadicResultShape: () => [2] };
    const result = runExecution(app.applyUnaryAtRank(source, never, 0));
    if (!isRankArray(result)) throw Error('expected result');
    expect(() => result.items).toThrow('upstream failed');
    expect(calls).toEqual([0, 1]);
    fail = false;
    expect(result.items).toEqual([]);
    expect(calls).toEqual([0, 1, 0, 1, 2]);
});

it('retains files needed by upstream producers but releases an unused new callback file', () => {
    const io = new MemoryIo({ '/upstream': 'Rank', '/unused': 'unused' });
    const upstream: RankFile = { kind: 'file', handle: io.open('/upstream', 'read'), closed: false };
    const unused: RankFile = { kind: 'file', handle: io.open('/unused', 'read'), closed: false };
    const resources = new ResourceOwnership();
    let calls = 0;
    try {
        const result = resources.withResourceScope(() => {
            resources.ownFile(upstream);
            resources.ownFile(unused);
            const app = new RankApplication((fn, args) => completed(fn.call(args)),
                value => resources.ownFiles(value), new Map(), () => undefined);
            const sourceFn = { ...native('source', 1, () => {
                if (upstream.closed) throw Error('upstream file closed');
                calls++;
                return ownedArray([], [0]);
            }), monadicResultShape: () => [0], captureValues: () => [upstream] };
            const never = { ...native('never', 1, () => { throw Error('new callback called'); }),
                monadicResultShape: () => [], captureValues: () => [unused] };
            const source = runExecution(app.applyUnaryAtRank(ownedArray([1n, 2n]), sourceFn, 0));
            return runExecution(app.applyUnaryAtRank(source, never, 0));
        });
        expect(calls).toBe(0);
        expect(upstream.closed).toBe(false);
        expect(unused.closed).toBe(true);
        if (!result || !isRankArray(result)) throw Error('expected result');
        expect(result.items).toEqual([]);
        expect(calls).toBe(2);
    } finally { resources.dispose(); }
    expect(upstream.closed).toBe(true);
});

it.each(['capture', 'capture-broadcast', 'argument'] as const)('retains files needed by a nonempty native dyadic result: %s', mode => {
    const io = new MemoryIo({ '/input': 'Rank' });
    const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
    const resources = new ResourceOwnership();
    let calls = 0;
    try {
        const result = resources.withResourceScope(() => {
            resources.ownFile(file);
            const fn = { ...native('held', 2, args => {
                const held = mode === 'argument' ? args[0] as RankFile : file;
                if (held.closed) throw Error('file closed before demand');
                calls++;
                return 1n;
            }), captureValues: () => mode === 'argument' ? [] : [file],
                dyadicRanks: mode === 'argument' ? ['all', 0] as const : [0, 0] as const };
            const app = new RankApplication((operation, args) => completed(operation.call(args)),
                value => resources.ownFiles(value), new Map(), () => undefined);
            return runExecution(app.applyDyadicAtRank(mode === 'argument' ? file : ownedArray([1n, 2n]),
                ownedArray(mode === 'capture-broadcast' ? [3n] : [3n, 4n]), fn));
        });
        expect(calls).toBe(0);
        expect(file.closed).toBe(false);
        if (!result || !isRankArray(result)) throw Error('expected result');
        expect(result.items).toEqual([1n, 1n]);
        expect(calls).toBe(2);
    } finally { resources.dispose(); }
    expect(file.closed).toBe(true);
});
