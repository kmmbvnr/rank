import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { withoutReturn, answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/524_firstsort2.ra', import.meta.url), 'utf8');
const full = 2432925835413407847n;

function run(k: bigint, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--k=${k}`] });
    try {
        runtime.execute(source);
        return answerOf(runtime);
    } finally { runtime.dispose(); }
}

function sortingCost(order: number[]): number {
    const values = order.slice();
    let moves = 0;
    for (;;) {
        let at = 1;
        while (at < values.length && values[at - 1] < values[at]) at++;
        if (at === values.length) return moves;
        values.unshift(values.splice(at, 1)[0]);
        moves++;
    }
}

// Find the minimum rank by actually running First Sort on every permutation.
function bruteRanks(): bigint[] {
    const ranks: bigint[] = [];
    for (let n = 1; n <= 8; n++) {
        const order: number[] = [], used = new Uint8Array(n);
        let rank = 0n;
        function visit(): void {
            if (order.length === n) {
                rank++;
                const cost = sortingCost(order);
                if (ranks[cost] === undefined || rank < ranks[cost]) ranks[cost] = rank;
                return;
            }
            for (let value = 0; value < n; value++) if (!used[value]) {
                used[value] = 1; order.push(value);
                visit();
                order.pop(); used[value] = 0;
            }
        }
        visit();
    }
    return ranks;
}
const expected = bruteRanks();
const factorial = (n: number): bigint => {
    let result = 1n;
    for (let i = 2; i <= n; i++) result *= BigInt(i);
    return result;
};

describe.each([true, false])('Euler 524 (compilation=%s)', compilation => {
    it('matches all costs from permutations of at most eight elements', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const declared = withoutReturn(source).replace('arg K integer = 8916100448256', 'K = 0');
            runtime.execute(declared + `
fun Steps tested_rank rank 0
  Order = Steps first_order
  return Order rank_of
end
Costs = 0 to 127 copy
Ranks = Costs tested_rank`);
            expect(Array.from((runtime.variables.get('Ranks') as RankArray).items)).toEqual(expected);
        } finally { runtime.dispose(); }
    }, 30000);
    it.each([0n, 5n, 6n, 79n, 1001n])('retains the small rank at K=%s', k => {
        const ranks = new Map([[0n, 1n], [5n, 8n], [6n, 5n], [79n, 7143n], [1001n, 3634441n]]);
        expect(run(k, compilation)).toBe(ranks.get(k));
    });
    it.each([24, 80])('handles all-one costs with %s bits exactly', width => {
        expect(run((1n << BigInt(width)) - 1n, compilation)).toBe(BigInt(width) * factorial(width) + 1n);
    });
    it('keeps the full rank', () => expect(run(8916100448256n, compilation)).toBe(full));
    it('removes a wide identity prefix exactly', () => {
        expect(run(531441n << 120n, compilation)).toBe(full);
    });
});
