import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

function* permutations(n: number): Generator<number[]> {
    const used = Array<boolean>(n).fill(false);
    const row: number[] = [];
    function* visit(): Generator<number[]> {
        if (row.length === n) { yield row.slice(); return; }
        for (let col = 0; col < n; col++) {
            if (used[col]) continue;
            used[col] = true;
            row.push(col);
            yield* visit();
            row.pop();
            used[col] = false;
        }
    }
    yield* visit();
}

function byPermutations(n: number): number[][] {
    const result: number[][] = [];
    for (const q of permutations(n)) {
        if (new Set(q.map((col, i) => col + i)).size !== n) continue;
        if (new Set(q.map((col, i) => col - i)).size === n) result.push(q);
    }
    return result;
}

function byPrefixes(n: number): number[][] {
    let states = [Array<number>(n).fill(0)];
    for (let row = 0; row < n; row++) {
        const dy = Array.from({ length: row }, (_, i) => row - i);
        const indices: number[] = [];
        for (let parent = 0; parent < states.length; parent++) {
            const q = states[parent].slice(0, row);
            const blocked = new Set(q.concat(q.map((col, i) => col + dy[i]), q.map((col, i) => col - dy[i])));
            for (let col = 0; col < n; col++) if (!blocked.has(col)) indices.push(parent * n + col);
        }
        if (indices.length === 0) return [];
        states = indices.map(index => states[Math.floor(index / n)].slice());
        for (let i = 0; i < states.length; i++) states[i][row] = indices[i] % n;
    }
    return states;
}

const name = process.argv[2];
assert(name === 'permutations' || name === 'prefixes');
const solve = name === 'permutations' ? byPermutations : byPrefixes;
const warmStart = performance.now();
const warm = solve(8);
const warmMs = performance.now() - warmStart;
const iterations = Math.min(1000, Math.max(1, Math.ceil(200 / Math.max(warmMs, 0.1))));
let solutions: number[][] = [], checksum = 0;
const start = performance.now();
for (let i = 0; i < iterations; i++) { solutions = solve(8); checksum += solutions.length; }
const ms = (performance.now() - start) / iterations;
assert.equal(checksum, 92 * iterations);
assert.deepEqual(solutions, warm);
console.log(JSON.stringify({ ms, iterations, checksum, solutions, version: process.version }));
