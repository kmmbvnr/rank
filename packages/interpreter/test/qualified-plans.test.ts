import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankPlan } from '../src/index.js';

function moduleRuntime(source: string, compilation: boolean, output?: string[]) {
    return new Interpreter(text => output?.push(text), {
        compilation, loadModule: () => ({ id: 'data.ra', source }),
    });
}

describe.each([false, true])('qualified plan dependencies (compilation=%s)', compilation => {
    it('captures a qualified value before its module binding is replaced', () => {
        const host = moduleRuntime('A = array 1 2', compilation);
        try {
            host.execute('use "data" as H\nH.run');
            host.execute("Plan' = H.A * 2");
            host.execute('H.A = array 7 8');
            expect(formatValue(host.execute('Plan')!)).toBe('2 4');
            expect(formatValue(host.execute('H.A')!)).toBe('7 8');
            expect(formatValue(host.execute('Plan')!)).toBe('2 4');
        } finally { host.dispose(); }
    });

    it.each(['H.Plan ignore', '(H.Plan + 1) ignore'])(
        'passes a qualified plan to a deferred parameter without demanding it: %s', expression => {
            const host = moduleRuntime("Plan' = 1 // 0", compilation);
            try {
                host.execute('use "data" as H\nH.run\nfun X\' ignore = 7\nfun X consume = 7');
                expect(host.execute(expression)).toBe(7n);
                expect(() => host.execute('H.Plan consume')).toThrow();
            } finally { host.dispose(); }
        },
    );

    it('returns a qualified plan without adding a demand boundary', () => {
        const host = moduleRuntime("Plan' = 1 // 0", compilation);
        try {
            host.execute('use "data" as H\nH.run\nfun relay\n return H.Plan\nend');
            host.execute("Result' = relay");
            expect(isRankPlan(host.variables.get('Result')!)).toBe(true);
            expect(() => host.execute('Result')).toThrow();
        } finally { host.dispose(); }
    });

    it('stages a qualified user call once and replays its surrounding recipe', () => {
        const output: string[] = [];
        const host = moduleRuntime([
            'use io', 'fun X\' transform', ' "entered" print', ' return X * 2', 'end',
        ].join('\n'), compilation, output);
        try {
            host.execute('use "data" as H');
            host.execute("Input' = 1 to 4\nResult' = (Input H.transform) sum + 1");
            expect(output).toEqual(['entered']);
            expect(host.execute('Result')).toBe(21n);
            expect(host.execute('Result')).toBe(21n);
            expect(output).toEqual(['entered']);
        } finally { host.dispose(); }
    });

    it('stages a qualified nullary producer before demand', () => {
        const output: string[] = [];
        const host = moduleRuntime([
            'use io', 'fun make', ' "entered" print', ' return 1 to 4', 'end',
        ].join('\n'), compilation, output);
        try {
            host.execute('use "data" as H');
            host.execute("Result' = H.make sum");
            expect(output).toEqual(['entered']);
            expect(host.execute('Result')).toBe(10n);
            expect(host.execute('Result')).toBe(10n);
            expect(output).toEqual(['entered']);
        } finally { host.dispose(); }
    });
});
