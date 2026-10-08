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
    const source = 'rem abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz 👩‍💻 together';
    const rows = editableRows(source, 12);
    expect(rows.map(row => row.text).join('')).toBe(source);
    expect(rows.every(row => cellWidth(row.text) <= 12)).toBe(true);
    expect(rows.some(row => row.text.includes('👩‍💻'))).toBe(true);
});

it('shortens comment URLs only for display and expands the link under the cursor', () => {
    const url = 'https://example.org/a/very/long/path/to/the/original/problem?task=2';
    const source = `rem See ${url}. Then https://short.io/x`;
    const collapsed = editableRows(source, 40);
    const shown = collapsed.map(row => row.text).join('');
    expect(shown).toContain('example.org/');
    expect(shown).toContain('…. Then short.io/x');
    expect(shown).not.toContain('https://');
    expect(collapsed.every(row => cellWidth(row.text) <= 40)).toBe(true);
    const start = source.indexOf(url);
    for (let cursor = start; cursor <= start + url.length; cursor++) {
        const expanded = editableRows(source, 40, cursor);
        expect(expanded.map(row => row.text).join('')).toBe(`rem See ${url}. Then short.io/x`);
        expect(expanded.some(row => row.points.some(point => point.offset === cursor))).toBe(true);
    }
    expect(editableRows(source, 40, 0)).toEqual(collapsed);
    expect(collapsed.at(-1)!.points.at(-1)!.offset).toBe(source.length);
    // URL-valued code stays literal, including its scheme and full path.
    const code = `Url = "${url}"`;
    expect(editableRows(code, 40).map(row => row.text).join('')).toBe(code);
});

it('maps taps on abbreviated URLs to source positions that reveal the full link', () => {
    const source = 'rem https://example.org/abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
    const book = new Notebook();
    book.enqueue(source);
    const collapsed = notebookFrame(book, 46, 12);
    const target = collapsed.targets?.find(target => target?.kind === 'source' && target.cell === 0)!;
    expect(target).toBeDefined();
    const point = target.points.find(point => point.offset > source.indexOf('https://'))!;
    book.active = 0;
    book.cursor = point.offset;
    const expanded = notebookFrame(book, 46, 12);
    expect(expanded.lines.map(stripAnsi).join('\n')).toContain('https://');
    expect(book.current.source).toBe(source);
    const caretTarget = expanded.targets?.[expanded.cursor.row];
    expect(caretTarget?.points).toContainEqual({ offset: book.cursor, column: expanded.cursor.column });
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

it('keeps dots at the left edge and fits three-digit notebook numbers', () => {
    const book = new Notebook();
    for (let number = 1; number <= 999; number++) book.enqueue(`V${number} = 1`);
    const frame = notebookFrame(book, 46, 1010, 0, '', false, false, '', 'Running…', undefined, '> ');
    for (const number of [1, 10, 100, 999]) {
        const row = stripAnsi(frame.lines.find(line => line.includes(`V${number} = 1`))!);
        expect(row).toBe(`●${String(number).padStart(3)}› V${number} = 1`);
        expect(cellWidth(row.slice(0, row.indexOf(`V${number}`)))).toBe(6);
    }
    const continued = new Notebook();
    continued.enqueue('fun f N\n  N + 1\nend');
    const rows = notebookFrame(continued, 46, 12).lines.map(stripAnsi);
    expect(rows.find(row => row.includes('N + 1'))).toBe('·       N + 1');
    const marked = notebookFrame(continued, 46, 12, 0, '', false, true, '', 'Running…',
        new Map([[continued.cells[0].id, new Set([2])]]));
    expect(stripAnsi(marked.lines.find(row => row.includes('N + 1'))!)).toBe('◆       N + 1');
});


it('keeps oversized integer rows compact and reveals only the focused literal', () => {
    const first = '37107287533902102798797998220837590246510135740250';
    const second = '46376937677490009712648124896970078050417018260538';
    const source = `  ${first}\n  ${second}`;
    const collapsed = editableRows(source, 33);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.every(row => cellWidth(row.text) < 33 && row.text.endsWith('…'))).toBe(true);
    expect(collapsed[0].points.at(-1)!.offset).toBe(first.length + 2);
    for (let cursor = 2; cursor <= first.length + 2; cursor++) {
        const expanded = editableRows(source, 33, cursor);
        expect(expanded.map(row => row.text).join('')).toContain(first);
        expect(expanded.map(row => row.text).join('')).not.toContain(second);
        expect(expanded.some(row => row.points.some(point => point.offset === cursor))).toBe(true);
    }
    expect(editableRows(`Text = "${first}"`, 33).map(row => row.text).join('')).toBe(`Text = "${first}"`);
});

it('maps a tap on an abbreviated integer back to the full editable source', () => {
    const source = '  37107287533902102798797998220837590246510135740250';
    const book = new Notebook();
    book.enqueue(source);
    const collapsed = notebookFrame(book, 40, 12);
    const target = collapsed.targets!.find(target => target?.kind === 'source' && target.cell === 0)!;
    book.active = 0;
    book.cursor = target.points.at(-1)!.offset;
    const expanded = notebookFrame(book, 40, 12);
    expect(expanded.lines.map(stripAnsi).join('')).toContain(source.trim().slice(0, 25));
    expect(book.current.source).toBe(source);
    expect(editableRows(source, 33, book.cursor).map(row => row.text).join('')).toBe(source);
    expect(expanded.targets?.[expanded.cursor.row]?.points).toContainEqual({ offset: book.cursor, column: expanded.cursor.column });
});
