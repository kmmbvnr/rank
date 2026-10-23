import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, parse } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/342_totientcube.ra', import.meta.url), 'utf8');
const program = parse(source);
const helpers = { ...program, statements: program.statements.filter(statement =>
    statement.$type === 'UseStatement' || statement.$type === 'FunctionStatement') };

// Independent totient sieve. The search works with factors of p-1; this oracle
// visits every integer and tests n*phi(n) against exact integer cubes instead.
function reference(limit: number): bigint[] {
    const phi = Array.from({ length: limit }, (_, i) => i);
    for (let p = 2; p < limit; p++) {
        if (phi[p] !== p) continue;
        for (let n = p; n < limit; n += p) phi[n] -= phi[n] / p;
    }
    const cubes = new Set<number>();
    for (let r = 1; r ** 3 < limit ** 2; r++) cubes.add(r ** 3);
    const sums = [0n];
    for (let n = 0; n < limit; n++) {
        sums.push(sums[n] + (n > 1 && cubes.has(n * phi[n]) ? BigInt(n) : 0n));
    }
    return sums;
}

describe.each([false, true])('Euler 342 factor-residue search (compilation=%s)', compilation => {
    it('matches every small prefix and prime-power/product boundaries', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const sums = reference(10001);
        try {
            runtime.executeProgram(helpers, []);
            const limits = new Set([-10, -1, ...Array.from({ length: 129 }, (_, i) => i)]);
            for (const n of [200, 225, 250, 256, 625, 729, 900, 1000, 1225, 2500, 4096, 6561, 9999]) {
                for (const delta of [-1, 0, 1]) limits.add(n + delta);
            }
            for (const limit of limits) {
                expect(runtime.execute(`${limit} totientcubes`), `Limit=${limit}`).toBe(sums[Math.max(0, limit)]);
            }
            for (const limit of [0, 4, 5, 10, 50, 51, 100, 1000, 10000]) {
                expect(runtime.execute(`${limit} directcubes`), `direct Limit=${limit}`).toBe(sums[limit]);
                expect(runtime.execute(`${limit} totientcubes`), `repeat Limit=${limit}`).toBe(sums[limit]);
            }
        } finally { runtime.dispose(); }
    }, 20000);
});

it('Euler 342 matches an independent million-bound sieve and the full search in compiled execution', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.executeProgram(helpers, []);
        expect(runtime.execute('1000000 totientcubes')).toBe(reference(1000000)[1000000]);
        expect(runtime.execute('10000000000 totientcubes')).toBe(5943040885644n);
    } finally { runtime.dispose(); }
}, 20000);
