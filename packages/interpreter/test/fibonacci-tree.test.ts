import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/400_fibtree.ra', import.meta.url), 'utf8');

// Independent game oracle: enumerate legal subtree removals, rather than
// reproducing the demo's Grundy-target recurrence or its packed work stack.
function winningCuts(order: number): bigint {
    const subtrees: bigint[] = [];
    function tree(n: number): bigint {
        if (!n) return 0n;
        const index = subtrees.length;
        subtrees.push(0n);
        const mask = 1n << BigInt(index);
        return subtrees[index] = mask | tree(n - 1) | tree(Math.max(0, n - 2));
    }
    const initial = tree(order), outcomes = new Map<bigint, boolean>();
    function winning(position: bigint): boolean {
        const known = outcomes.get(position);
        if (known !== undefined) return known;
        for (let index = 1; index < subtrees.length; index++) {
            if ((position & (1n << BigInt(index))) && !winning(position & ~subtrees[index])) {
                outcomes.set(position, true);
                return true;
            }
        }
        outcomes.set(position, false);
        return false;
    }
    let count = 0n;
    // Taking the whole tree's root loses, so it is never a winning move.
    for (let index = 1; index < subtrees.length; index++) {
        if (!winning(initial & ~subtrees[index])) count++;
    }
    return count;
}

function solve(order: number, compilation: boolean): { answer: unknown; calls: number } {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        runtime.execute(source.replace('arg K integer = 10000', `arg K integer = ${order}`));
        return { answer: runtime.variables.get('Answer'), calls };
    } finally { runtime.dispose(); }
}

describe('Fibonacci tree sparse DP', () => {
    it('matches actual game play for every small Fibonacci tree in both execution modes', () => {
        for (let order = 1; order <= 6; order++) {
            const expected = winningCuts(order);
            for (const compilation of [false, true]) expect(solve(order, compilation).answer).toBe(expected);
        }
    });

    it('preserves checkpoints, key boundaries and exact counts beyond safe Number integers', () => {
        for (const [order, answer] of [[0, 0n], [5, 1n], [10, 17n], [100, 580893155023212545n]] as const) {
            const result = solve(order, true);
            expect(result.answer).toBe(answer);
            expect(result.calls).toBeGreaterThan(0);
            if (order <= 10) expect(solve(order, false).answer).toBe(answer);
        }
    });
});
