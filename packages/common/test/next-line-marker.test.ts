import { expect, it } from 'vitest';
import { Notebook } from '../src/notebook.js';
import { notebookFrame } from '../src/screen.js';

const source = 'fun inspect N\n  A = N + 1\n  B = A * 2\nend';
const outputs = new Map([[1, []], [2, [{ text: '3', error: false }]]]);

function frameOf(stepping: boolean, live: boolean) {
    const book = new Notebook();
    book.replace(source);
    book.cursor = book.current.source.indexOf('B =') + 'B = A * 2'.length;
    return notebookFrame(book, 60, 10, 0, '', false, true, '', 'Running…', undefined, 'rank> ',
        live ? outputs : undefined, undefined, undefined, stepping);
}

it('draws no next-line glyph in a live preview and keeps a bar cursor while editing source', () => {
    const frame = frameOf(false, true);
    expect(frame.lines.join('\n')).not.toContain('▶');
    expect(frame.cursorStyle).toBe(6);
});

it('marks the next line to evaluate while stepping by the color of its dot', () => {
    const frame = frameOf(true, false);
    expect(frame.lines.join('\n')).not.toContain('▶');
    const next = frame.lines.find(line => line.includes('B = A'))!;
    expect(next).toMatch(/\x1b\[36m\s+●/);
    expect(frame.lines.find(line => line.includes('A = N'))!).not.toContain('\x1b[36m');
});
