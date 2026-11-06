import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { MemoryIo } from './support.js';
const url = new URL('../../../demos/euler/424_kakuro.ra', import.meta.url);
const source = readFileSync(url, 'utf8');
const input = fileURLToPath(new URL('../../../demos/euler/fixtures/0424_kakuro200.txt', import.meta.url));
function runtime(count: number, options = {}) {
    return new Interpreter(() => {}, { ...options, sourceId: fileURLToPath(url),
        args: [`--count=${count}`, `--input=${input}`], io: new MemoryIo({ [input]: readFileSync(input, 'utf8') }) });
}

describe('Euler 424 constrained Kakuro maps', () => {
    it.each([[0, 0n], [1, 8426039571n], [2, 16945686873n], [3, 19965339657n]] as const)
        ('preserves the first %s maps in all execution modes', (count, expected) => {
            for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
                const r = runtime(count, options);
                try { r.execute(source); expect(r.variables.get('Answer')).toBe(expected); }
                finally { r.dispose(); }
            }
        });

    it('checks all 200 puzzles through the numeric bit-mask helper', () => {
        const r = runtime(200), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => r.execute(source));
            expect(r.variables.get('Answer')).toBe(1059760019628n);
            expect(diagnostics.numberFunctions).toBeGreaterThan(1000);
            expect(diagnostics.numberFunctionFallbacks).toBe(0);
            expect(diagnostics.numberLoopOverflows).toBe(0);
        } finally { r.dispose(); }
    }, 60000);
});
