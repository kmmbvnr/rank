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
    });

    it('keeps captures and effects sequential and skips zero calls', () => {
        const output: string[] = [];
        const source = 'use io\nfun X N solve\n Step = 2\n fun State next\n  State print\n  return State + Step\n end\n return X next repeat N\nend\n';
        expect(run(source + '1 3 solve', output)).toBe('7');
        expect(output).toEqual(['1', '3', '5']);
        output.length = 0;
        expect(run(source + '1 0 solve', output)).toBe('1');
        expect(output).toEqual([]);
    });

    it('validates counts and unary arity before the first callback', () => {
        for (const count of ['-1', '1.5', '"2"', 'true']) {
            const output: string[] = [];
            expect(() => run('use io\nfun X step\n X print\n return X\nend\n'
                + `1 step repeat ${count}`, output)).toThrow(/repeat count/);
            expect(output).toEqual([]);
        }
        expect(() => run('fun X Y add = X + Y\n1 add repeat 0')).toThrow(/unary function/);
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
