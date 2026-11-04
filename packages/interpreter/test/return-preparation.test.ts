import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

for (const compilation of [false, true]) {
    it(`rechecks native effects after preparing a return (${compilation})`, () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute('use io\nuse numbers\npure = abs\noutput = print');
            runtime.variables.set('action', runtime.variables.get('pure')!);
            runtime.execute("fun X' report\n return (X sum) action\nend\nInput = array 1 2 3");
            runtime.execute("First' = Input report");
            expect(output).toEqual([]);
            expect(runtime.execute('First')).toBe(6n);
            runtime.variables.set('action', runtime.variables.get('output')!);
            runtime.execute("Second' = Input report");
            expect(output).toEqual(['6']);
            expect(runtime.execute('Second')).toBe(6n);
            expect(output).toEqual(['6']);
            runtime.variables.set('action', runtime.variables.get('pure')!);
            runtime.execute("Third' = Input report");
            expect(runtime.execute('Third')).toBe(6n);
            expect(output).toEqual(['6']);
        } finally { runtime.dispose(); }
    });
}
