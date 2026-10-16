import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isApplicationExpression, isFunctionStatement, isReturnStatement, type Program } from '../src/generated/ast.js';
import { flattenApplication } from '../src/expressions.js';
import { lastArrayUseArguments, lastArrayUseProofs } from '../src/analysis/last-array-use.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function call(before: string, after = '', parameters = 'A') {
    const parsed = parser.parse<Program>(`fun ${parameters} forward\n ${before}\n return A change\n ${after}\nend\n`);
    expect(parsed.parserErrors).toEqual([]);
    const fn = parsed.value.statements[0];
    if (!isFunctionStatement(fn)) throw Error('missing function');
    const statement = fn.statements.find(isReturnStatement);
    if (!statement || !isApplicationExpression(statement.value)) throw Error('missing call');
    return { expression: statement.value, arguments_: flattenApplication(statement.value).slice(0, -1) };
}
function candidates(before: string, after = '') {
    const { expression, arguments_ } = call(before, after);
    return lastArrayUseArguments(expression, arguments_);
}
function proofs(before: string, parameters = 'A') {
    const { expression, arguments_ } = call(before, '', parameters);
    return lastArrayUseProofs(expression, arguments_);
}

it.each(['First = A 0', 'First = (A (-0))', 'First = (A) (1)',
    'First = A 0\n Second = A 1', 'for I in 0 till 2\n First = A 0\nend'])
    ('allows earlier directly bound integer cell reads: %s', before => {
        expect(candidates(before)).toEqual(['A']);
    });

it.each(['First = A', 'First = A len', 'First = A retain', 'First = A (array 0)',
    'First = A I', 'First = A 0.0', 'First = A 0 retain', 'First = (A 0) retain',
    'First = array (A 0)', 'First = (A 0) divmod 1', 'First = (A 0) to 3',
    'A = A 0', 'First = A 0\n Ignored = A retain'])
    ('rejects an earlier whole-array or unclassified use: %s', before => {
        expect(candidates(before)).toEqual([undefined]);
    });

it('still rejects a later use after an earlier cell read', () => {
    expect(candidates('First = A 0', 'Later = A 0')).toEqual([undefined]);
});

it.each(['First = A I', 'First = A (I + 1)', 'First = A ((I * 2) // 2 mod 3)',
    'First = A (-I)', 'First = A I\n Second = A (I + 1)'])
    ('requires integer guards for unchanged index parameters: %s', before => {
        expect(proofs(before, 'A I')).toEqual([{ name: 'A', integerSelectors: ['I'] }]);
    });

it('guards an index bound once before the read, regardless of its initializer', () => {
    expect(proofs('I = 0\n First = A (I + 1)')).toEqual([{ name: 'A', integerSelectors: ['I'] }]);
    expect(proofs('I = Input\n First = A I')).toEqual([{ name: 'A', integerSelectors: ['I'] }]);
    expect(candidates('I = 0\n First = A I')).toEqual([undefined]);
});

it('allows integer arithmetic without runtime guards when it has no names', () => {
    expect(candidates('First = A ((1 + 1) // 2)')).toEqual(['A']);
});

it.each(['First = (A 0) + 1', 'First = (A 0) equal 1',
    'if (A 0) equal 1\n First = 0\nend', 'A 0'])
    ('proves scalar reads independently of their enclosing syntax: %s', before => {
        expect(candidates(before)).toEqual(['A']);
    });

it('uses the existing value inference for integer powers in selectors', () => {
    expect(proofs('First = A (I ** 2)', 'A I')).toEqual([{ name: 'A', integerSelectors: ['I'] }]);
    expect(proofs('First = A (I ** -1)', 'A I')).toEqual([undefined]);
});

it.each(['I = 0\n First = A I\n I = 1', 'I = 0\n First = A I\n I += 1',
    'First = A I\n I = 0', 'I = 0\n First = A I\n I J = array 1 2',
    'I = 0\n First = A I\n for I in 0 till 2\n Ignored = I\n end',
    'I = 0\n for J in 0 till 2\n First = A I\n end',
    'I = 0\n First = A (I / 1)', 'I = 0\n First = A (I len)'])
    ('rejects mutable indices and unproved arithmetic: %s', before => {
        expect(proofs(before)).toEqual([undefined]);
    });
