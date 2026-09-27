import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const prelude = 'use sequences\nuse text\n';

describe('rank L R', () => {
    it('gives each operand of a binary operation its own cell rank', () => {
        expect(run(`${prelude}Kinds = "SAMFL" "" split\nKinds ("MSL" "" split) find rank 1 0`)).toBe('2 0 4');
        expect(run(`${prelude}M = (array (array 1 2 3) (array 3 2 1)) copy\nM (array 3 1) find rank 1 0`))
            .toBe('2 2');
        expect(run(`${prelude}M = (array (array 1 2 3) (array 3 2 1)) copy\nM 2 find rank 1 0`)).toBe('1 1');
    });

    it('ends the modified call so the chain continues', () => {
        expect(run(`${prelude}Kinds = "SAMFL" "" split\nKinds ("MSL" "" split) find rank 1 0 len`)).toBe('3');
    });

    it('keeps the errors of each cell', () => {
        expect(() => run(`${prelude}Kinds = "SAM" "" split\nKinds ("SX" "" split) find rank 1 0 copy`))
            .toThrowError('find found no matching value');
    });

    it('applies a program function of two parameters to the paired cells', () => {
        expect(run(`${prelude}fun pick A B\n  return A B find\nend\n(array 1 2 3) (array 3 1) pick rank 1 0`))
            .toBe('2 0');
    });

    it('requires two operands and a binary operation', () => {
        expect(() => run(`${prelude}(array 1 2) len rank 1 0`))
            .toThrowError('rank L R expects two operands and a binary operation');
    });
});
