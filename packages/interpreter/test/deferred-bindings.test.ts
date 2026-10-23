import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

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
