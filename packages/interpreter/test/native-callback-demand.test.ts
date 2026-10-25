import { describe, expect, it } from 'vitest';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
import { Operators } from '../src/operators.js';
import { ReductionEvaluator } from '../src/reduction.js';
import { ResourceOwnership } from '../src/resource-ownership.js';
import { isRankArray, type NativeFunction, type RankArray, type RankFile, type RankValue } from '../src/value.js';
import { MemoryIo } from './support.js';

const array = (value: RankValue): RankArray => {
    if (!isRankArray(value)) throw Error('expected array');
    return value;
};
const operators = (ownFiles: (value: RankValue) => void = () => {}) => new Operators(ownFiles, () => undefined);
const reductions = (fn: NativeFunction) => new ReductionEvaluator(() => { throw Error('unexpected operator'); },
    () => fn, new Map(), false, () => undefined, (operation, args) => operation.call(args), () => {});

describe('native callback result demand', () => {
    it('repeats named outer callbacks for each complete observation and retry', () => {
        const calls: bigint[][] = [];
        let fail = false;
        const fn = { ...native('plus', 2, ([a, b]) => {
            calls.push([a as bigint, b as bigint]);
            if (fail && a === 2n && b === 20n) throw Error('callback failed');
            return (a as bigint) + (b as bigint);
        }), dyadicRanks: [0, 0] as const };
        const value = array(operators().evaluateNamedOuter(fn, ownedArray([1n, 2n]), ownedArray([10n, 20n])));
        expect(calls).toEqual([]);
        expect(value.items).toEqual([11n, 21n, 12n, 22n]);
        const pass = [...calls];
        expect(value.items).toEqual([11n, 21n, 12n, 22n]);
        expect(calls).toEqual([...pass, ...pass]);
        fail = true;
        expect(() => value.items).toThrow('callback failed');
        fail = false;
        expect(value.items).toEqual([11n, 21n, 12n, 22n]);
        expect(calls).toEqual([...pass, ...pass, ...pass, ...pass]);
    });

    it('repeats custom axis reductions without retaining completed frame values', () => {
        const calls: bigint[][] = [];
        const fn = native('total', 1, ([value]) => {
            const items = array(value).items as bigint[];
            calls.push([...items]);
            return items.reduce((a, b) => a + b, 0n);
        });
        const value = array(reductions(fn).evaluateAxisReduction('total', ownedArray([1n, 2n, 3n, 4n], [2, 2]), [1]));
        expect(calls).toEqual([]);
        expect(value.items).toEqual([3n, 7n]);
        expect(value.items).toEqual([3n, 7n]);
        expect(calls).toEqual([[1n, 2n], [3n, 4n], [1n, 2n], [3n, 4n]]);
    });

    it.each(['outer', 'axis'] as const)('retains callback files through native %s results without invoking the callback', mode => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const file: RankFile = { kind: 'file', handle: io.open('/input', 'read'), closed: false };
        const ownership = new ResourceOwnership();
        let calls = 0;
        try {
            const value = ownership.withResourceScope(() => {
                ownership.ownFile(file);
                const fn = { ...native('held', mode === 'outer' ? 2 : 1, () => { calls++; return 1n; }),
                    captureValues: () => [file], dyadicRanks: [0, 0] as const };
                return mode === 'outer'
                    ? operators(value => ownership.ownFiles(value)).evaluateNamedOuter(fn, ownedArray([1n, 2n]), ownedArray([3n]))
                    : reductions(fn).evaluateAxisReduction('held', ownedArray([1n, 2n], [2, 1]), [1]);
            });
            expect(calls).toBe(0);
            expect(file.closed).toBe(false);
            expect(array(value!).items).toEqual([1n, 1n]);
            expect(calls).toBe(2);
        } finally { ownership.dispose(); }
        expect(file.closed).toBe(true);
    });

    it('passes a completed single-pass operand to a whole-cell outer callback', () => {
        let opened = false;
        const fn = native('firstsum', 2, ([a, b]) =>
            (readArrayItem(array(a), 0) as bigint) + (readArrayItem(array(b), 0) as bigint));
        const value = operators().evaluateNamedOuter(fn, { kind: 'sequence', plan: {
            name: 'once', singlePass: true, size: { kind: 'unknown' },
            *iterate() {
                if (opened) throw Error('consumed');
                opened = true;
                yield 2n;
                yield 3n;
            },
        } }, ownedArray([10n]));
        expect(opened).toBe(true);
        expect(array(value).items).toEqual([12n]);
        expect(array(value).items).toEqual([12n]);
    });
});
