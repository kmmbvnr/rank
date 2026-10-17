import { describe, expect, it } from 'vitest';
import { Notebook } from '../src/notebook.js';
import { editableRows, notebookFrame } from '../src/screen.js';

describe('clipped source lines', () => {
    it('keeps one row per line and maps the ellipsis to the line end', () => {
        const source = 'A = 1 2 3 4 5 6\nrem one two three four\nB = 12345678';
        const rows = editableRows(source, 10, undefined, true, true);
        expect(rows.map(row => row.text)).toEqual(['A = 1 2 3…', 'rem one t…', 'B = 12345…']);
        expect(rows[0].points.at(-1)).toEqual({ offset: 15, column: 10 });
        expect(rows[1].points.at(-1)).toEqual({ offset: source.indexOf('\nB'), column: 10 });
    });

    it('adds no empty row after a line that fills the width away from the caret', () => {
        expect(editableRows('ABCDEFGHIJ\nK', 10, 10).map(row => row.text)).toEqual(['ABCDEFGHIJ', '', 'K']);
        expect(editableRows('ABCDEFGHIJ\nK', 10, 12).map(row => row.text)).toEqual(['ABCDEFGHIJ', 'K']);
        for (const clip of [false, true]) {
            const rows = editableRows('ABCDEFGHIJ\nK', 10, undefined, true, clip);
            expect(rows.map(row => row.text)).toEqual(['ABCDEFGHIJ', 'K']);
            expect(rows[0].points.at(-1)).toEqual({ offset: 10, column: 10 });
        }
    });

    it('wraps only the cell being edited', () => {
        const book = new Notebook();
        book.enqueue('rem Find the largest top-to-bottom path sum');
        expect(book.active).toBe(1);
        const sourceRows = () => {
            const frame = notebookFrame(book, 30, 50, 0, '', false, false);
            return frame.lines.filter((_, row) => frame.targets?.[row]?.cell === 0);
        };
        expect(sourceRows()).toHaveLength(1);
        expect(sourceRows()[0]).toMatch(/…$/);
        book.active = 0;
        expect(sourceRows().length).toBeGreaterThan(1);
        expect(sourceRows().join('')).not.toContain('…');
    });
});
