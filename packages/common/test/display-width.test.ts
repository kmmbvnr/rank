import { expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { cellWidth, fitEnd } from '../src/display-width.js';
import { Notebook } from '../src/notebook.js';
import { editableRows, notebookFrame, textColumns } from '../src/screen.js';

it('fits the end of a prefix by cells, not characters', () => {
    expect(cellWidth('▶')).toBe(2);
    expect(fitEnd('  ▶ ', 4)).toBe(' ▶ ');
    expect(cellWidth(fitEnd('    ▶ ', 4))).toBe(4);
    expect(fitEnd('ab', 5)).toBe('   ab');
    expect(fitEnd('a▶b', 2)).toBe(' b');
});

it('wraps comment words without changing source or losing caret offsets', () => {
    const source = '  rem Spaces, digits and punctuation never change.\nValue = "a long string with spaces"';
    const rows = editableRows(source, 39);
    expect(rows[0].text).toBe('  rem Spaces, digits and punctuation ');
    expect(rows[1].text).toBe('never change.');
    expect(rows.map(row => row.text).join('')).toBe(source.replace('\n', ''));
    for (let offset = 0; offset <= source.length; offset++) {
        expect(rows.some(row => row.points.some(point => point.offset === offset))).toBe(true);
    }
    expect(rows.every(row => cellWidth(row.text) <= 39)).toBe(true);
    expect(editableRows('Value = "a long string with spaces"', 16).map(row => row.text)).toEqual([
        'Value = "a long ', 'string with spac', 'es"',
    ]);
});

it('hard-wraps oversized comment words and keeps Unicode graphemes intact', () => {
    const source = 'rem https://example.org/abcdefghijklmnopqrstuvwxyz 👩‍💻 together';
    const rows = editableRows(source, 12);
    expect(rows.map(row => row.text).join('')).toBe(source);
    expect(rows.every(row => cellWidth(row.text) <= 12)).toBe(true);
    expect(rows.some(row => row.text.includes('👩‍💻'))).toBe(true);
});

it('gives a compact phone gutter one more source column with matching caret targets', () => {
    const book = new Notebook();
    const source = 'rem Spaces, digits and punctuation never';
    book.replace(source);
    book.cursor = source.length;
    const frame = notebookFrame(book, 46, 10, 0, '', false, true, '', 'Running…', undefined, '> ',
        undefined, undefined, undefined, false, undefined, false, 0, undefined, undefined, undefined, undefined, 5);
    const line = stripAnsi(frame.lines.find(line => line.includes(source))!);
    expect(line).toBe('   > ' + source);
    expect(textColumns(46, 5)).toBe(40);
    const target = frame.targets?.[frame.cursor.row];
    expect(target?.kind).toBe('source');
    if (target?.kind === 'source') {
        expect(target.points).toContainEqual({ offset: source.length, column: frame.cursor.column });
    }
});

it('keeps every gutter exactly as wide as the prompt label, even with a wide glyph', () => {
    const book = new Notebook();
    book.replace('X = 1\nY = 2');
    const label = '▶ rank> ';
    const frame = notebookFrame(book, 60, 10, 0, '', false, true, '', 'Running…', undefined, label);
    const gutter = cellWidth(label);
    for (const source of ['X = 1', 'Y = 2']) {
        const row = stripAnsi(frame.lines.find(line => line.includes(source))!);
        expect(cellWidth(row.slice(0, row.indexOf(source)))).toBe(gutter);
    }
});
