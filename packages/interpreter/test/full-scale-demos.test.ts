import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

// These default bounds are too large for the uncompiled Rank reference.
// Their small fixtures still compare both modes in the corpus audits.
it.each([
    ['299_threesimilar.ra', 549936643n],
    ['426_boxball.ra', 31591886008n],
] as const)('checks the full compiled answer for %s', (file, expected) => {
    const url = new URL(`../../../demos/euler/${file}`, import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(expected);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);

// Independent representation: match individual balls and boxes, rather than
// the Rank program's run stack and difference table of removal rounds.
function perBallReference(last: number): number {
    let stack = new Uint32Array(1024), depth = 0, state = 290797, total = 0;
    const close = () => {
        if (!depth) return;
        const round = stack[--depth] + 1;
        total += 2 * round - 1;
        if (depth && stack[depth - 1] < round) stack[depth - 1] = round;
    };
    for (let run = 0; run <= last; run++) {
        const count = state % 64 + 1;
        // The generator's product is below 2^53, so integer arithmetic is exact.
        state = state * state % 50515093;
        if (run % 2 === 0) {
            if (depth + count > stack.length) {
                const next = new Uint32Array(Math.max(depth + count, stack.length * 2));
                next.set(stack);
                stack = next;
            }
            stack.fill(0, depth, depth + count);
            depth += count;
        } else {
            for (let box = 0; box < count && depth; box++) close();
        }
    }
    while (depth) close();
    return total;
}

it('cross-checks the full box-ball answer with a per-ball reference', () => {
    for (const [last, answer] of [[10, 8912], [100, 170376], [1000, 1714252], [10000000, 31591886008]])
        expect(perBallReference(last)).toBe(answer);
}, 30_000);
