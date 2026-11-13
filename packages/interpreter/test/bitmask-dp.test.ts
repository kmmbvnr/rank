import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

it('compiles the unchanged Euler 345 DP and retains the exact answer', () => {
    const source = readFileSync(new URL('../../../demos/euler/345_matrixsum.ra', import.meta.url), 'utf8');
    const runtime = new Interpreter(() => {});
    const diagnostics = new RuntimeDiagnostics();
    try {
        let result;
        diagnostics.run(() => { result = runtime.execute(source); });
        expect(result).toBe(13938n);
        expect(runtime.variables.get('Answer')).toBe(13938n);
        expect(diagnostics.compiledLoops).toBe(1);
    } finally { runtime.dispose(); }
});
