import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;

describe('unfinished editor input', () => {
    it.each(['array', 'array ', 'X = array', 'array shape', 'array shape 2 fill', 'X = (1 +'])
        ('keeps syntax error paths bounded for %j', source => {
            const result = parser.parse(source);
            expect(result.parserErrors.length).toBeGreaterThan(0);
            // The three-token expansion for `array` alone generated 162 KB of
            // error text and blocked every autocomplete/delete repaint.
            for (const error of result.parserErrors) expect(error.message.length).toBeLessThan(8_000);
        });

    it('still parses completed input after errors', () => {
        parser.parse('array');
        const result = parser.parse('A = array shape 2 3 fill 1\nA + 1');
        expect(result.lexerErrors).toEqual([]);
        expect(result.parserErrors).toEqual([]);
    });
});
