import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { sequence } from '../src/sequence.js';

for (const compiled of [false, true]) describe(`mixed sequence arithmetic (compiled=${compiled})`, () => {
    function run(source: string): string {
        const runtime = new Interpreter(() => {}, { compilation: compiled });
        try { return formatValue(runtime.execute('use sequences\nuse numbers\n' + source)!); }
        finally { runtime.dispose(); }
    }
    const setup = 'Q = array 10 20 30\nR = 3 till 0 by -1\n';

    it('pairs ranges in either order and preserves operand order', () => {
        expect(run(setup + 'Q + R')).toBe('13 22 31');
        expect(run(setup + 'R + Q')).toBe('13 22 31');
        expect(run(setup + 'Q - R')).toBe('7 18 29');
        expect(run(setup + 'R - Q')).toBe('-7 -18 -29');
        expect(run('Q = array 10 20 30\nQ * (1 to 3)')).toBe('10 40 90');
        expect(run('Q = array 10 20 30\nQ + (0 till 6 by 2)')).toBe('10 22 34');
    });

    it('uses trailing-axis and singleton broadcasting', () => {
        expect(run('M = array shape 2 3 fill 10\nR = M + (1 to 3)\nR shape')).toBe('2 3');
        expect(run('M = array shape 2 3 fill 10\nM + (1 to 3)')).toBe('11 12 13 11 12 13');
        expect(run('(array 10) + (1 to 3)')).toBe('11 12 13');
        expect(run('(array 10 20 30) + (1 to 1)')).toBe('11 21 31');
    });

    it('reports incompatible sizes instead of truncating', () => {
        expect(() => run('(array 10 20) + (1 to 3)')).toThrow('shape mismatch');
        expect(() => run('(1 to 3) + (array 10 20)')).toThrow('shape mismatch');
        expect(run('Q = array shape 0 fill 0\nR = Q + (0 till 0)\nR shape')).toBe('0');
        expect(() => run('(array 10 20) + (0 till 0)')).toThrow('shape mismatch');
    });

    it('shares pairing with numeric built-ins and comparisons', () => {
        expect(run(setup + 'Q max R')).toBe('10 20 30');
        expect(run(setup + 'R max Q')).toBe('10 20 30');
        expect(run('(array 4 6 8) gcd (2 to 4)')).toBe('2 3 4');
        expect(run('unpack Q R = (array 10 20 30) divmod (2 to 4)\nQ')).toBe('5 6 7');
        expect(run('Mask = (1 to 3) greater 1\nMask and (array true false true)')).toBe('false false true');
        expect(run('(array 1 9 3) equal (1 to 3)')).toBe('true false true');
        expect(run('(1 to 3) (array 1 9 3) equal rank 0')).toBe('true false true');
    });

    it('stacks finite generator cells like explicit array conversion', () => {
        const source = 'fun rows\n  yield array 1 2\n  yield array 3 4\nend\n';
        expect(run(source + '(array 10 20) + rows')).toBe('11 22 13 24');
        expect(run('fun values\n  yield 1\n  yield 2\nend\n(array 10 20) + values')).toBe('11 22');
        expect(() => run('(array 10 20) + primes')).toThrow('infinite sequence');
    });

    it('preserves scalar mapping, stream zipping, membership and explicit outer', () => {
        expect(run('(1 to 3) + 10')).toBe('11 12 13');
        expect(run('(1 to 3) + (10 to 11)')).toBe('11 13');
        expect(run('(array 1 4) in (1 to 3)')).toBe('true false');
        expect(run('(array 10 20) (1 to 3) outer +')).toBe('11 12 13 21 22 23');
    });
});

describe('lazy boolean test assertions', () => {
    it.each([
        'Actual = 1 to 3\nActual equal array 99 98 97',
        '(1 to 3) greater 2',
        'fun flags\n  yield true\n  yield false\nend\nflags',
    ])('fails a false lazy assertion: %s', expression => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(`use testing\ntest "false assertion"\nuse sequences\n${expression}\nend`);
            expect(runtime.testResults).toHaveLength(1);
            expect(runtime.testResults[0].passed).toBe(false);
            expect(runtime.testResults[0].error).toContain('boolean test expression evaluated to false');
        } finally { runtime.dispose(); }
    });
});

describe('mixed source consumption', () => {
    it('consumes an unknown-length single-pass source once', () => {
        const runtime = new Interpreter(() => {});
        let passes = 0;
        try {
            runtime.variables.set('Source', sequence({
                name: 'single pass', size: { kind: 'unknown' }, singlePass: true,
                *iterate() {
                    if (++passes > 1) throw new Error('source replayed');
                    yield 1n;
                    yield 2n;
                },
            }));
            runtime.execute('R = (array 10 20) + Source');
            expect(formatValue(runtime.execute('R')!)).toBe('11 22');
            expect(formatValue(runtime.execute('R')!)).toBe('11 22');
            expect(passes).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('rejects a known infinite source without starting its iterator', () => {
        const runtime = new Interpreter(() => {});
        let started = false;
        try {
            runtime.variables.set('Source', sequence({
                name: 'unbounded', size: { kind: 'infinite' },
                *iterate() { started = true; yield 1n; },
            }));
            expect(() => runtime.execute('(array 10 20) + Source')).toThrow('infinite sequence');
            expect(started).toBe(false);
        } finally { runtime.dispose(); }
    });
});
