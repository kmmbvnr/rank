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
