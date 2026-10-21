import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankFile, type RankValue } from '../src/index.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { completed, runExecution } from '../src/execution.js';
import { materializeValue } from '../src/materialize.js';
import { native } from '../src/modules/shared.js';
import { RankApplication } from '../src/rank-application.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import { MemoryIo } from './support.js';

const app = () => new RankApplication((fn, args) => completed(fn.call(args)), () => {}, new Map(), () => undefined);
const array = (value: RankValue): RankArray => {
    if (!isRankArray(value)) throw Error('expected array');
    return value;
};

describe('native ranked demand', () => {
    it('executes every framed callback when completing empty result cells', () => {
        const calls: bigint[] = [];
        const fn = { ...native('empty', 1, ([value]) => {
            calls.push(value as bigint);
            return ownedArray([], [0]);
        }), monadicResultShape: () => [0] };
        const result = array(runExecution(app().applyUnaryAtRank(ownedArray([1n, 2n]), fn, 0)));
        expect(result.shape).toEqual([2, 0]);
        expect(calls).toEqual([]);
        expect(array(materializeValue(result)).shape).toEqual([2, 0]);
        expect(calls).toEqual([1n, 2n]);
        expect(result.items).toEqual([]);
        expect(calls).toEqual([1n, 2n, 1n, 2n]);
    });

    it('retains declared callback resources without evaluating ranked cells', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        let calls = 0;
        try {
            const result = ownership.withResourceScope(() => {
                ownership.ownFile(file);
                const fn = { ...native('held', 1, () => { calls++; return file; }),
                    captureValues: () => [file], monadicResultShape: () => [] };
                return runExecution(app().applyUnaryAtRank(ownedArray([1n, 2n]), fn, 0));
            });
            expect(calls).toBe(0);
            expect(file.closed).toBe(false);
            expect(readArrayItem(array(result), 0)).toBe(file);
        } finally { ownership.dispose(); }
        expect(file.closed).toBe(true);
    });

    it.each(['unary', 'binary'])('recomputes %s result cells, retaining only the current frame during completion', mode => {
        const calls: bigint[] = [];
        const fn = { ...native('pair', mode === 'unary' ? 1 : 2, args => {
            const n = args.reduce<bigint>((sum, value) => sum + (value as bigint), 0n);
            calls.push(n);
            return ownedArray([n, n + 1n]);
        }), monadicResultShape: () => [2], dyadicResultShape: () => [2] };
        const source = ownedArray([1n, 3n]);
        const result = array(runExecution(mode === 'unary'
            ? app().applyUnaryAtRank(source, fn, 0)
            : app().applyDyadicAtRank(source, 10n, fn, 0, 0)));
        const expected = mode === 'unary' ? [1n, 2n, 3n, 4n] : [11n, 12n, 13n, 14n];
        expect(result.shape).toEqual([2, 2]);
        expect(calls).toEqual([]);
        expect(result.items).toEqual(expected);
        const pass = [...calls];
        expect(pass).toEqual([expected[0], expected[2]]);
        expect(result.items).toEqual(expected);
        expect(calls).toEqual([...pass, ...pass]);
        const saved = array(materializeValue(result));
        expect(saved.items).toEqual(expected);
        expect(calls).toEqual([...pass, ...pass, ...pass]);
        expect(readArrayItem(saved, 1)).toBe(expected[1]);
        expect(calls).toEqual([...pass, ...pass, ...pass]);
    });

    it('keeps unknown dimensions distinct from empty dimensions and discards shape-probe results', () => {
        let calls = 0;
        const fn = { ...native('dynamic', 1, () => { calls++; return ownedArray([1n, 2n]); }),
            monadicResultShape: () => [null] };
        const result = array(runExecution(app().applyUnaryAtRank(ownedArray([1n, 2n]), fn, 0)));
        expect(calls).toBe(0);
        expect(result.shape).toEqual([2, 2]);
        expect(calls).toBe(1);
        expect(result.shape).toEqual([2, 2]);
        expect(calls).toBe(1);
        expect(result.items).toEqual([1n, 2n, 1n, 2n]);
        expect(calls).toBe(3);
        expect(result.items).toEqual([1n, 2n, 1n, 2n]);
        expect(calls).toBe(5);
    });

    it('retries a failed frame from the start while retaining result-shape validation', () => {
        const calls: bigint[] = [];
        let broken = true;
        const fn = { ...native('dynamic', 1, ([value]) => {
            calls.push(value as bigint);
            if (broken && value === 2n) return ownedArray([1n]);
            return ownedArray([1n, 2n]);
        }), monadicResultShape: () => [2] };
        const result = array(runExecution(app().applyUnaryAtRank(ownedArray([1n, 2n]), fn, 0)));
        expect(() => result.items).toThrow('one shape');
        expect(() => result.items).toThrow('one shape');
        expect(calls).toEqual([1n, 2n, 1n, 2n]);
        broken = false;
        expect(result.items).toEqual([1n, 2n, 1n, 2n]);
        expect(calls).toEqual([1n, 2n, 1n, 2n, 1n, 2n]);
    });
});

it.each([false, true])('completes empty ranked cells through binding and copy (compilation=%s)', compilation => {
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { compilation });
    try {
        runtime.execute(`use io
use sequences
fun X empty
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2) empty rank 0
Saved = Rows`);
        expect((runtime.variables.get('Saved') as RankArray).shape).toEqual([2, 0]);
        expect(output).toEqual(['1', '2']);
        runtime.execute('Copied = Rows copy');
        expect((runtime.variables.get('Copied') as RankArray).shape).toEqual([2, 0]);
        expect(output).toEqual(['1', '2', '1', '2']);
    } finally { runtime.dispose(); }
});

it.each([false, true])('protects callback captures in native results returned by a helper (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute(`State = record
 .factor = 2
end
Alias = State
fun X scaled = X * State .factor
fun A' construct = A scaled rank 0
Input = array 1 2
Plan' = Input construct`);
        expect(() => runtime.execute('Alias .factor = 3')).toThrow(/captur|read.only/);
        expect(runtime.execute('Plan sum')).toBe(6n);
    } finally { runtime.dispose(); }
});

it.each([false, true])('keeps callback effects repeatable for explicit ranked plans (compilation=%s)', compilation => {
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { compilation });
    try {
        runtime.execute(`use io
fun X pair
 X print
 return array X (X + 1)
end
Rows' = (array 1 3) pair rank 0`);
        expect(output).toEqual([]);
        expect(runtime.execute('Rows sum')).toBe(10n);
        const pass = [...output];
        expect(pass).toEqual(['1', '3']);
        expect(runtime.execute('Rows sum')).toBe(10n);
        expect(output).toEqual([...pass, ...pass]);
        runtime.execute('Saved = Rows');
        expect(output).toEqual([...pass, ...pass, ...pass]);
        expect(runtime.execute('Saved sum')).toBe(10n);
        expect(output).toEqual([...pass, ...pass, ...pass]);
    } finally { runtime.dispose(); }
});
