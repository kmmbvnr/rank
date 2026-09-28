import { expect, it } from 'vitest';
import { textEdit } from '../src/input-edit.js';

const apply = (previous: string, edit: ReturnType<typeof textEdit>) =>
    previous.slice(0, edit.from) + edit.text + previous.slice(edit.to);

it('anchors a deletion among repeated characters at the caret', () => {
    // Backspace between the two letters of `aa` removes the first one; the caret ends at 0.
    expect(textEdit('aa', 'a', 0)).toEqual({ from: 0, to: 1, text: '' });
    expect(textEdit('end', 'ed', 1)).toEqual({ from: 1, to: 2, text: '' });
});

it('anchors an insertion among repeated characters at the caret', () => {
    expect(textEdit('aa', 'aaa', 1)).toEqual({ from: 0, to: 0, text: 'a' });
    expect(textEdit('aa', 'aaa', 3)).toEqual({ from: 2, to: 2, text: 'a' });
});

it('handles replacements, autocorrect and pastes', () => {
    for (const [previous, value, caret] of [
        ['fun tset N', 'fun test N', 8], ['X = 1', 'X = 1 + 2', 9], ['abc', '', 0], ['', 'end', 3],
    ] as const) {
        const edit = textEdit(previous, value, caret);
        expect(apply(previous, edit)).toBe(value);
        expect(edit.from + edit.text.length).toBe(caret);
    }
});

it('falls back to a plain diff when the caret does not fit the change', () => {
    const edit = textEdit('abc', 'axc', 0);
    expect(edit).toEqual({ from: 1, to: 2, text: 'x' });
    expect(apply('abc', textEdit('abc', 'abxc', null))).toBe('abxc');
});
