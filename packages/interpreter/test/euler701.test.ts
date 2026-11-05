import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const demo = readFileSync(new URL('../../../demos/euler/701_randomconnectedarea.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler701-original.ra', import.meta.url), 'utf8');
const dimensions = (source: string, width: number, height: number) => source
    .replace(/arg (Width|Ww) integer = 7/, `Width = ${width}`)
    .replace(/arg (Height|Hh) integer = 7/, `Height = ${height}`)
    .replace(/\bWw\b/g, 'Width').replace(/\bHh\b/g, 'Height');

// Independent enumeration: flood-fill every binary board, with no frontier
// encoding or transition formulas shared with the demo.
function exhaustive(width: number, height: number): bigint {
    const size = width * height;
    let total = 0n;
    for (let board = 0; board < 2 ** size; board++) {
        let seen = 0, best = 0;
        for (let cell = 0; cell < size; cell++) {
            if (!(board & (1 << cell)) || seen & (1 << cell)) continue;
            const queue = [cell];
            seen |= 1 << cell;
            for (let head = 0; head < queue.length; head++) {
                const at = queue[head], row = Math.floor(at / width), col = at % width;
                for (const next of [col ? at - 1 : -1, col + 1 < width ? at + 1 : -1,
                    row ? at - width : -1, row + 1 < height ? at + width : -1]) {
                    if (next < 0 || !(board & (1 << next)) || seen & (1 << next)) continue;
                    seen |= 1 << next;
                    queue.push(next);
                }
            }
            best = Math.max(best, queue.length);
        }
        total += BigInt(best);
    }
    return total;
}

for (const compilation of [false, true]) describe(`Euler 701 (${compilation})`, () => {
    it.each([[1, 1], [1, 7], [7, 1], [1, 8], [8, 1], [2, 2], [2, 4], [3, 3], [3, 4], [4, 3]])
       ('matches exhaustive boards for %sx%s', (width, height) => {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(dimensions(demo, width, height));
                expect(runtime.variables.get('Sum')).toBe(exhaustive(width, height));
                const state = runtime.variables.get('State');
                expect(state).toBeDefined();
                expect(runtime.execute('Ways sum')).toBe(1n << BigInt(width * height));
            } finally { runtime.dispose(); }
        });

    it('matches the original DP at 3x3', () => {
        const totals: unknown[] = [];
        for (const source of [demo, original]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(dimensions(source, 3, 3));
                totals.push(runtime.variables.get('Sum') ?? runtime.variables.get('Tot'));
            } finally { runtime.dispose(); }
        }
        expect(totals[0]).toBe(1866n);
        expect(totals[1]).toBe(totals[0]);
    });

    it.each([[0, 1], [1, 0], [8, 8], [10, 7]])('rejects unsupported grid %sx%s', (width, height) => {
        const runtime = new Interpreter(() => {}, { compilation });
        try { expect(() => runtime.execute(dimensions(demo, width, height))).toThrow(); }
        finally { runtime.dispose(); }
    });
});
