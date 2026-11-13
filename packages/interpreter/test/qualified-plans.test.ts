import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

function moduleRuntime(source: string, compilation: boolean, output?: string[]) {
    return new Interpreter(text => output?.push(text), {
        compilation, loadModule: () => ({ id: 'data.ra', source }),
    });
}

describe.each([false, true])('qualified plan dependencies (compilation=%s)', compilation => {
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
