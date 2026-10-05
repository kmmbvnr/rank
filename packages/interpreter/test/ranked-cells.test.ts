import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    for (const name of ['numbers', 'text', 'sequences', 'linalg']) runtime.execute(`use ${name}`);
    return formatValue(runtime.execute(source)!);
}

const matrix = 'A = array 1 2 3 4 5 6 shape 2 3\n';

describe('negative ranks count down from the operand rank', () => {
    it('rank -1 selects the items of any operand', () => {
        expect(run(`${matrix}A sum rank -1`)).toBe('6 15');
        expect(run('V = array 1 2 3\nV sum rank -1')).toBe('1 2 3');
        expect(run('5 sum rank -1')).toBe('5');
    });

    it('never goes below a scalar cell', () => {
        expect(run(`${matrix}A sum rank -2`)).toBe('1 2 3 4 5 6');
        expect(run(`${matrix}A sum rank -9`)).toBe('1 2 3 4 5 6');
    });

    it('applies to each operand of rank L R on its own', () => {
        const source = `${matrix}B = array 10 20 30\n`;
        expect(run(`${source}A B gcd rank 0 -1`)).toBe(run(`${source}A B gcd rank 0 0`));
        expect(run(`${source}(A B gcd rank -2 -1) shape`)).toBe('2 3');
    });
});

describe('ranked cells that return arrays stack under the frame', () => {
    it('stacks the positions findall returns for each target', () => {
        const source = 'V = array 1 2 1 3 1 1\n';
        expect(run(`${source}V 1 findall`)).toBe('0 2 4 5');
        expect(run(`${source}(V (array 2 3) findall) shape`)).toBe('2 1');
        expect(() => run(`${source}V (array 1 2) findall`)).toThrow(/same shape/);
    });

    it('reshapes once per row of shapes', () => {
        const source = 'S = array 1 2 3 4 5 6 7 8\nM = array 2 4 2 4 shape 2 2\n';
        expect(run(`${source}(S reshape unpack M) shape`)).toBe('2 2 4');
        expect(run(`${source}S reshape unpack M`)).toBe('1 2 3 4 5 6 7 8 1 2 3 4 5 6 7 8');
        expect(() => run('S = array 1 2 3 4 5 6\nM = array 2 3 3 2 shape 2 2\nS reshape unpack M shape')).toThrow(/same shape/);
    });

    it('lets an explicit rank batch solve, which has no ranks of its own', () => {
        const batch = 'M = array 2 0 0 2 1 0 0 1 shape 2 2 2\nB = array 4 6 5 7 shape 2 2\n';
        expect(run(`${batch}M B solve rank 2 1`)).toBe('2 3 5 7');
        expect(run(`${batch}(M B solve rank 2 1) shape`)).toBe('2 2');
    });
});

describe('find and join take arrays', () => {
    it('finds every target in one call', () => {
        const kinds = 'K = array "S" "A" "M"\n';
        expect(run(`${kinds}K (array "M" "S") find`)).toBe('2 0');
        expect(run(`${kinds}K "A" find`)).toBe('1');
        expect(run(`${kinds}K (array "M" "S") find`)).toBe(run(`${kinds}K (array "M" "S") find rank 1 0`));
        expect(() => run(`${kinds}K (array "M" "Z") find`)).toThrow(/no matching/);
        expect(run(`${kinds}K (array "M" "Z") find default -1`)).toBe('2 -1');
    });

    it('joins each row of a matrix', () => {
        const rows = 'R = array "a" "b" "c" "d" shape 2 2\n';
        expect(run(`${rows}R "," join`)).toBe('a,b c,d');
        expect(run(`${rows}R (array "," "-") join`)).toBe('a,b c-d');
        expect(run('V = array 1 2 3\nV "," join')).toBe('1,2,3');
    });
});
