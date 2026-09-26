import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

describe('choose', () => {
    it('selects scalar values and broadcasts arrays lazily', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nMask = array true false true\n'
            + 'Yes = array 2 4 6\nOut = Mask Yes 0 choose');
        expect(formatValue(runtime.execute('Out')!)).toBe('2 0 6');
        expect(formatValue(runtime.execute('true "yes" "no" choose')!)).toBe('yes');
        runtime.execute('Grid = (array true false false true) (array 2 2) reshape\n'
            + 'Rates = (array 10 20) (array 1 2) reshape\n'
            + 'Picked = Grid Rates 0 choose');
        expect(formatValue(runtime.execute('Picked 0 0')!)).toBe('10');
        expect(formatValue(runtime.execute('Picked 0 1')!)).toBe('0');
        expect(formatValue(runtime.execute('Picked 1 1')!)).toBe('20');
        expect(() => runtime.execute('(array true false) (array 1 2 3) 0 choose'))
            .toThrowError('shape mismatch');
    });

    it('does not read an unselected missing branch, but keeps a missing mask missing', () => {
        const runtime = new Interpreter();
        runtime.execute('use json\nuse sequences\nuse tables\n'
            + 'Rows = "[{\\"mask\\":true,\\"yes\\":2},'
            + '{\\"mask\\":false,\\"no\\":5},'
            + '{\\"yes\\":7}]" json\n'
            + 'Out = (Rows .mask) (Rows .yes) (Rows .no) choose');
        expect(formatValue(runtime.execute('Out 0')!)).toBe('2');
        expect(formatValue(runtime.execute('Out 1')!)).toBe('5');
        expect(formatValue(runtime.execute('Out 2 default 0')!)).toBe('0');
        expect(() => runtime.execute('Out 2')).toThrowError('missing object key');
    });
});

describe('choose by index', () => {
    const show = (source: string): string => {
        const runtime = new Interpreter();
        return formatValue(runtime.execute(`use sequences\n${source}`)!);
    };

    it('reads each cell from the choice its index names', () => {
        expect(show('(array 1 0 2) (array 10 20 30) choose')).toBe('20 10 30');
        expect(show('(array 1 0) (array (array 1 2) (array 3 4)) choose')).toBe('3 2');
        expect(show('1 (array 10 20 30) choose')).toBe('20');
    });

    it('broadcasts a column index over the rows of matrix choices', () => {
        const matrices = 'M = (array (array 1 2) (array 3 4)) copy\nChoices = array M (M * 10)\n';
        expect(show(`${matrices}(array 1 0) Choices choose`)).toBe('10 2 30 4');
        // A stacked tensor offers its leading cells as the choices.
        expect(show(`${matrices}(array 1 0) (Choices copy) choose`)).toBe('10 2 30 4');
    });

    it('reads only the chosen value at each cell', () => {
        const runtime = new Interpreter();
        runtime.execute('use json\nuse sequences\nuse tables\n'
            + 'Rows = "[{\\"a\\":2},{\\"b\\":5}]" json\n'
            + 'Out = (array 0 1) (array (Rows .a) (Rows .b)) choose');
        expect(formatValue(runtime.execute('Out')!)).toBe('2 5');
        expect(() => runtime.execute('(array 1 1) (array (Rows .a) (Rows .b)) choose copy'))
            .toThrowError('missing object key');
    });

    it('rejects indices outside the choices and non-integer indices', () => {
        expect(() => show('(array 0 5) (array 10 20) choose')).toThrowError('choose index out of bounds: 5');
        expect(() => show('(array 0 -1) (array 10 20) choose')).toThrowError('choose index out of bounds: -1');
        expect(() => show('(array true false) (array 10 20) choose')).toThrowError('choose expects integer indices');
        expect(() => show('0 5 choose')).toThrowError('choose expects an array of choices');
        expect(() => show('(array 0 1 0) (array (array 1 2) (array 3 4)) choose')).toThrowError('shape mismatch');
    });
});
