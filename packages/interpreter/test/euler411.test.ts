import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/411_uphillpaths.ra', import.meta.url), 'utf8');
function solve(first: number, count: number, power: number, compilation: boolean) {
    const r = new Interpreter(() => {}, { compilation, args: [`--first=${first}`, `--count=${count}`, `--power=${power}`] }), d = new RuntimeDiagnostics();
    try { d.run(() => r.execute(source)); return { answer: answerOf(r), d }; }
    finally { r.dispose(); }
}
// All specified points, without multiplicative orders or packed integer keys.
function oracle(n: number) {
    const points: number[][] = [];
    let x = 1 % n, y = 1 % n;
    for (let i = 0; i <= 2 * n; i++) { points.push([x, y]); x = x * 2 % n; y = y * 3 % n; }
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const tails: number[] = [];
    let previous = '';
    for (const [x, y] of points) {
        const key = `${x},${y}`;
        if (key === previous) continue;
        previous = key;
        let low = 0, high = tails.length;
        while (low < high) { const middle = Math.floor((low + high) / 2); if (tails[middle] <= y) low = middle + 1; else high = middle; }
        tails[low] = y;
    }
    return BigInt(tails.length);
}
describe.each([false, true])('Euler 411 (compilation=%s)', compilation => {
    it('matches every specified station, including powers of two and three', () => {
        for (const n of [...Array.from({ length: 32 }, (_, i) => i + 1), 50, 81, 123, 128, 243, 729, 10000, 16384]) {
            expect(solve(n, n, 1, compilation).answer, `n=${n}`).toBe(oracle(n));
        }
    });
    it('preserves fixtures, singleton and empty ranges', () => {
        expect(solve(1, 8, 5, compilation).answer).toBe(9052n);
        if (compilation) expect(solve(1, 13, 5, true).answer).toBe(50705n);
        expect(solve(22, 22, 1, compilation).answer).toBe(5n);
        expect(solve(1, 30, 0, compilation).answer).toBe(30n);
        expect(solve(2, 1, 5, compilation).answer).toBe(0n);
    });
});
it('preserves the full default through packed read-only inputs', () => {
    const result = solve(1, 30, 5, true);
    expect(result.answer).toBe(9936352n);
    expect(result.d.numberLoopBorrowedIntegerCells).toBeGreaterThan(40000000);
    expect(result.d.numberLoopReadBufferCells).toBe(0);
    expect(result.d.numberLoopOverflows).toBe(0);
}, 90000);
