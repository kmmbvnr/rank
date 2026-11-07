import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';

const source = readFileSync(new URL('../../../demos/euler/459_flippinggame.ra', import.meta.url), 'utf8');
const backends = [{}, { compilation: false }, { numberLoopCompilation: false }];
function lengths(n: number, triangular: boolean): number[] {
    const values: number[] = [];
    for (let k = 1; ; k++) {
        const value = triangular ? k * (k + 1) / 2 : k * k;
        if (value > n) return values;
        values.push(value);
    }
}
function axis(n: number, moves: number[]) {
    const size = 2 ** Math.ceil(Math.log2(moves.length + 1));
    const prefix = new Int32Array(n + 1), counts = Array<number>(size).fill(0);
    for (let i = 1; i <= n; i++) {
        const options = new Set<number>();
        for (const move of moves) if (move <= i) options.add(prefix[i - 1] ^ prefix[i - move]);
        let grundy = 0; while (options.has(grundy)) grundy++;
        prefix[i] = prefix[i - 1] ^ grundy;
        for (const move of moves) if (move <= i) counts[prefix[i] ^ prefix[i - move]]++;
    }
    return { counts, word: prefix[n] };
}
const products = new Map<number, number[][]>();
function nimProducts(size: number) {
    const cached = products.get(size);
    if (cached) return cached;
    const table = Array.from({ length: size }, () => Array<number>(size).fill(0));
    // Definition of nim multiplication, independent of the field expansion.
    for (let a = 1; a < size; a++) for (let b = 1; b < size; b++) {
        const options = new Set<number>();
        for (let x = 0; x < a; x++) for (let y = 0; y < b; y++)
            options.add(table[x][b] ^ table[a][y] ^ table[x][y]);
        let value = 0; while (options.has(value)) value++;
        table[a][b] = value;
    }
    products.set(size, table);
    return table;
}
function oracle(n: number) {
    const row = axis(n, lengths(n, true)), col = axis(n, lengths(n, false));
    const table = nimProducts(Math.max(row.counts.length, col.counts.length));
    const goal = table[row.word][col.word];
    let answer = 0n;
    row.counts.forEach((count, a) => col.counts.forEach((other, b) => {
        if (table[a][b] === goal) answer += BigInt(count) * BigInt(other);
    }));
    return { row, col, answer };
}
function board(n: number) {
    const moves: { pivot: number; mask: number }[] = [];
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++)
        for (const height of lengths(row + 1, true)) for (const width of lengths(col + 1, false)) {
            let mask = 0;
            for (let y = row + 1 - height; y <= row; y++) for (let x = col + 1 - width; x <= col; x++) mask |= 1 << (y * n + x);
            moves.push({ pivot: 1 << (row * n + col), mask });
        }
    const states = 2 ** (n * n), values = new Uint16Array(states), seen = new Uint32Array(moves.length + 1);
    // Every legal move clears its highest bit, so smaller states are ready.
    for (let state = 1; state < states; state++) {
        for (const move of moves) if (state & move.pivot) seen[values[state ^ move.mask]] = state;
        let value = 0; while (seen[value] === state) value++;
        values[state] = value;
    }
    return BigInt(moves.filter(move => values[(states - 1) ^ move.mask] === 0).length);
}
function solve(n: number, options: object, check?: (runtime: Interpreter) => void) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        check?.(runtime);
        return { answer: runtime.variables.get('Answer'), diagnostics };
    } finally { runtime.dispose(); }
}
it.each([0, 1, 2, 3, 4, 5, 6, 7, 10, 13, 16, 20, 30, 50, 100, 200])('matches independent nim definitions and move histograms at N=%s', n => {
    const expected = oracle(n);
    for (const options of backends) expect(solve(n, options, runtime => {
        for (const [name, data] of [['Rows', expected.row], ['Cols', expected.col]] as const) {
            const actual = runtime.variables.get(name) as RankArray;
            for (let i = 0; i < actual.shape[0]; i++) expect(readArrayItem(actual, i)).toBe(BigInt(data.counts[i] ?? 0));
        }
        expect(runtime.variables.get('Row')).toBe(BigInt(expected.row.word));
        expect(runtime.variables.get('Col')).toBe(BigInt(expected.col.word));
    }).answer).toBe(expected.answer);
});
it.each([0, 1, 2, 3, 4])('matches the complete board game at N=%s', n => {
    expect(oracle(n).answer).toBe(board(n));
    expect(solve(n, {}).answer).toBe(board(n));
});
it('retains the imported fixture answers on all backends', () => {
    for (const options of backends) {
        expect(solve(5, options).answer).toBe(8n);
        expect(solve(100, options).answer).toBe(31395n);
        expect(solve(3000, options).answer).toBe(55837744n);
    }
});
it('retains the full million-square answer with compiled array loops', () => {
    const result = solve(1000000, {});
    expect(result.answer).toBe(3996390106631n);
    expect(result.diagnostics.numberLoops).toBeGreaterThanOrEqual(3);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
}, 60000);
