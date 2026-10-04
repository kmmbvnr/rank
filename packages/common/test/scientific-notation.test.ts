import { describe, expect, it } from 'vitest';
import { formatLine, tokenize } from '../src/repl-input.js';
import { createReplSession } from '../src/repl-session.js';

describe('scientific notation', () => {
    const show = async (source: string): Promise<string> => {
        const session = createReplSession();
        try { return (await session.execute(source, 1, [])).output.map(line => line.text).join(' | '); } finally { session.dispose(); }
    };

    it('reads a whole number with a non-negative exponent as an integer', async () => {
        expect(await show('4e6')).toBe('4000000');
        expect(await show('4E6')).toBe('4000000');
        expect(await show('2e+3')).toBe('2000');
        expect(await show('4e6 + 1')).toBe('4000001');
        expect(await show('25e0')).toBe('25');
        expect(await show('(4e6) type')).toBe('.integer');
    });

    it('reads a decimal point or a negative exponent as a real', async () => {
        expect(await show('1.5e3')).toBe('1500');
        expect(await show('1e-3')).toBe('0.001');
        expect(await show('1.25e-2')).toBe('0.0125');
        expect(await show('(1.5e3) type')).toBe('.real');
        expect(await show('(1e-3) type')).toBe('.real');
    });

    it('keeps an exponent attached to its number while a line is formatted', () => {
        expect(formatLine('2e+3')).toBe('2e+3');
        expect(formatLine('X=1e-3+1')).toBe('X = 1e-3 + 1');
        expect(tokenize('4e6').map(item => [item.kind, item.text])).toEqual([['number', '4e6']]);
    });

    it('does not take a following name for an exponent', async () => {
        expect(await show('3 e2')).toContain('unknown name: e2');
    });
});
