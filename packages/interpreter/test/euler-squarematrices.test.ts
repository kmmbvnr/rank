import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/420_squarematrices.ra', import.meta.url), 'utf8');
// Enumerate positive matrix roots; independent of the coprime trace formula.
const bound = 200, roots = new Map<string, { trace: number; count: number }>();
for (let a = 1; a * a < bound; a++) for (let d = 1; a * a + d * d + 2 < bound; d++) {
    const limit = Math.floor((bound - 1 - a * a - d * d) / 2);
    for (let b = 1; b <= limit; b++) for (let c = 1; b * c <= limit; c++) {
        const square = [a * a + b * c, b * (a + d), c * (a + d), d * d + b * c], key = square.join(',');
        const entry = roots.get(key);
        if (entry) entry.count++;
        else roots.set(key, { trace: square[0] + square[3], count: 1 });
    }
}
const oracle = Array<bigint>(bound + 1).fill(0n);
for (const { trace, count } of roots.values()) if (count >= 2) oracle[trace + 1]++;
for (let n = 1; n <= bound; n++) oracle[n] += oracle[n - 1];
function run(n: number, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        return { answer: runtime.variables.get('Answer'), diagnostics };
    } finally { runtime.dispose(); }
}

it.each([0, 1, 2, 3, 4, 5, 10, 11, 12, 19, 20, 30, 50, 75, 100, 150, 199, 200])
('matches independent positive-matrix roots below %s', n => {
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        expect(run(n, options).answer).toBe(oracle[n]);
    }
});

it.each([[1000, 1019n], [100000, 518497n]])('retains checkpoint %s in each engine', (n, answer) => {
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) expect(run(n, options).answer).toBe(answer);
});

it('compiles the full prefix/query loop with the exact full answer', () => {
    const result = run(10000000);
    expect(result.answer).toBe(145159332n);
    expect(result.diagnostics.numberLoops).toBe(2);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
}, 120_000);
