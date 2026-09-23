import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices, isFunctionStatement, type Program } from '@arrrank/language';
import { prepareFunction } from '../src/prepared-function.js';

const services = createRankServices(EmptyFileSystem);

function borrowed(source: string): ReadonlySet<string> {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definition = parsed.value.statements.find(isFunctionStatement)!;
    return prepareFunction(definition).borrowedParameters;
}

it('borrows direct scalar reads but not array-derived results', () => {
    expect(borrowed('fun read X\n return X 0\nend')).toEqual(new Set(['X']));
    expect(borrowed('fun read X\n return (X 0) * 2\nend')).toEqual(new Set(['X']));
    expect(borrowed('fun transform X\n return X * 2\nend')).toEqual(new Set());
    expect(borrowed('fun transform X\n return X\nend')).toEqual(new Set());
});
