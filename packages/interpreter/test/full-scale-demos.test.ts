import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

// Retain full bounds and require compiled execution here.
// Fixture-level reference comparisons belong to the corpus audits.
it.each([
    ['257_angularbisectors.ra', 139012411n],
    ['258_laggedfibonacci.ra', 12747994n],
    ['259_reachablenumbers.ra', 20101196798n],
    ['275_balancedsculptures.ra', 15030564n],
    ['287_quadtree.ra', 313135496n],
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

it('compiles the full Euler 255 interval traversal and preserves the exact total', () => {
    const url = new URL('../../../demos/euler/255_roundedroots.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Total')).toBe(400266100622279n);
        expect(runtime.variables.get('Count')).toBe(90000000000000n);
        expect(runtime.variables.get('Answer')).toBe(4.447401118);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks the full compiled Euler 288 tail without Number overflow', () => {
    const url = new URL('../../../demos/euler/288_enormousfactorial.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(605857431263981935n);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(2);
        // The short prefix needs exact arithmetic; its speculative Number
        // attempt overflows once. The ten-million-step tail stays in Number.
        expect(diagnostics.numberLoopOverflows).toBe(1);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(3);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks the full compiled Euler 289 with private integer index stores', () => {
    const url = new URL('../../../demos/euler/289_eulerianloops.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(6567944538n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(154);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.indexWrites).toBeGreaterThan(0);
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

it('checks the full Euler 260 exact-bitset answer', () => {
    const url = new URL('../../../demos/euler/260_stonegame.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(167542057n);
        expect(diagnostics.compiledLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('compiles the full Euler 261 squarefree-table search', () => {
    const url = new URL('../../../demos/euler/261_pivotalsquare.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(238890850232021n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(2);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);


it('compiles the full Euler 262 contour and preserves the sampled route', () => {
    const url = new URL('../../../demos/euler/262_mountainrange.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(2531.205);
        expect(runtime.variables.get('Best')).toBeCloseTo(2531.2047740264857, 8);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(3);
        expect(diagnostics.fallbacks['loop:container-write-type:ForStatement']).toBeUndefined();
    } finally { runtime.dispose(); }
}, 60_000);

// The full reference input remains a manual-budget workload.
it('checks the full compiled answer for Euler 272', () => {
    const url = new URL('../../../demos/euler/272_modularcubes.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(8495585919506151122n);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('compiles the full Euler 283 reduced-divisor search with an exact wide total', () => {
    const url = new URL('../../../demos/euler/283_integertriangles.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(28038042525570324n);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(2);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);
