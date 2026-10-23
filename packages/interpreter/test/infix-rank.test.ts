import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

describe.each([false, true])('infix binary ranks (compilation=%s)', compilation => {
    function run(expression: string, prefix = '') {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences\nuse numbers
A = (array 1 2 3 4 5 6) reshape 2 3
B = array 3 6
${prefix}`);
            return formatValue(runtime.execute(expression)!);
        } finally { runtime.dispose(); }
    }

    it.each(['+', '-', '*', '/', '//', 'mod', '**'])('shares postfix ranks for %s', operator => {
        expect(run(`A ${operator} B rank 1 0`)).toBe(run(`A B ${operator} rank 1 0`));
    });

    it('pairs each row with its own reduction', () => {
        expect(run('A - Tops rank 1 0', 'Tops = A max axis 1')).toBe('-2 -1 0 -2 -1 0');
        expect(run('A / Totals rank 1 0', 'Totals = A sum axis 1'))
            .toBe(run('A / (Totals reshape # 1)', 'Totals = A sum axis 1'));
        expect(() => run('A - B')).toThrow(/shape mismatch/);
    });

    it('preserves surrounding precedence and following calls', () => {
        expect(run('A + A * B rank 1 0')).toBe('4 8 12 28 35 42');
        expect(run('A - B rank 1 0 + 2')).toBe('0 1 2 0 1 2');
        expect(run('A - B rank 1 0 exp')).toBe(run('(A B - rank 1 0) exp'));
        expect(run('A - (B + 1) rank 1 0')).toBe('-3 -2 -1 -3 -2 -1');
        expect(() => run('A - 3 2 min rank 0 0')).toThrow(/rank L R expects/);
        expect(run('A - (3 2 min rank 0 0)')).toBe('-1 0 1 2 3 4');
    });

    it('supports negative ranks, scalar frames and singleton frames', () => {
        expect(run('A - B rank -1 0')).toBe('-2 -1 0 -2 -1 0');
        expect(run('A - B rank 1 -1')).toBe('-2 -1 0 -2 -1 0');
        expect(run('A - 2 rank 1 0')).toBe('-1 0 1 2 3 4');
        expect(run('2 - A rank 0 1')).toBe('1 0 -1 -2 -3 -4');
        expect(run('A - C rank 1 0', 'C = array 3')).toBe('-2 -1 0 1 2 3');
    });

    it('preserves empty cell and empty frame shapes', () => {
        expect(run('(E - B rank 1 0) shape', 'E = array shape 2 0 fill 0')).toBe('2 0');
        expect(run('(E - C rank 1 0) shape', 'E = array shape 0 3 fill 0\nC = array shape 0 fill 0'))
            .toBe('0 3');
        expect(() => run('A - C rank 1 0', 'C = array 1 2 3')).toThrow(/shape mismatch/);
    });

    it('retains deferred observations and ordinary snapshots', () => {
        expect(run('Saved', "Later' = A - B rank 1 0\nSaved = Later\nB = array 0 0"))
            .toBe('-2 -1 0 -2 -1 0');
    });
});
