import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/376_dice.ra', import.meta.url), 'utf8');
const program = (limit: number) => source.replace('arg Limit integer = 30', `Limit = ${limit}`);

// Enumerate sorted dice directly, then count unordered triples whose pairwise
// 36-roll comparisons form a cycle. No packed DP states or binomial formula.
function enumerate(limit: number): bigint {
    const dice: number[][] = [];
    function append(prefix: number[], first: number): void {
        if (prefix.length === 6) { dice.push(prefix); return; }
        for (let pip = first; pip <= limit; pip++) append([...prefix, pip], pip);
    }
    append([], 1);
    const size = dice.length, beats = new Uint8Array(size * size);
    for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) {
        let wins = 0;
        for (const x of dice[a]) for (const y of dice[b]) wins += Number(x > y);
        beats[a * size + b] = Number(wins > 18);
    }
    let count = 0n;
    for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) {
        if (!beats[a * size + b] && !beats[b * size + a]) continue;
        for (let c = b + 1; c < size; c++) {
            if (beats[a * size + b] && beats[b * size + c] && beats[c * size + a]
                || beats[b * size + a] && beats[a * size + c] && beats[c * size + b]) count++;
        }
    }
    return count;
}

// Original label-by-label recurrence, with BigInt weights and no orbit merging
// or occupied-value coefficients. Keys contain only bounded 24-bit fields.
function original(limit: number): bigint {
    let cur = new Map([[0, 1n]]);
    for (let pip = 1; pip <= limit; pip++) {
        const next = new Map<number, bigint>();
        for (const [key, ways] of cur) {
            const ua = key & 7, ub = key >>> 3 & 7, uc = key >>> 6 & 7;
            const wba = key >>> 9 & 31, wcb = key >>> 14 & 31, wac = key >>> 19 & 31;
            for (let a = 0; a <= 6 - ua; a++) for (let b = 0; b <= 6 - ub; b++) for (let c = 0; c <= 6 - uc; c++) {
                const na = ua + a, nb = ub + b, nc = uc + c;
                if (pip === limit && (na !== 6 || nb !== 6 || nc !== 6)) continue;
                const ba = Math.min(19, wba + b * ua), cb = Math.min(19, wcb + c * ub), ac = Math.min(19, wac + a * uc);
                if (ba + 6 * (6 - nb) < 19 || cb + 6 * (6 - nc) < 19 || ac + 6 * (6 - na) < 19) continue;
                const to = na | nb << 3 | nc << 6 | ba << 9 | cb << 14 | ac << 19;
                next.set(to, (next.get(to) ?? 0n) + ways);
            }
        }
        cur = next;
    }
    return (cur.get(6 | 6 << 3 | 6 << 6 | 19 << 9 | 19 << 14 | 19 << 19) ?? 0n) / 3n;
}
const small = Array.from({ length: 7 }, (_, limit) => enumerate(limit));
expect(small).toEqual([0n, 0n, 0n, 0n, 0n, 15n, 581n]);

it.each([{}, { numberLoopCompilation: false }, { compilation: false }])('matches enumerated dice, including empty/no-cycle cases (%j)', options => {
    const r = new Interpreter(() => {}, options);
    try {
        for (const limit of 'numberLoopCompilation' in options ? [0, 5, 6] : [0, 1, 2, 3, 4, 5, 6]) {
            r.execute(program(limit));
            expect(answerOf(r), `Limit=${limit}`).toBe(small[limit]);
        }
    } finally { r.dispose(); }
}, 90000);

it('matches the original exact recurrence below, at and beyond 18 labels', () => {
    const r = new Interpreter(() => {});
    try {
        for (const limit of [7, 10, 18, 19, 30, 100]) {
            r.execute(program(limit));
            expect(answerOf(r), `Limit=${limit}`).toBe(original(limit));
        }
        expect(answerOf(r)).toBe(1886791851742265960399180n);
    } finally { r.dispose(); }
}, 30000);

it('computes the full golden in 18 complete numeric passes', () => {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute(source));
        expect(answerOf(r)).toBe(973059630185670n);
        expect(d.numberLoops).toBe(18);
        expect(d.numberLoopOverflows).toBe(0);
        expect(d.typedArrayPublishedCells).toBeLessThan(100000);
    } finally { r.dispose(); }
}, 30000);
