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
});
