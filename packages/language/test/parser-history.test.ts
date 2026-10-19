import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';

it('keeps declaration grouping and syntax diagnostics stable across many documents', () => {
    const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
    const error = () => {
        const result = parser.parse('Value = (1 + )\n');
        expect(result.lexerErrors).toEqual([]);
        expect(result.parserErrors).toHaveLength(1);
        const first = result.parserErrors[0];
        return { message: first.message, offset: first.token.startOffset, token: first.token.image };
    };
    const expected = error();
    for (let index = 0; index < 128; index++) {
        const result = parser.parse(`fun X plus = X + 1\nValue${index} = 2 plus\n`);
        expect(result.lexerErrors).toEqual([]);
        expect(result.parserErrors).toEqual([]);
        expect(error()).toEqual(expected);
    }
}, 15_000);
