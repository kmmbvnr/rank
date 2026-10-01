import { describe, expect, it } from 'vitest';
import { mergeTranscripts, wrapCommentLines } from '../src/comment-wrap.js';

describe('wrapCommentLines', () => {
    it('returns rem prefix for empty text', () => {
        expect(wrapCommentLines('')).toBe('rem ');
        expect(wrapCommentLines('   ')).toBe('rem ');
        expect(wrapCommentLines('', 40, '  ')).toBe('  rem ');
    });

    it('formats a short comment on a single line', () => {
        expect(wrapCommentLines('hello world')).toBe('rem hello world');
        expect(wrapCommentLines('hello world', 40, '  ')).toBe('  rem hello world');
    });

    it('wraps text to 40 columns and prefixes continuation lines with rem', () => {
        const text = 'Spoken commentary is automatically wrapped at 40 characters per line to fit mobile terminal width.';
        const wrapped = wrapCommentLines(text, 40);
        const lines = wrapped.split('\n');

        for (const line of lines) {
            expect(line.startsWith('rem ')).toBe(true);
            expect(line.length).toBeLessThanOrEqual(40);
        }

        expect(wrapped).toBe([
            'rem Spoken commentary is automatically',
            'rem wrapped at 40 characters per line to',
            'rem fit mobile terminal width.',
        ].join('\n'));
    });

    it('preserves indentation across all wrapped lines', () => {
        const text = 'Spoken commentary is automatically wrapped at 40 characters per line.';
        const wrapped = wrapCommentLines(text, 40, '  ');
        const lines = wrapped.split('\n');

        for (const line of lines) {
            expect(line.startsWith('  rem ')).toBe(true);
            expect(line.length).toBeLessThanOrEqual(40);
        }

        expect(wrapped).toBe([
            '  rem Spoken commentary is automatically',
            '  rem wrapped at 40 characters per line.',
        ].join('\n'));
    });

    it('places a word exceeding maxColumns on its own line without breaking', () => {
        const longWord = 'supercalifragilisticexpialidociousincomprehensibility';
        const wrapped = wrapCommentLines(`start ${longWord} end`, 40);
        expect(wrapped).toBe(`rem start\nrem ${longWord}\nrem end`);
    });
});

describe('mergeTranscripts', () => {
    it('handles empty inputs', () => {
        expect(mergeTranscripts('', '')).toBe('');
        expect(mergeTranscripts('hello', '')).toBe('hello');
        expect(mergeTranscripts('', 'world')).toBe('world');
        expect(mergeTranscripts('   ', 'world')).toBe('world');
        expect(mergeTranscripts('hello', '   ')).toBe('hello');
    });

    it('deduplicates identical phrases and prefixes', () => {
        expect(mergeTranscripts('hello world', 'hello world')).toBe('hello world');
        expect(mergeTranscripts('Hello World', 'hello world')).toBe('Hello World');
        expect(mergeTranscripts('hello world', 'hello')).toBe('hello world');
        expect(mergeTranscripts('calculate total profit', 'calculate total')).toBe('calculate total profit');
    });

    it('appends supersets without repeating prefix', () => {
        expect(mergeTranscripts('hello', 'hello world')).toBe('hello world');
        expect(mergeTranscripts('hello world', 'hello world again')).toBe('hello world again');
        expect(mergeTranscripts('calculate', 'calculate total profit')).toBe('calculate total profit');
    });

    it('merges overlapping boundary words', () => {
        expect(mergeTranscripts('calculate total', 'total profit')).toBe('calculate total profit');
        expect(mergeTranscripts('we need to find', 'to find the answer')).toBe('we need to find the answer');
        expect(mergeTranscripts('loop through all', 'through all rows in matrix')).toBe('loop through all rows in matrix');
    });

    it('joins non-overlapping phrases with a space', () => {
        expect(mergeTranscripts('hello', 'world')).toBe('hello world');
        expect(mergeTranscripts('first phrase', 'second phrase')).toBe('first phrase second phrase');
    });

    it('handles punctuation across segment boundaries', () => {
        expect(mergeTranscripts('calculate total.', 'total profit')).toBe('calculate total. profit');
        expect(mergeTranscripts('hello,', 'hello world')).toBe('hello, world');
    });

    it('simulates consecutive Android Google Speech Recognition events', () => {
        const events = [
            'calculate',
            'calculate total',
            'total profit',
            'profit for each',
            'for each region',
        ];
        let transcript = '';
        for (const ev of events) {
            transcript = mergeTranscripts(transcript, ev);
        }
        expect(transcript).toBe('calculate total profit for each region');
    });

    it('simulates Android recognition restarting after a pause', () => {
        const session1 = 'set count to zero';
        const session2 = 'zero and loop through array';
        expect(mergeTranscripts(session1, session2)).toBe('set count to zero and loop through array');
    });
});
