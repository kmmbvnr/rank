import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    return formatValue(runtime.execute(source)!);
}

describe('stack', () => {
    it('stacks equally shaped arrays and matches copy', () => {
        const items = 'A = array 1 2 3\nB = array 4 5 6\n';
        expect(run(`${items}S = stack A B\nS shape`)).toBe('2 3');
        expect(run(`${items}stack A B`)).toBe(run(`${items}(array A B) copy`));
        expect(run(`${items}stack A B transpose shape`)).toBe('3 2');
        expect(run(`${items}stack A B A transpose shape`)).toBe('3 3');
        expect(run(`${items}Items = array A B\nstack unpack Items`)).toBe(run(`${items}stack A B`));
        expect(run(`${items}stack unpack (tuple A B)`)).toBe(run(`${items}stack A B`));
        expect(run('stack unpack (array shape 0 fill 0) shape')).toBe('0');
    });

    it('keeps value semantics: later writes to a name do not change the stack', () => {
        const before = 'A = array 1 2\nB = array 3 4\nS = stack A B\n';
        expect(run(`${before}A 0 = 9\nS`)).toBe(run('A = array 1 2\nB = array 3 4\n(array A B) copy'));
    });

    it('stacks sequences of exact size', () => {
        expect(run('S = stack (1 to 3) (4 to 6)\nS shape')).toBe('2 3');
        expect(run('stack (1 to 3) (4 to 6)')).toBe(run('(array (1 to 3) (4 to 6)) copy'));
        expect(run('stack (array 1 2) (3 to 4) shape')).toBe('2 2');
    });

    it('rejects sequences of unknown size, suggesting copy', () => {
        expect(() => run('use numbers\nS = stack ((1 to 6) filter even) (1 to 3)\nS')).toThrow(/unknown size/);
    });

    it('rejects different shapes and mixed scalars', () => {
        expect(() => run('S = stack (array 1 2) (array 1 2 3)\nS')).toThrow(/same shape/);
        expect(() => run('S = stack (array 1 2) 3\nS')).toThrow(/arrays or sequences/);
    });

    it('requires the prefix form and the sequences module', () => {
        expect(() => run('(array (array 1 2) (array 3 4)) stack')).toThrow(/use stack A B/);
        expect(() => new Interpreter().execute('S = stack (array 1 2) (array 3 4)'))
            .toThrow(/use sequences/);
    });
});
