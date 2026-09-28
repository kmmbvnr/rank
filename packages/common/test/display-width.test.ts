import { expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { cellWidth, fitEnd } from '../src/display-width.js';
import { Notebook } from '../src/notebook.js';
import { notebookFrame } from '../src/screen.js';

it('fits the end of a prefix by cells, not characters', () => {
    expect(cellWidth('▶')).toBe(2);
    expect(fitEnd('  ▶ ', 4)).toBe(' ▶ ');
    expect(cellWidth(fitEnd('    ▶ ', 4))).toBe(4);
    expect(fitEnd('ab', 5)).toBe('   ab');
    expect(fitEnd('a▶b', 2)).toBe(' b');
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
