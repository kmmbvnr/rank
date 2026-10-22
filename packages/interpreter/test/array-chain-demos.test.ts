import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

describe.each([false, true])('issue 402 eager array chains (compilation=%s)', compilation => {
    it.each([
        ['407_idempotents', 314034n],
        ['408_admissiblepaths', 341920854n],
    ] as const)('runs %s without intermediate copy calls', (name, expected) => {
        const original = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const source = original.replace(/ copy\b/g, '');
        expect(source).not.toBe(original);
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation, args: ['--n', '1000'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected);
            expect(output).toEqual([expected.toString()]);
        } finally { runtime.dispose(); }
    });
});
