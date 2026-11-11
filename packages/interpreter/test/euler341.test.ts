import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/341_golomb.ra', import.meta.url), 'utf8');
const helper = source.replace('arg Count integer = 1000000', '').replace('Count cubes print', '');
// Build the sequence itself, independent of weighted-prefix/run inversion.
const values = new Int32Array(1000001);
values[1] = 1;
for (let i = 2; i < values.length; i++) values[i] = 1 + values[i - values[values[i - 1]]];

describe('Euler 341 self-describing runs', () => {
    for (const compilation of [true, false]) {
        it(`matches direct Golomb values at every small cube (compilation=${compilation})`, () => {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(helper);
                let total = 0n;
                for (let count = 0; count <= 101; count++) {
                    if (count >= 2) total += BigInt(values[(count - 1) ** 3]);
                    runtime.execute(`Actual = ${count} cubes`);
                    expect(runtime.variables.get('Actual'), `Count=${count}`).toBe(total);
                }
                for (const n of [1, 2, 3, 4, 5, 10, 100, 1000, 1000000]) {
                    runtime.execute(`Actual = ${n} term`);
                    expect(runtime.variables.get('Actual'), `term(${n})`).toBe(BigInt(values[n]));
                }
            } finally { runtime.dispose(); }
        }, 60000);

        it(`keeps the complete default answer (compilation=${compilation})`, () => {
            const output: string[] = [], diagnostics = new RuntimeDiagnostics();
            const runtime = new Interpreter(text => output.push(text.trim()), { compilation });
            try {
                diagnostics.run(() => runtime.execute(source));
                expect(output.at(-1)).toBe('56098610614277014');
                expect(diagnostics.indexWrites).toBe(25639);
                expect(diagnostics.typedArrayPublishedCells).toBe(0);
            } finally { runtime.dispose(); }
        }, 120000);
    }

    it('keeps the original array recurrence in one mixed private region', () => {
        const original = readFileSync(new URL('../../../benchmarks/experiments/euler341-original.ra', import.meta.url), 'utf8');
        const output: string[] = [], diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(text => output.push(text.trim()));
        try {
            diagnostics.run(() => runtime.execute(original));
            expect(output.at(-1)).toBe('56098610614277014');
            expect(diagnostics.mixedIntegerLoops).toBe(1);
            expect(diagnostics.compiledLoops).toBe(1);
            expect(diagnostics.numberLoopOverflows).toBe(1);
        } finally { runtime.dispose(); }
    }, 20000);
});
