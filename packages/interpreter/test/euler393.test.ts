import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/393_ants.ra', import.meta.url), 'utf8');

// Direct ant destinations: no shared destination and no reversed edge.
// Independent of row masks, matchings and symmetry representatives.
function enumerate(n: number): bigint {
    const size = n * n, destination = Array<number>(size).fill(-1), occupied = Array<boolean>(size).fill(false);
    const adjacent = Array.from({length: size}, (_, p) => {
        const row = Math.floor(p / n), col = p % n;
        return [row > 0 ? p - n : -1, row + 1 < n ? p + n : -1,
            col > 0 ? p - 1 : -1, col + 1 < n ? p + 1 : -1].filter(q => q >= 0);
    });
    const visit = (p: number): bigint => {
        if (p === size) return 1n;
        let ways = 0n;
        for (const q of adjacent[p]) {
            if (occupied[q] || destination[q] === p) continue;
            destination[p] = q;
            occupied[q] = true;
            ways += visit(p + 1);
            destination[p] = -1;
            occupied[q] = false;
        }
        return ways;
    };
    return visit(0);
}

it.each([false, true])('matches direct ant enumeration, compilation=%s', compilation => {
    for (let n = 0; n <= 4; n++) {
        const runtime = new Interpreter(() => {}, {compilation, args: [`--n=${n}`]});
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(enumerate(n));
        } finally {runtime.dispose();}
    }
});

it('retains the exact full answer and compiles the recursive row search', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(112398351350823112n);
        expect(diagnostics.compiledLoops).toBeGreaterThan(0);
        expect(diagnostics.compiledEffectCalls).toBeGreaterThan(0);
        expect(diagnostics.cowCopies).toBe(0);
    } finally {runtime.dispose();}
}, 15000);
