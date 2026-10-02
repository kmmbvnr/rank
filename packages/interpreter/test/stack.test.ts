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
        expect(run(`${items}S = (array A B) stack\nS shape`)).toBe('2 3');
        expect(run(`${items}(array A B) stack`)).toBe(run(`${items}(array A B) copy`));
        expect(run(`${items}((array A B) stack) transpose shape`)).toBe('3 2');
    });

    it('keeps value semantics: later writes to a name do not change the stack', () => {
        const before = 'A = array 1 2\nB = array 3 4\nS = (array A B) stack\n';
        expect(run(`${before}A 0 = 9\nS`)).toBe(run('A = array 1 2\nB = array 3 4\n(array A B) copy'));
    });

    it('stacks sequences of exact size', () => {
        expect(run('S = (array (1 to 3) (4 to 6)) stack\nS shape')).toBe('2 3');
        expect(run('(array (1 to 3) (4 to 6)) stack')).toBe(run('(array (1 to 3) (4 to 6)) copy'));
    });

    it('rejects sequences of unknown size, suggesting copy', () => {
        expect(() => run('use numbers\nS = (array ((1 to 6) filter even) (1 to 3)) stack\nS')).toThrow(/unknown size/);
    });

    it('rejects different shapes and mixed scalars', () => {
        expect(() => run('S = (array (array 1 2) (array 1 2 3)) stack\nS')).toThrow(/same shape/);
        expect(() => run('S = (array (array 1 2) 3) stack\nS')).toThrow(/arrays require one element type/);
    });
});
