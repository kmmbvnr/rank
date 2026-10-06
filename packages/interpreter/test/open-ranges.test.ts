import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankSequence } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { withInterrupt } from '../src/interrupt.js';

for (const compiled of [false, true]) describe(`open ranges (compiled=${compiled})`, () => {
    const run = (source: string) => formatValue(new Interpreter(undefined,
        { scalarFunctionCompilation: compiled }).execute(`use sequences\n${source}`)!);

    it.each([
        ['1 to #', '1 2 3 4'], ['1 to # by 2', '1 3 5 7'],
        ['0 to # by -1', '0 -1 -2 -3'], ['0 till # by 2', '0 2 4 6'],
        ['100000000000000000000 to # by 3', '100000000000000000000 100000000000000000003 100000000000000000006 100000000000000000009'],
    ])('takes a finite prefix of %s', (source, expected) => {
        expect(run(`(${source}) take 4`)).toBe(expected);
    });

    it('indexes and replays without retaining generated items', () => {
        const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
        const value = runtime.execute('N = 1 to # by 2');
        expect(value && isRankSequence(value) && value.plan.size).toEqual({ kind: 'infinite' });
        expect(formatValue(runtime.execute('N 100000000000000000000')!)).toBe('200000000000000000001');
        expect(formatValue(runtime.execute('N 0')!)).toBe('1');
        if (!value || !isRankSequence(value)) throw new Error('expected range');
        const a = value.plan.iterate(), b = value.plan.iterate();
        expect([a.next().value, a.next().value, b.next().value, a.next().value, b.next().value])
            .toEqual([1n, 3n, 1n, 5n, 3n]);
        expect(run('N = 1 to #\nN take 10000 sum')).toBe('50005000');
    });

    it('branches lazy arithmetic and rank mapping independently', () => {
        expect(run('use numbers\nN = 1 to #\nTriangles = N * (N + 1) // 2\ndivisor_count = divisors count\nCounts = Triangles divisor_count rank 0\nTriangles first where (Counts greater 5)')).toBe('28');
        expect(run('N = 1 to #\nA = N * 2\nB = N + 10\narray (A 5) (B 0) (A 0) (B 5)')).toBe('12 11 2 16');
    });

    it('stops the Euler divisor pipeline at its first matching triangle', () => {
        const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
        let last = 0n, calls = 0;
        runtime.variables.set('checked', native('checked', 1, ([value]) => {
            if (typeof value !== 'bigint' || value > 76576500n) throw new Error('Euler overread');
            last = value; calls++;
            return value;
        }));
        const answer = runtime.execute('use numbers\nuse sequences\nN = 1 to #\nTriangles = N * (N + 1) // 2\ndivisor_count = checked divisors count\nCounts = Triangles divisor_count rank 0\nTriangles first where (Counts greater 500)');
        expect(answer).toBe(76576500n);
        expect(last).toBe(76576500n);
        expect(calls).toBe(12375);
    });

    it('stops demand at take and first match', () => {
        expect(run('fun checked X rank 0\nif X greater 3\nfail "overread"\nend\nreturn X\nend\nN = (1 to #) checked\nN first where equal 3')).toBe('3');
        expect(run('fun checked X rank 0\nif X greater 3\nfail "overread"\nend\nreturn X\nend\nN = (1 to #) checked\nN take 3')).toBe('1 2 3');
        expect(run('fun checked X rank 0\nfail "read"\nend\nN = (1 to #) checked\nN take 0')).toBe('');
    });

    it('preserves value bounds rather than inferring descending direction', () => {
        expect(run('(1 to # by 2) to 6')).toBe('1 3 5');
        expect(run('(1 to #) till 4')).toBe('1 2 3');
        expect(run('Down = 0 to # by -1\nDown to -10')).toBe('');
        expect(run('Down = 0 to # by -1\nDown till less -3')).toBe('0 -1 -2 -3');
        expect(() => run('(0 to # by -1) to 10 sum')).toThrow(/finite|bounded/);
        expect(run('Down = 0 to # by -1\nBelow = Down filter less -2\nBelow to -2 take 3')).toBe('-3 -4 -5');
    });

    it.each(['(1 to #) sum', '(1 to #) max', '(1 to #) array', '(1 to #) len'])
        ('rejects full consumption: %s', source => expect(() => run(source)).toThrow(/finite|bounded/));
    it.each(['true to #', '"text" to #', '1.5 to #', '1 to # by 0.5', '1 to # by 0', '1 to # by true'])
        ('rejects invalid numeric range: %s', source => expect(() => run(source)).toThrow(/integer/));

    it.each([
        ['2 to #', '30 40'], ['4 to #', ''], ['3 to # by -1', '40 30 20 10'],
        ['1 to # by 2', '20 40'], ['0 to # by -1', '10'],
    ])('bounds direct and named array slices: %s', (selector, expected) => {
        expect(run(`A = array 10 20 30 40\nA (${selector})`)).toBe(expected);
        expect(run(`A = array 10 20 30 40\nTail = ${selector}\nA Tail`)).toBe(expected);
    });
    it('slices tensor axes, text, empty axes, finite and infinite sequences', () => {
        expect(run('M = ((1 to 8) array) reshape 2 4\nTail = 2 to #\nM # Tail')).toBe('3 4 7 8');
        expect(run('M = ((1 to 8) array) reshape 2 4\nTail = 2 to #\n(M # Tail) shape')).toBe('2 2');
        expect(run('"abcd" (2 to #)')).toBe('cd');
        expect(run('A = array shape 0 fill 0\nA (0 to #)')).toBe('');
        expect(run('A = 10 to 40 by 10\nA (2 to #)')).toBe('30 40');
        expect(run('A = 10 to # by 10\nTail = 2 to #\nA Tail take 3')).toBe('30 40 50');
        expect(run('A = 10 to # by 10\nA (2 to # by -1)')).toBe('30 20 10');
    });
    it('interrupts a search that has no match', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const runtime = new Interpreter();
        let calls = 0;
        runtime.variables.set('never', native('never', 1, () => {
            if (++calls === 10) Atomics.store(signal, 0, 1);
            return 1n;
        }));
        expect(() => withInterrupt(signal, () => runtime.execute('N = 1 to #\nMask = (N never rank 0) less 0\nN first where Mask'))).toThrow(/interrupt|cancel/i);
        expect(calls).toBeGreaterThanOrEqual(10);
        expect(calls).toBeLessThan(2000);
    });
    it('keeps invalid explicit indices and out-of-bounds starts as errors', () => {
        for (const selector of ['array 1 4', '5 to #', '-1 to #']) {
            expect(() => run(`A = array 10 20 30 40\nA (${selector})`)).toThrow(/bounds|nonnegative/);
        }
    });
});
