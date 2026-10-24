import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';

const source = readFileSync(new URL('../../../demos/euler/557_cuttingtriangles.ra', import.meta.url), 'utf8');
const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

// Group exact fractions directly, without packed-key sorting or adjacency scans.
function oracle(n: number): { answer: bigint; matched: bigint[] } {
    const groups = new Map<string, { y: number; code: bigint }[]>();
    for (let x = 1; x <= n; x++) for (let y = x; y <= n; y++) {
        const g = gcd(x + y, x * y), numerator = (x + y) / g, denominator = x * y / g;
        const key = `${numerator}/${denominator}`;
        const group = groups.get(key) ?? [];
        group.push({ y, code: (BigInt(denominator) * 32768n + BigInt(numerator)) * 16384n + BigInt(x) });
        groups.set(key, group);
    }
    let answer = 0n;
    const matched: bigint[] = [];
    for (const group of groups.values()) {
        for (let i = 0; i < group.length; i++) answer += BigInt(group[i].y * (group.length - 1 - i));
        if (group.length > 1) matched.push(...group.map(pair => pair.code));
    }
    matched.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return { answer, matched };
}

describe('Euler 557 windowed adjacent-key search', () => {
    for (const window of [7, 31, 1000000]) for (const [n, answer] of [[20, 259n], [54, 3331n], [55, 3441n]] as const) {
        it(`preserves all matching pairs for N=${n}, window=${window}`, () => {
            const runtime = new Interpreter(() => {});
            try {
                runtime.execute(source.replace('N integer = 10000', `N integer = ${n}`)
                    .replace('Window = 1000000', `Window = ${window}`));
                const expected = oracle(n);
                expect(expected.answer).toBe(answer);
                expect(runtime.variables.get('Answer')).toBe(answer);
                const matched = runtime.variables.get('Zm') as RankArray;
                expect(Array.from({ length: matched.shape[0] }, (_, i) => readArrayItem(matched, i))).toEqual(expected.matched);
            } finally { runtime.dispose(); }
        });
    }
    it('agrees with direct fraction grouping with compilation disabled', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        try {
            runtime.execute(source.replace('N integer = 10000', 'N integer = 55').replace('Window = 1000000', 'Window = 11'));
            expect(runtime.variables.get('Answer')).toBe(oracle(55).answer);
        } finally { runtime.dispose(); }
    });
});
