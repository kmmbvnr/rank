import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import { isRankPlan } from '../src/plan.js';

describe.each([false, true])('deferred binding validation (compilation=%s)', compilation => {
    it('rejects captured array writes before any program effects run', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            expect(() => runtime.execute([
                'use io', '"started" print', 'A = array 1 2', "Plan' = A * 2", 'A 0 = 9',
            ].join('\n'))).toThrowError('A is read-only because plan Plan reads it');
            expect(output).toEqual([]);
            expect(runtime.variables.has('A')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('rejects writes to a deferred parameter even in an uncalled function', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute("fun X' change\n X 0 += 1\n return X\nend"))
                .toThrowError('X is a deferred parameter and is read-only');
        } finally { runtime.dispose(); }
    });

    it('keeps captured array data stable when an alias is mutated', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute([
                'A = array 1 2', 'Alias = A', "Plan' = A * 2", 'Alias 0 = 9', 'Plan 0',
            ].join('\n'))).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('preserves writes before a plan binding and to an explicit copy afterwards', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute([
                'use sequences', 'A = array 1 2', 'A 0 = 3', "Plan' = A * 2",
                'Work = A copy', 'Work 0 = 9', 'A 0',
            ].join('\n'))).toBe(3n);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['Q = new queue', 'Q push 9'],
        ['Q = new set', 'Q add 9'],
        ['Q = new deque', 'Q pushfront 9'],
        ['Q = new heap', 'Q 1 9 enqueue'],
    ])('rejects receiver mutation before effects: %s / %s', (setup, write) => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            expect(() => runtime.execute([
                'use algo', 'use io', '"started" print', setup, "Plan' = Q len", write,
            ].join('\n'))).toThrowError('Q is read-only because plan Plan reads it');
            expect(output).toEqual([]);
            expect(runtime.variables.has('Q')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('rejects transitive mutation through a helper before effects', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            expect(() => runtime.execute([
                'use algo', 'use io', 'fun Items leaf', ' Items push 9', ' return 0', 'end',
                'fun Items forward = Items leaf', '"started" print', 'Q = new queue',
                "Plan' = Q len", 'Q forward',
            ].join('\n'))).toThrowError('Q is read-only because plan Plan reads it');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('allows a read-only callback even when another call uses a mutating one', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute([
                'use algo', 'fun X act op = X op', 'Q = new queue', 'Q push 3',
                "Plan' = Q len", 'Other = new queue', 'Other push 9', 'Other act pop', 'Q act peek',
            ].join('\n'))).toBe(3n);
        } finally { runtime.dispose(); }
    });

    it('runs a helper in a deferred RHS before protecting the name it mentions', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute([
                'use algo', 'fun Items append', ' Items push 1', ' return Items len', 'end',
                'Q = new queue', "Total' = Q append", 'array (Q len) Total Total',
            ].join('\n'))).toMatchObject({ shape: [3], items: [1n, 1n, 1n] });
        } finally { runtime.dispose(); }
    });

    it.each(['earlier cell', 'import'] as const)('checks a mutating helper from an %s', origin => {
        const helper = 'use algo\nfun Items append\n Items push 9\n return 0\nend';
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation,
            loadModule: () => ({ id: 'helpers.ra', source: helper }) });
        try {
            if (origin === 'earlier cell') runtime.execute(helper);
            const setup = origin === 'import' ? 'use "helpers" as H' : '';
            const call = origin === 'import' ? 'Q H.append' : 'Q append';
            expect(() => runtime.execute([
                'use algo', 'use io', setup, '"started" print', 'Q = new queue', "Plan' = Q len", call,
            ].join('\n'))).toThrowError('Q is read-only because plan Plan reads it');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });
});

describe.each([false, true])('compound deferred bindings (compilation=%s)', compilation => {
    const answer = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use numbers\n' + source);
            const value = runtime.variables.get('Answer');
            return value === undefined ? undefined : formatValue(value);
        } catch (error) { return String(error instanceof RankError ? error.format() : error); }
        finally { runtime.dispose(); }
    };

    it.each([
        ['array 7 8 9', '+', '2'], ['array 7 8 9', '-', '2'], ['array 7 8 9', '*', '2'],
        ['array 7 8 9', '//', '2'], ['array 7 8 9', 'mod', '4'], ['array 7 8 9', '**', '2'],
        ['array 7 8 9', '/', '2'], ['5', '+', 'array 1 2'], ['7', 'mod', '4'],
        ['array true false', 'and', 'array true true'], ['array true false', 'or', 'array false false'],
        ['array true false', 'xor', 'array true true'], ['true', 'or', '1 // 0 equal 1'],
        ['array 1 2', '+', 'array 1 2 3'], ['array 1 2', '//', '0'],
    ])('%s %s= %s equals the written-out plan', (start, operator, right) => {
        const compound = `X' = ${start}\nX' ${operator}= ${right}\nAnswer = X`;
        const written = `X' = ${start}\nX' = X ${operator} ${right}\nAnswer = X`;
        // An error points at the statement; only the position may differ.
        const message = (text: string | undefined) => text?.split('\n')[0];
        expect(message(answer(compound))).toBe(message(answer(written)));
    });

    it('locates a failing compound plan at its statement', () => {
        expect(answer("X' = array 1 2\nX' += array 1 2 3\nAnswer = X")).toContain('at <input>:3:1');
    });

    it('captures the previous value and stays lazy until demanded', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("use numbers\nA = array 1 2\nX' = A\nX' += 10\nA = array 100 200\nAnswer = X");
            expect(formatValue(runtime.variables.get('Answer')!)).toBe('11 12');
            expect(isRankPlan(runtime.variables.get('X')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('chains a mask over a range in one plan', () => {
        const source = "N = 1 till 1000\nMask' = N mod 3 equal 0\nMask' or= N mod 5 equal 0\nAnswer = N Mask sum";
        expect(answer(source)).toBe('233168');
    });

    it('does not evaluate a plan for an unused compound binding', () => {
        expect(answer("Unused' = array 1 0\nUnused' //= 0\nAnswer = 7")).toBe('7');
    });

    it('reports an undefined name at the binding', () => {
        expect(answer("Missing' += 1\nAnswer = 1")).toContain('Missing');
    });
});
