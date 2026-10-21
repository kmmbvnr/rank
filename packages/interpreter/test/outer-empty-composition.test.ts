import { ResourceOwnership } from '../src/resource-ownership.js';
import { MemoryIo } from './support.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type NativeFunction, type RankArray, type RankSequence, type RankFile } from '../src/index.js';
import { derivedArray, ownedArray } from '../src/array-storage.js';
import { framedArray } from '../src/framed-array.js';
import { permutedArray } from '../src/array-permutation.js';
import { Operators } from '../src/operators.js';
import { ALL_AXIS, sliceArray, tensorSelection } from '../src/selectors.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

const ops = () => new Operators(() => {}, () => undefined);
const asArray = (value: ReturnType<Operators['evaluateOuter']>): RankArray => {
    if (!isRankArray(value)) throw Error('expected array');
    return value;
};
const setup = `use io
use sequences
fun X aempty
 X print
 return array shape 0 fill 0
end
fun A B blocked rank 0 0
 "new" print
 return 0
end
fun A B blockedRows rank 1 0
 "new" print
 return 0
end
Rows' = (array 1 2) aempty rank 0
Cols' = (array 10 20 30) aempty rank 0`;
const pairs = ['1', '10', '1', '20', '1', '30', '2', '10', '2', '20', '2', '30'];

describe.each([false, true])('empty outer composition (compilation=%s)', compilation => {
    it.each([
        ['Rows Cols outer +', [2, 0, 3, 0], pairs],
        ['(Rows Cols outer +) + 1', [2, 0, 3, 0], pairs],
        ['-(Rows Cols outer +)', [2, 0, 3, 0], pairs],
        ['Rows Cols outer blocked', [2, 0, 3, 0], pairs],
        ['(Rows Cols outer blocked) + 1', [2, 0, 3, 0], pairs],
        ['(Rows Cols outer +) transpose axis 3 2 1 0', [0, 3, 0, 2], ['1', '10', '2', '10', '1', '20', '2', '20', '1', '30', '2', '30']],
        ['((Rows Cols outer +) + 1) 1 # 2 #', [0, 0], ['2', '30']],
        ['(Rows Cols outer +) take 0', [0, 0, 3, 0], []],
        ['Rows (array shape 0 fill 0) outer +', [2, 0, 0], ['1', '2']],
        ['Rows (array shape 0 fill 0) outer blockedRows', [2, 0], ['1', '2']],
    ] as const)('retains selected producer observations for %s', (expression, shape, pass) => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(`${setup}\nPlan' = ${expression}`);
            expect(output).toEqual([]);
            runtime.execute('Saved = Plan');
            expect(runtime.variables.get('Saved')).toMatchObject({ shape, items: [] });
            expect(output).toEqual(pass);
            runtime.execute('Again = Plan');
            expect(output).toEqual([...pass, ...pass]);
            runtime.execute('Saved sum');
            expect(output).toEqual([...pass, ...pass]);
        } finally { runtime.dispose(); }
    });
});

function sequential(calls: string[], fail?: () => boolean): RankSequence {
    return { kind: 'sequence', plan: {
        name: 'empty sequential rows', size: { kind: 'exact', value: 3n },
        *iterate() {
            try {
                for (let i = 0; i < 3; i++) {
                    calls.push(String(i));
                    if (i === 1 && fail?.()) throw new InterruptedError('row');
                    yield ownedArray([], [0]);
                }
                calls.push('end');
            } finally { calls.push('close'); }
        },
    } };
}

it.each(['direct', 'mapped', 'permuted', 'aliased'])('owns fresh sequential cursors for %s full demands', mode => {
    const calls: string[] = [];
    const operations = ops();
    const outer = asArray(operations.evaluateOuter('+', sequential(calls), ownedArray([10n])));
    const mapped = asArray(operations.evaluateBinary('+', outer, mode === 'aliased' ? outer : 1n));
    const result = mode === 'direct' ? outer : mode === 'permuted' ? permutedArray(mapped, [2, 1, 0]) : mapped;
    calls.length = 0;
    const pass = mode === 'aliased' ? ['0', '0', '1', '1', '2', '2', 'end', 'close', 'end', 'close'] : ['0', '1', '2', 'end', 'close'];
    expect(result.items).toEqual([]);
    expect(calls).toEqual(pass);
    expect(result.items).toEqual([]);
    expect(calls).toEqual([...pass, ...pass]);
});

it('restarts gather indices without retaining old source values', () => {
    const calls: string[] = [];
    const outer = asArray(ops().evaluateOuter('+', sequential(calls), ownedArray([10n])));
    const selected = asArray(sliceArray(outer, tensorSelection(outer, [ownedArray([2n, 2n, 0n]), ALL_AXIS, ALL_AXIS])));
    calls.length = 0;
    expect(selected.items).toEqual([]);
    expect(calls).toEqual(['0', '1', '2', 'close', '0', '1', '2', 'close', '0', 'close']);
});

it('closes a failed cursor and does not keep its successful prefix for retry', () => {
    const calls: string[] = [];
    let fail = true;
    const outer = asArray(ops().evaluateOuter('+', sequential(calls, () => fail), ownedArray([10n])));
    const mapped = asArray(ops().evaluateBinary('+', outer, 1n));
    calls.length = 0;
    expect(() => mapped.items).toThrow(InterruptedError);
    expect(calls).toEqual(['0', '1', 'close']);
    fail = false;
    expect(mapped.items).toEqual([]);
    expect(calls).toEqual(['0', '1', 'close', '0', '1', '2', 'end', 'close']);
});

it('does not demand normal scalar producers in an empty product', () => {
    let scalarCalls = 0;
    let emptyCalls = 0;
    const source = framedArray([2], () => { emptyCalls++; return ownedArray([], [0]); }, {
        shape: [0], ownFiles() {}, mismatch: () => Error('shape'),
    });
    const unused = derivedArray([3], [], () => { scalarCalls++; throw Error('unused scalar'); });
    const named: NativeFunction = { kind: 'function', name: 'unused', arities: [2], monadicRank: 0,
        dyadicRanks: [0, 0], call() { throw Error('no new callback'); } };
    const result = asArray(ops().evaluateNamedOuter(named, source, unused));
    const mapped = asArray(ops().evaluateBinary('+', result, 1n));
    expect(mapped.items).toEqual([]);
    expect(emptyCalls).toBe(2);
    expect(scalarCalls).toBe(0);
});

it('retains the cell failure when closing its suspended source also fails', () => {
    let cleanupFails = false;
    const broken = framedArray([1], () => { throw new InterruptedError('nested cell'); }, {
        shape: [0], ownFiles() {}, mismatch: () => Error('shape'),
    });
    const source: RankSequence = { kind: 'sequence', plan: {
        name: 'cleanup failure', size: { kind: 'exact', value: 1n },
        *iterate() { try { yield broken; } finally { if (cleanupFails) throw Error('cleanup failed'); } },
    } };
    const outer = asArray(ops().evaluateOuter('+', source, ownedArray([1n])));
    const mapped = asArray(ops().evaluateBinary('+', outer, 1n));
    cleanupFails = true;
    expect(() => mapped.items).toThrow('Interrupted while nested cell');
});

it('propagates effects and failures after the last declared yield', () => {
    let fail = true;
    let reads = 0;
    let closes = 0;
    const source: RankSequence = { kind: 'sequence', plan: {
        name: 'completion failure', size: { kind: 'exact', value: 2n },
        *iterate() {
            try {
                for (let i = 0; i < 2; i++) { reads++; yield ownedArray([], [0]); }
                if (fail) throw Error('completion failed');
            } finally { closes++; }
        },
    } };
    const outer = asArray(ops().evaluateOuter('+', source, ownedArray([1n])));
    const mapped = asArray(ops().evaluateBinary('+', outer, 1n));
    reads = closes = 0;
    expect(() => mapped.items).toThrow('completion failed');
    expect(reads).toBe(2);
    expect(closes).toBe(1);
    fail = false;
    expect(mapped.items).toEqual([]);
    expect(reads).toBe(4);
    expect(closes).toBe(2);
});


it('closes a partially cancelled traversal and starts the next demand afresh', () => {
    const flag = new Int32Array(new SharedArrayBuffer(4));
    let cancel = true;
    let reads = 0;
    let closes = 0;
    const source: RankSequence = { kind: 'sequence', plan: {
        name: 'cancellable', size: { kind: 'exact', value: 2048n },
        *iterate() {
            try {
                for (let i = 0; i < 2048; i++) {
                    reads++;
                    if (i === 10 && cancel) Atomics.store(flag, 0, 1);
                    yield ownedArray([], [0]);
                }
            } finally { closes++; }
        },
    } };
    const outer = asArray(ops().evaluateOuter('+', source, ownedArray([1n])));
    const mapped = asArray(ops().evaluateBinary('+', outer, 1n));
    reads = closes = 0;
    expect(() => withInterrupt(flag, () => mapped.items)).toThrow(InterruptedError);
    expect(reads).toBeGreaterThan(10);
    expect(reads).toBeLessThan(2048);
    expect(closes).toBe(1);
    const prefix = reads;
    cancel = false;
    expect(withInterrupt(flag, () => mapped.items)).toEqual([]);
    expect(reads).toBe(prefix + 2048);
    expect(closes).toBe(2);
});

it('transfers source resources through empty outer arithmetic and permutations', () => {
    const io = new MemoryIo({ '/input': 'Rank' });
    const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
    const ownership = new ResourceOwnership();
    let reads = 0;
    try {
        const view = ownership.withResourceScope(() => {
            ownership.ownFile(file);
            const source: RankSequence = { kind: 'sequence', plan: {
                name: 'resource dependency', size: { kind: 'exact', value: 2n },
                captures: [new Map([['File', file]])],
                *iterate() {
                    for (let i = 0; i < 2; i++) {
                        if (file.closed) throw Error('closed source file');
                        reads++;
                        yield ownedArray([], [0]);
                    }
                },
            } };
            const outer = asArray(ops().evaluateOuter('+', source, ownedArray([1n])));
            return permutedArray(asArray(ops().evaluateBinary('+', outer, 1n)), [2, 1, 0]);
        });
        expect(file.closed).toBe(false);
        expect(reads).toBe(1); // Shape inference only, no ownership-driven traversal.
        expect(view.items).toEqual([]);
        expect(reads).toBe(3);
    } finally { ownership.dispose(); }
    expect(file.closed).toBe(true);
});
