import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, parse, type RankValue } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/dyalog/2012/004_nurikabe.ra', import.meta.url), 'utf8');

// Independent union-find check of completed boards.
function valid(cells: number[], height: number, width: number): boolean {
    if (!cells.length || cells.some(cell => !Number.isInteger(cell) || cell < -1)) return false;
    const parents = cells.map((_, i) => i);
    const root = (i: number): number => parents[i] === i ? i : root(parents[i]);
    const join = (a: number, b: number) => { parents[root(a)] = root(b); };
    for (let i = 0; i < cells.length; i++) {
        if (i % width && (cells[i] === -1) === (cells[i - 1] === -1)) join(i, i - 1);
        if (i >= width && (cells[i] === -1) === (cells[i - width] === -1)) join(i, i - width);
    }
    const components = new Map<number, number[]>();
    cells.forEach((_, i) => components.set(root(i), [...(components.get(root(i)) ?? []), i]));
    let seas = 0;
    for (const positions of components.values()) {
        if (cells[positions[0]] === -1) { seas++; continue; }
        const clues = positions.filter(i => cells[i] > 0);
        if (clues.length !== 1 || cells[clues[0]] !== positions.length) return false;
    }
    if (seas > 1) return false;
    for (let row = 0; row < height - 1; row++) for (let col = 0; col < width - 1; col++) {
        const p = row * width + col;
        if ([p, p + 1, p + width, p + width + 1].every(i => cells[i] === -1)) return false;
    }
    return true;
}

function exists(puzzle: number[], height: number, width: number): boolean {
    const blanks = puzzle.flatMap((v, i) => v === 0 ? [i] : []);
    for (let bits = 0; bits < 2 ** blanks.length; bits++) {
        const cells = [...puzzle];
        blanks.forEach((p, i) => { cells[p] = bits & (1 << i) ? -1 : 0; });
        if (valid(cells, height, width)) return true;
    }
    return false;
}

const values = (value: RankValue): number[] => {
    if (!isRankArray(value)) throw new Error('expected solution matrix');
    return Array.from({ length: value.shape.reduce((a, b) => a * b, 1) },
        (_, i) => Number(value.itemAt?.(i) ?? value.items[i]));
};
const literal = (cells: number[], height: number, width: number) =>
    `(array ${cells.join(' ')}) reshape ${height} ${width}`;

for (const compiled of [false, true]) describe(`Nurikabe (compiled=${compiled})`, () => {
    const runtime = () => {
        const r = new Interpreter(() => {}, { scalarCompilation: compiled, scalarFunctionCompilation: compiled,
            integerLoopCompilation: compiled, tensorCellCompilation: compiled });
        r.execute(source);
        return r;
    };
    it('validates every two by two board with cells -1 through 4', () => {
        const r = runtime();
        // Reuse the fixed query while assigning and checking every board.
        const validation = parse('Board valid');
        try {
            for (let code = 0; code < 6 ** 4; code++) {
                let n = code;
                const cells = Array.from({ length: 4 }, () => { const cell = n % 6 - 1; n = Math.floor(n / 6); return cell; });
                r.execute(`Board = ${literal(cells, 2, 2)}`);
                expect(r.executeProgram(validation), cells.join(',')).toBe(valid(cells, 2, 2) ? 1n : 0n);
            }
        } finally { r.dispose(); }
    }, 30_000);
    it('solves or rejects every two by two clue puzzle with clues 0 through 4', () => {
        const r = runtime();
        try {
            for (let code = 0; code < 5 ** 4; code++) {
                let n = code;
                const puzzle = Array.from({ length: 4 }, () => { const cell = n % 5; n = Math.floor(n / 5); return cell; });
                r.execute(`Puzzle = ${literal(puzzle, 2, 2)}`);
                if (!exists(puzzle, 2, 2)) {
                    expect(() => r.execute('Puzzle nurikabe'), puzzle.join(',')).toThrow(/no solution/);
                    continue;
                }
                const solution = r.execute('Puzzle nurikabe')!;
                expect(solution).toMatchObject({ shape: [2, 2] });
                const cells = values(solution);
                expect(valid(cells, 2, 2), puzzle.join(',')).toBe(true);
                puzzle.forEach((clue, i) => { if (clue) expect(cells[i]).toBe(clue); });
                expect(values(r.variables.get('Puzzle')!)).toEqual(puzzle);
            }
        } finally { r.dispose(); }
    }, 30_000);
    it('solves or rejects every two by three clue puzzle with clues 0 through 2', () => {
        const r = runtime();
        try {
            for (let code = 0; code < 3 ** 6; code++) {
                let n = code;
                const puzzle = Array.from({ length: 6 }, () => { const cell = n % 3; n = Math.floor(n / 3); return cell; });
                r.execute(`Puzzle = ${literal(puzzle, 2, 3)}`);
                if (!exists(puzzle, 2, 3)) {
                    expect(() => r.execute('Puzzle nurikabe'), puzzle.join(',')).toThrow(/no solution/);
                    continue;
                }
                const solution = r.execute('Puzzle nurikabe')!;
                expect(solution).toMatchObject({ shape: [2, 3] });
                const cells = values(solution);
                expect(valid(cells, 2, 3), puzzle.join(',')).toBe(true);
                puzzle.forEach((clue, i) => { if (clue) expect(cells[i]).toBe(clue); });
                expect(values(r.variables.get('Puzzle')!)).toEqual(puzzle);
            }
        } finally { r.dispose(); }
    }, 30_000);
});
