import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankPlan, isRankSequence } from '../src/index.js';

const clauses = [
    ['Source take Limit', '1 2 3'],
    ['Source drop Limit', '4 5'],
    ['Source from Limit', '3 4 5'],
    ['Source after Limit', '4 5'],
    ['Source to Limit', '1 2 3'],
    ['Source till Limit', '1 2'],
    ['Source till greater Limit', '1 2 3'],
    ['Source from greater Limit', '4 5'],
    ['Source from mod Divisor equal Remainder', '2 3 4 5'],
    ['Source first where greater Limit', '4'],
    ['Source first index where greater Limit', '3'],
] as const;

describe.each([false, true])('clause plan capture (compilation=%s)', compilation => {
    it('keeps signed ready integer ranges as native descriptors with captured endpoints', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("Start = 5\nStop = -5\nStep = 2\nValues' = Start to Stop by -Step\nStart = 99\nStop = 99\nStep = 99");
            expect(isRankSequence(runtime.variables.get('Values')!)).toBe(true);
            expect(formatValue(runtime.execute('Values')!)).toBe('5 3 1 -1 -3 -5');
        } finally { runtime.dispose(); }
    });

    it.each(clauses)('captures escaped parameters in %s', (expression, expected) => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
fun Source Limit Divisor Remainder build
 Result' = ${expression}
 return Result
end
Values = array 1 2 3 4 5
Saved' = Values 3 2 0 build
Limit = 100
Divisor = 100
Remainder = 100
Values = array 99`);
            const plan = runtime.variables.get('Saved')!;
            expect(isRankPlan(plan)).toBe(true);
            expect(formatValue(runtime.execute('Saved')!)).toBe(expected);
            expect(formatValue(runtime.execute('Saved')!)).toBe(expected);
            runtime.execute('Retained = Saved');
            expect(formatValue(runtime.variables.get('Retained')!)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('keeps lower-bound seeking available on a returned prime plan', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
fun N later
 Candidates' = primes from (N + 1)
 return Candidates
end
Saved' = 999999999999 later
N = 0`);
            expect(isRankPlan(runtime.variables.get('Saved')!)).toBe(true);
            expect(runtime.execute('Saved 0')).toBe(1000000000039n);
            expect(runtime.execute('Saved 0')).toBe(1000000000039n);
        } finally { runtime.dispose(); }
    });

    it('keeps comparison bounds on native primes available to compiled membership', () => {
        let entries = 0;
        const runtime = new Interpreter(undefined, { compilation,
            onIntegerLoopExecuted: () => entries++,
        });
        try {
            runtime.execute("use sequences\nLimit = 1000\nAllowed' = primes from greater 99 till at least Limit");
            expect(isRankSequence(runtime.variables.get('Allowed')!)).toBe(true);
            expect(runtime.execute(`Total = 0
for N in 0 to 1000
 if N in Allowed
  Total += 1
 end
end
Total`)).toBe(143n);
            expect(entries > 0).toBe(compilation);
        } finally { runtime.dispose(); }
    });

    it('defers a replaced native bound hook and repeats it at each demand', () => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use sequences');
            const source = runtime.execute('primes')!;
            if (!isRankSequence(source)) throw Error('expected prime source');
            const original = source.plan.withUpperBound!;
            source.plan.withUpperBound = function(limit, inclusive) {
                calls++;
                return original.call(this, limit, inclusive);
            };
            runtime.variables.set('Source', source);
            runtime.execute("Saved' = Source till 20");
            expect(calls).toBe(0);
            expect(isRankPlan(runtime.variables.get('Saved')!)).toBe(true);
            expect(runtime.execute('Saved 0')).toBe(2n);
            expect(runtime.execute('Saved 0')).toBe(2n);
            expect(calls).toBe(2);
        } finally { runtime.dispose(); }
    });

    it.each(['from 2', 'till 20'])(
        'does not open a missing module to inspect native metadata for %s', clause => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.execute(`Saved' = primes ${clause}`);
                expect(() => runtime.execute('Saved 0')).toThrow(/use sequences/);
                runtime.execute('use sequences');
                expect(runtime.execute('Saved 0')).toBe(2n);
            } finally { runtime.dispose(); }
        });

    it.each(['to Limit', 'till Limit', 'till greater Limit'])(
        'does not read an array to construct a plan with %s', clause => {
            let reads = 0;
            const runtime = new Interpreter(undefined, { compilation });
            runtime.variables.set('Source', { kind: 'array', shape: [4], items: [],
                itemAt(index) { reads++; return BigInt(index + 1); } });
            try {
                runtime.execute(`Limit = 3\nSaved' = Source ${clause}`);
                expect(reads).toBe(0);
                expect(isRankPlan(runtime.variables.get('Saved')!)).toBe(true);
                expect(formatValue(runtime.execute('Saved')!)).toBe(clause === 'till Limit' ? '1 2' : '1 2 3');
                expect(reads).toBeGreaterThan(0);
            } finally { runtime.dispose(); }
        });

    it.each(['Source take 1', 'Source drop 1', 'Source from 2',
        'Source first where greater 1', 'Source first index where greater 1'])(
        'protects the captured source in %s', expression => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(() => runtime.execute(`use sequences
Source = array 1 2 3
Saved' = ${expression}
Source 0 = 99`)).toThrow(/Source is read-only/);
            } finally { runtime.dispose(); }
        });

    it.each(['Source take (Bounds 0)', 'Source from (Bounds 0)',
        'Source till greater (Bounds 0)', 'Source from mod (Bounds 0) equal 1'])(
        'protects names read by the bound in %s', expression => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(() => runtime.execute(`use sequences
Source = array 1 2 3
Bounds = array 2
Saved' = ${expression}
Bounds 0 = 99`)).toThrow(/Bounds is read-only/);
            } finally { runtime.dispose(); }
        });
});
