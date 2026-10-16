import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isApplicationExpression, isFunctionStatement, isReturnStatement, type Program } from '../src/generated/ast.js';
import { flattenApplication } from '../src/expressions.js';
import { lastArrayUseArguments } from '../src/analysis/last-array-use.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function candidates(before: string, after = '') {
    const parsed = parser.parse<Program>(`fun A forward\n ${before}\n return A change\n ${after}\nend\n`);
    expect(parsed.parserErrors).toEqual([]);
    const fn = parsed.value.statements[0];
    if (!isFunctionStatement(fn)) throw Error('missing function');
    const statement = fn.statements.find(isReturnStatement);
    if (!statement || !isApplicationExpression(statement.value)) throw Error('missing call');
    return lastArrayUseArguments(statement.value, flattenApplication(statement.value).slice(0, -1));
}

it.each(['First = A 0', 'First = (A (-0))', 'First = (A) (1)',
    'First = A 0\n Second = A 1', 'for I in 0 till 2\n First = A 0\nend'])
    ('allows earlier directly bound integer cell reads: %s', before => {
        expect(candidates(before)).toEqual(['A']);
    });

it.each(['First = A', 'First = A len', 'First = A retain', 'First = A (array 0)',
    'First = A I', 'First = A 0.0', 'First = A 0 retain', 'First = (A 0) retain',
    'First = array (A 0)', 'A = A 0', 'First = A 0\n Ignored = A retain'])
    ('rejects an earlier whole-array or unclassified use: %s', before => {
        expect(candidates(before)).toEqual([undefined]);
    });

it('still rejects a later use after an earlier cell read', () => {
    expect(candidates('First = A 0', 'Later = A 0')).toEqual([undefined]);
});
