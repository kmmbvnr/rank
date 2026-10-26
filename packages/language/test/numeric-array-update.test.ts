import { EmptyFileSystem, AstUtils } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isArrayAssignmentStatement, type Program } from '../src/generated/ast.js';
import { numericUpdateExpression, statementResultDiscarded } from '../src/analysis/numeric-array-update.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function update(source: string) {
    const parsed = parser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const statement = [...AstUtils.streamAllContents(parsed.value)].find(isArrayAssignmentStatement);
    if (!statement) throw Error('missing array update');
    return statement;
}

it.each([
    ['A I += D + K\nDone = true', true],
    ['A I += D + K', false],
    ['for N in 1 to 3\n A I += B\nend', false],
    ['for N in 1 to 3\n A I += B\nend\nDone = true', true],
    ['if true\n A I += B\nend\nDone = true', true],
    ['fun A I B f\n A I += B\nend\nDone = true', false],
    ['fun A I B f\n A I += B\n return A\nend', true],
])('tracks whether the result escapes: %s', (source, expected) => {
    expect(statementResultDiscarded(update(source))).toBe(expected);
});

it.each(['D + K', 'Phi I // P', 'Factor * Work Row', '(A + B) * C'])('recognizes %s without proving its operands', source => {
    expect(numericUpdateExpression(update(`Target I += ${source}`).value)).toBeDefined();
});

it.each(['Values filter even', 'Values callback', 'A ** 2', 'A random', 'A (I + 1)'])('leaves unclassified syntax to ordinary evaluation: %s', source => {
    const recipe = numericUpdateExpression(update(`Target I += ${source}`).value);
    // A simple application is only an address candidate; a runtime function
    // binding cannot satisfy its stored numeric receiver guard.
    if (source === 'Values callback' || source === 'A random') expect(recipe?.kind).toBe('select');
    else expect(recipe).toBeUndefined();
});
