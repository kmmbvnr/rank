import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/750_cardstacking.ra', import.meta.url), 'utf8');
// Original scalar recurrence, with no weighted table or flattened indexing.
function direct(cards: number): bigint {
    if (cards < 2) return 0n;
    const place = Array(cards + 1).fill(0n) as bigint[];
    let label = 1n;
    for (let i = 1; i <= cards; i++) { label = label * 3n % BigInt(cards + 1); place[Number(label)] = BigInt(i); }
    const cost = Array.from({ length: cards + 1 }, () => Array(cards + 1).fill(0n) as bigint[]);
    for (let size = 2; size <= cards; size++) for (let start = 1; start + size - 1 <= cards; start++) {
        const end = start + size - 1;
        let best: bigint | undefined;
        for (let cut = start; cut < end; cut++) {
            const delta = place[cut] - place[end];
            const next = cost[start][cut] + cost[cut + 1][end] + (delta < 0n ? -delta : delta);
            if (best === undefined || next < best) best = next;
        }
        cost[start][end] = best!;
    }
    return cost[1][cards];
}
for (const compilation of [false, true]) describe(`Euler 750, compilation=${compilation}`, () => {
    it.each([0, 1, 2, 3, 4, 5, 6, 8, 10, 16, 24, 32, 64])('matches the scalar recurrence at Cards=%s', cards => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Cards integer = 976', `Cards = ${cards}`));
            expect(runtime.variables.get('Answer')).toBe(direct(cards));
        } finally { runtime.dispose(); }
    });
});
