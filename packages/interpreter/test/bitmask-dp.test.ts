import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

it('compiles the unchanged Euler 345 DP and retains the exact answer', () => {
    const source = readFileSync(new URL('../../../demos/euler/345_matrixsum.ra', import.meta.url), 'utf8');
    const output: string[] = [];
    const runtime = new Interpreter(value => output.push(value));
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(output).toEqual(['13938']);
        expect(runtime.variables.get('Answer')).toBe(13938n);
        expect(diagnostics.compiledLoops).toBe(1);
    } finally { runtime.dispose(); }
});
