import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

describe('multiline text blocks', () => {
    function runtime() {
        return new Interpreter(() => undefined);
    }

    it('glues quoted lines into one text', () => {
        const r = runtime();
        r.execute([
            'Pad = text',
            '  "....."',
            '  ".123."',
            '  "....."',
            'end',
        ].join('\n'));
        expect(r.variables.get('Pad')).toBe('.....' + '.123.' + '.....');
        expect(r.execute('Pad 6')).toBe('1');
    });

    it('joins the lines with a line break in the lines form', () => {
        const r = runtime();
        r.execute('Message = text lines\n  "First"\n  "Second"\nend');
        expect(r.variables.get('Message')).toBe('First\nSecond');
        expect(r.execute('use text\nMessage "\\n" split len')).toBe(2n);
    });

    it('keeps spaces, escapes and ignores rem lines and blank lines', () => {
        const r = runtime();
        r.execute([
            'Map = text',
            '  rem the top of the map',
            '  "  #  "',
            '',
            '  " \\"# "',
            'end',
        ].join('\n'));
        expect(r.variables.get('Map')).toBe('  #   "# ');
    });

    it('is an empty text without lines', () => {
        const r = runtime();
        r.execute('Nothing = text\nend');
        expect(r.variables.get('Nothing')).toBe('');
    });

    it('still reads text as a function and a module name', () => {
        const r = runtime();
        expect(r.execute('use text\n12 text')).toBe('12');
    });

    it('rejects an unknown form', () => {
        expect(() => runtime().execute('Bad = text keep\n  "x"\nend')).toThrow('unknown text block form `keep`');
    });
});
