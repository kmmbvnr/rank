import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

const recipes = [
    ['fun X visible\n X print\n return true\nend', '1 to 3 filter visible', 6n, ['1', '2', '3']],
    ['fun X visible\n X print\n return X * 2\nend', '(1 to 3) visible rank 0', 12n, ['1', '2', '3']],
    ['fun X visible\n X print\n return X * 2\nend', '(array 1 2 3) visible rank 0', 12n, ['1', '2', '3']],
    ['fun A B combine\n B print\n return A + B\nend', '1 to 3 scan combine', 10n, ['2', '3']],
    ['fun X visible\n X print\n return X * 2\nend\npipeline = visible abs',
        '(1 to 3) pipeline rank 0', 12n, ['1', '2', '3']],
] as const;

describe.each([false, true])('effects in explicit plans (compilation=%s)', compilation => {
    it.each(recipes)('repeats callback effects on demand and retains an explicit result: %s', (setup, recipe, expected, pass) => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute(`use io\nuse numbers\n${setup}\nPlan' = ${recipe}`);
            expect(output).toEqual([]);
            expect(host.execute('Plan sum')).toBe(expected);
            expect(output).toEqual(pass);
            expect(host.execute('Plan sum')).toBe(expected);
            expect(output).toEqual([...pass, ...pass]);
            host.execute('Saved = Plan');
            expect(output).toEqual([...pass, ...pass, ...pass]);
            expect(host.execute('Saved sum')).toBe(expected);
            expect(host.execute('Saved sum')).toBe(expected);
            expect(output).toEqual([...pass, ...pass, ...pass]);
        } finally { host.dispose(); }
    });

    it.each([false, true])('keeps immediate helper work separate from a returned plan (planned=%s)', planned => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute([
                'use io', 'fun X visible', ' X print', ' return X * 2', 'end',
                "fun X' transform", ' "entered" print', " Returned' = X visible rank 0", ' return Returned', 'end',
                planned ? "Input' = 1 to 3" : 'Input = array 1 2 3', "Plan' = Input transform",
            ].join('\n'));
            const built = ['entered'];
            expect(output).toEqual(built);
            expect(host.execute('Plan sum')).toBe(12n);
            expect(output).toEqual([...built, '1', '2', '3']);
            expect(host.execute('Plan sum')).toBe(12n);
            expect(output).toEqual([...built, '1', '2', '3', '1', '2', '3']);
        } finally { host.dispose(); }
    });

    it('allows an unannotated host callback to repeat its effects', () => {
        let calls = 0;
        const host = new Interpreter(undefined, { compilation, md5: () => { calls++; return new Uint8Array(16); } });
        try {
            host.execute("use crypto\nfun X accepted = (X text md5 len) equal 16\nPlan' = 1 to 3 filter accepted");
            expect(calls).toBe(0);
            expect(host.execute('Plan sum')).toBe(6n);
            expect(calls).toBe(3);
            expect(host.execute('Plan sum')).toBe(6n);
            expect(calls).toBe(6);
        } finally { host.dispose(); }
    });

    it('restarts a failed computation without retaining its successful prefix', () => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute([
                'use io', 'fun X visible', ' X print', ' if X equal 2', '  return 1 // 0', ' end',
                ' return true', 'end', "Plan' = 1 to 3 filter visible",
            ].join('\n'));
            expect(output).toEqual([]);
            expect(() => host.execute('Plan sum')).toThrow();
            expect(output).toEqual(['1', '2']);
            expect(() => host.execute('Plan sum')).toThrow();
            expect(output).toEqual(['1', '2', '1', '2']);
        } finally { host.dispose(); }
    });

    it('accepts stored record configuration for a ranked callback', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'Config = record', ' .factor = 2', 'end',
                'fun X scale .by Settings = X * Settings .factor',
                "Plan' = (1 to 3) scale by Config rank 0",
                'Config = record', ' .factor = 10', 'end',
            ].join('\n'));
            expect(formatValue(host.execute('Plan')!)).toBe('2 4 6');
            expect(formatValue(host.execute('Plan')!)).toBe('2 4 6');
        } finally { host.dispose(); }
    });
});
