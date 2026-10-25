import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { groupExpressions } from '../src/expression-grouping.js';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
it.each([
    ['Cell in M axis 0', 'does not accept axis or rank'],
    ['Cell in M rank 1', 'does not accept axis or rank'],
    ['Cell i j in M', 'at most one index'],
    ['# i j in M', 'at most one index'],
])('diagnoses removed loop syntax: %s', (header, message) => {
    const result = parser.parse<Program>(`for ${header}\n Cell\nend\n`);
    expect(result.parserErrors).toEqual([]);
    expect(groupExpressions(result.value).diagnostics.some(d => d.message.includes(message))).toBe(true);
});
it.each(['Cell i in M', '# i in M', 'Cell # in M', 'Cell in (M mean axis 0)', 'Cell in (M sum rank 1)', 'Cell in M mean axis 0', 'Cell in M sum rank 1'])(
    'accepts leading-axis bindings and ordinary expressions: %s', header => {
        const result = parser.parse<Program>(`for ${header}\n 1\nend\n`);
        expect(result.parserErrors).toEqual([]);
        expect(groupExpressions(result.value).diagnostics).toEqual([]);
    });
