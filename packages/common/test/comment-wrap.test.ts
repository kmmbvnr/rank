import { describe, expect, it } from 'vitest';
import { wrapCommentLines } from '../src/comment-wrap.js';

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
