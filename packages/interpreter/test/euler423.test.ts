import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/423_consecutive.ra', import.meta.url), 'utf8');
// Independent exact counts: five choices change the face; one repeats it.
function oracle(limit: number): bigint {
    let row = [6n], total = 0n, primeCount = 0;
    for (let n = 1; n <= limit; n++) {
        if (n > 1) {
            const next = Array<bigint>(n).fill(0n);
            for (let k = 0; k < row.length; k++) {
                next[k] += 5n * row[k];
                next[k + 1] += row[k];
            }
            row = next;
        }
        let prime = n >= 2;
        for (let divisor = 2; divisor * divisor <= n; divisor++) if (n % divisor === 0) prime = false;
        if (prime) primeCount++;
        for (let k = 0; k <= Math.min(primeCount, row.length - 1); k++) total += row[k];
    }
    return total % 1000000007n;
}

describe('Euler 423 modular recurrence', () => {
    it('checks the full fifty-million limit', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source);
            expect(answerOf(runtime)).toBe(653972374n);
        } finally { runtime.dispose(); }
    }, 30000);

    it.each([0, 1, 2, 3, 4, 5, 6, 10, 11, 20, 24, 50, 75, 100, 150, 200])
        ('matches exact die-count DP at limit %s on all backends', limit => {
            for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
                const runtime = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`] });
                try {
                    runtime.execute(source);
                    expect(answerOf(runtime)).toBe(oracle(limit));
                } finally { runtime.dispose(); }
            }
        });

    it('keeps both loops numeric without a snapshot of the private inverse table', () => {
        const runtime = new Interpreter(() => {}, { args: ['--l=100000'] });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(answerOf(runtime)).toBe(772698120n);
            expect(diagnostics.numberLoops).toBe(2);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.nativeSequenceCopies).toBe(1);
            expect(Object.values(diagnostics.costs).reduce((sum, cost) => sum + cost.copiedBytes, 0)).toBe(0);
        } finally { runtime.dispose(); }
    });
});
