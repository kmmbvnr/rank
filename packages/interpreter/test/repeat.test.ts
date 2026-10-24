import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeValues } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';

for (const compiled of [false, true]) describe(`repeat (compiled=${compiled})`, () => {
    function run(source: string, output: string[] = []): string {
        const runtime = new Interpreter(line => output.push(String(line)), {
            scalarCompilation: compiled, blockCompilation: compiled,
            functionBodyCompilation: compiled, scalarFunctionCompilation: compiled,
            integerLoopCompilation: compiled, tensorFusion: compiled,
        });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    }

    const inc = 'fun X inc = X + 1\n';
    it('returns the initial state for zero and threads one or several calls', () => {
        for (const [count, expected] of [[0, '5'], [1, '6'], [4, '9']] as const) {
            expect(run(`${inc}5 inc repeat ${count}`)).toBe(expected);
        }
        expect(run(`${inc}N = 4\n5 inc repeat N`)).toBe('9');
        expect(run(`${inc}5 inc repeat (2 + 2)`)).toBe('9');
        expect(run(`${inc}5 inc repeat 2 text`)).toBe('7');
    });

    it('passes arrays whole even when the callback declares scalar rank', () => {
        const source = 'use sequences\nfun X inspect rank 0\n return X shape\nend\n';
        expect(run(source + '(array shape 2 3 fill 0) inspect repeat 1')).toBe('2 3');
        expect(run('use sequences\n(array 1 2 3) reverse repeat 2')).toBe('1 2 3');
    });

    it('allows shapes and ranks to change between states without mutating the input', () => {
        const grow = 'fun X grow\n return concat X (array 7)\nend\n';
        expect(run(`use sequences\n${grow}A = array 1\nB = A grow repeat 3\nB`)).toBe('1 7 7 7');
        expect(run(`use sequences\n${grow}A = array 1\nB = A grow repeat 3\nA`)).toBe('1');
        expect(run('use sequences\nfun X wrap\n return array X\nend\nR = 1 wrap repeat 3\nR shape')).toBe('1 1 1');
    });

    it('runs the Queens transition from an empty placement', () => {
        const demo = readFileSync(new URL('../../../demos/classic/queens.ra', import.meta.url), 'utf8');
        const solver = demo.slice(0, demo.indexOf('States len print'));
        for (const [size, count] of [[0, 1], [1, 1], [2, 0], [3, 0], [4, 2], [8, 92]]) {
            expect(run(solver.replace('Size = 8', `Size = ${size}`) + '\nStates shape'))
                .toBe(`${count} ${size}`);
        }
    }, 30_000);

    it('keeps captures and effects sequential and skips zero calls', () => {
        const output: string[] = [];
        const source = 'use io\nfun X solve N\n Step = 2\n fun State next\n  State print\n  return State + Step\n end\n return X next repeat N\nend\n';
        expect(run(source + '1 solve 3', output)).toBe('7');
        expect(output).toEqual(['1', '3', '5']);
        output.length = 0;
        expect(run(source + '1 solve 0', output)).toBe('1');
        expect(output).toEqual([]);
    });

    it('validates counts and unary arity before the first callback', () => {
        for (const count of ['-1', '1.5', '"2"', 'true']) {
            const output: string[] = [];
            expect(() => run('use io\nfun X step\n X print\n return X\nend\n'
                + `1 step repeat ${count}`, output)).toThrow(/repeat count/);
            expect(output).toEqual([]);
        }
        expect(() => run('fun X add Y = X + Y\n1 add repeat 0')).toThrow(/unary function/);
        expect(() => run('1 2 repeat 0')).toThrow(/unary function/);
        expect(() => run(`${inc}1 inc repeat`)).toThrow(/repeat/);
    });

    it('propagates the first callback error without executing later steps', () => {
        const output: string[] = [];
        expect(() => run('use io\nfun X step\n X print\n if X equal 2\n  .Stop raise\n end\n return X + 1\nend\n0 step repeat 5', output)).toThrow();
        expect(output).toEqual(['0', '1', '2']);
    });

    it('supports aliases, pipelines and lexical shadowing of the modifier name', () => {
        expect(run(`${inc}step = inc\n1 step repeat 3`)).toBe('4');
        expect(run('use numbers\nstep = abs integer\n-3 step repeat 2')).toBe('3');
        expect(run('fun X repeat = X + 10\n1 repeat')).toBe('11');
        expect(run('fun X step .by Amount=2\n return X + Amount\nend\n1 step repeat 3')).toBe('7');
        expect(run('fun X iterate op N\n return X op repeat N\nend\n' + inc + '1 iterate inc 3')).toBe('4');
    });

    it('stops after a step with previous/current arguments and returns the new state', () => {
        const done = 'fun Prev done Next = Next at least 3\n';
        expect(run(inc + done + '0 inc repeat 10 till done')).toBe('3');
        expect(run(inc + done + '0 inc repeat 2 till done')).toBe('2');
        expect(run(inc + done + '9 inc repeat 10 till done')).toBe('10');
        expect(run(inc + done + '0 inc repeat 10 till done text')).toBe('3');
        const output: string[] = [];
        expect(run('use io\n' + inc + 'fun Prev done Next\n Prev print\n Next print\n return true\nend\n'
            + '4 inc repeat 10 till done', output)).toBe('5');
        expect(output).toEqual(['4', '5']);
        output.length = 0;
        expect(run('use io\nfun X step\n X print\n return X\nend\n'
            + 'fun Prev done Next\n Prev print\n return true\nend\n4 step repeat 0 till done', output)).toBe('4');
        expect(output).toEqual([]);
    });

    it('preserves the previous array while the step writes, including rank-declared predicates', () => {
        const output: string[] = [];
        const source = 'use io\nuse sequences\nfun A step\n A 0 += 1\n return A\nend\n'
            + 'fun Prev done Next rank 0 0\n Prev print\n Next print\n return Next 0 at least 3\nend\n'
            + 'A = array 0 9\nB = A step repeat 10 till done\n';
        expect(run(source + 'B', output)).toBe('3 9');
        expect(output).toEqual(['0 9', '1 9', '1 9', '2 9', '2 9', '3 9']);
        expect(run(source + 'A')).toBe('0 9');
    });

    it('checks predicate arity at zero and requires a scalar boolean result', () => {
        expect(() => run(inc + '0 inc repeat 0 till inc')).toThrow(/binary predicate/);
        expect(() => run(inc + '0 inc repeat 0 till 5')).toThrow(/binary predicate/);
        for (const result of ['1', 'array true false']) {
            expect(() => run(inc + `fun Prev done Next = ${result}\n0 inc repeat 2 till done`))
                .toThrow(/must return a boolean/);
        }
        expect(() => run(inc + '0 inc repeat 2 till')).toThrow();
        expect(() => run(inc + 'fun Prev done Next = true\n0 inc repeat 2 till done by 2'))
            .toThrow(/does not accept a range step/);
        expect(() => run(inc + 'fun Prev done Next = true\n0 inc repeat -1 till done'))
            .toThrow(/nonnegative/);
    });

    it('propagates predicate errors before another step', () => {
        const output: string[] = [];
        expect(() => run('use io\nfun X step\n X print\n return X + 1\nend\n'
            + 'fun Prev done Next\n .Stop raise\nend\n0 step repeat 10 till done', output)).toThrow();
        expect(output).toEqual(['0']);
    });

    it('supports captured predicates, default words, compound counts and normal ranges', () => {
        expect(run(inc + 'Limit = 0\nfun Prev Next done .by Bound=3\n return Next at least (Bound + Limit)\nend\n'
            + 'stop = done\n0 inc repeat (2 + 3) till stop')).toBe('3');
        expect(run('use sequences\n(0 till 3) array')).toBe('0 1 2');
        expect(run(inc + 'fun Prev done Next = Next at least 3\n(0 inc repeat 5 till done) + 7')).toBe('10');
    });

    it('handles changing shapes and stops without another callback', () => {
        const source = 'use sequences\nfun X grow\n return concat X (array 7)\nend\n'
            + 'fun Prev done Next\n return Next len equal 3\nend\n'
            + 'N = 10\n(array 1) grow repeat N till done';
        expect(run(source)).toBe('1 7 7');
        expect(run('use sequences\n' + inc + '((0 inc repeat 2) till 5) array')).toBe('2 3 4');
    });

    it('evaluates the predicate expression once after the count', () => {
        const output: string[] = [];
        const source = 'use io\nfun X seed\n "seed" print\n return X\nend\n'
            + 'fun X count\n "count" print\n return X\nend\n'
            + 'fun Prev done Next = Next equal 2\n'
            + 'fun X predicate\n "predicate" print\n return done\nend\n';
        expect(run(source + inc + '(0 seed) inc repeat (5 count) till (0 predicate)', output)).toBe('2');
        expect(output).toEqual(['seed', 'count', 'predicate']);
    });

    it('uses repeat in k-means without changing zero/one-step or convergence behavior', () => {
        const demo = readFileSync(new URL('../../../demos/deepml/017_kmeans.ra', import.meta.url), 'utf8');
        const source = demo + '\nPoints = array shape 4 1 fill 0\n'
            + 'Points # 0 = array 0 2 3 10\nCenters = array shape 2 1 fill 0\nCenters 1 0 = 3\n';
        expect(run(source + 'Points 2 Centers 0 k_means')).toBe('0 3');
        expect(run(source + 'Points 2 Centers 1 k_means')).toBe('0 5');
        expect(run(source + 'Points 2 Centers 10 k_means')).toBe('1.6667 10');
    });

    it('evaluates the initial state and count only once before the steps', () => {
        const output: string[] = [];
        const source = 'use io\nfun X seed\n "seed" print\n return X\nend\n'
            + 'fun X rounds\n "count" print\n return X\nend\n'
            + 'fun X step\n X print\n return X + 1\nend\n';
        expect(run(source + '(1 seed) step repeat (3 rounds)', output)).toBe('4');
        expect(output).toEqual(['seed', 'count', '1', '2', '3']);
    });
});

it('honors cancellation even for a native whole-state callback', () => {
    const runtime = new Interpreter();
    const signal = new Int32Array(new SharedArrayBuffer(4));
    let calls = 0;
    runtime.variables.set('step', native('step', 1, args => {
        calls++;
        Atomics.store(signal, 0, 1);
        return args[0];
    }));
    try {
        expect(() => withInterrupt(signal, () => runtime.execute('1 step repeat 1000000'))).toThrow(InterruptedError);
        expect(calls).toBeGreaterThan(0);
        expect(calls).toBeLessThan(1000000);
    } finally { runtime.dispose(); }
});

it('does not claim the initial shape survives an unknown number of transformations', () => {
    const prefix = 'fun X wrap\n return array X\nend\n';
    const zero = analyzeValues(parse(`${prefix}R = 1 wrap repeat 0`)).bindings.get('R');
    expect(zero?.types).toEqual(['integer']);
    expect(zero?.rank).toBe(0);
    const result = analyzeValues(parse(`${prefix}R = 1 wrap repeat 3`)).bindings.get('R');
    expect(result?.rank).toBeUndefined();
});
