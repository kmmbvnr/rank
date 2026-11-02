import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/328_lowestcost.ra', import.meta.url), 'utf8');

describe('Euler 328 monotone frontier', () => {
    it('retains the full golden and executes the numeric loop', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(260511850222n);
            expect(diagnostics.numberLoops).toBeGreaterThan(0);
            expect(diagnostics.numberLoopOverflows).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each([true, false])('keeps the conservative fallback (compilation=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('200000 costs', '1000 costs').replace('Ordered = true', 'Ordered = false'));
            expect(runtime.variables.get('Answer')).toBe(3120345n);
        } finally { runtime.dispose(); }
    });
});
