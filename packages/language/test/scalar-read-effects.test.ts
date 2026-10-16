import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { scalarArithmetic, scalarReadEffects } from '../src/analysis/value-safety.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
const array: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true };
const env = new Map([['A', array], ['B', array], ['I', integer],
    ['callback', { types: ['function'] } as ValueFacts]]);
function expression(source: string) {
    const parsed = parser.parse<Program>(`Result = ${source}\n`);
    expect(parsed.parserErrors).toEqual([]);
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw Error('missing expression');
    return statement.value;
}

it('reports every array read while reusing integer result inference', () => {
    const proof = scalarReadEffects(expression('(A (I ** 2)) + (B 0)'), name => env.get(name));
    expect(proof?.value).toMatchObject({ types: ['integer'], rank: 0 });
    expect([...(proof?.arrays ?? [])]).toEqual(['A', 'B']);
    expect([...(proof?.values ?? [])]).toEqual(['I']);
});

it('proves scalar effects for mixed primitive cells without assuming numeric storage', () => {
    const mixed: ValueFacts = { ...array, elements: ['integer', 'real', 'boolean', 'text'] };
    const proof = scalarReadEffects(expression('(A 0) + 1'), name => name === 'A' ? mixed : env.get(name));
    expect(proof?.value.types).toEqual(['integer', 'real']);
    expect([...(proof?.arrays ?? [])]).toEqual(['A']);
});

it.each(['A', 'A (array 0)', 'A callback', '(A 0) callback', 'array (A 0)',
    '(A 0) divmod 2', '(A 0) to 2', 'A (I / 1)'])
    ('does not promise a callback-free scalar result for %s', source => {
        expect(scalarReadEffects(expression(source), name => env.get(name))).toBeUndefined();
    });

it('requires a proven reader and rejects partial tensor views', () => {
    const read = expression('A I');
    expect(scalarReadEffects(read, name => name === 'A' ? { ...array, eagerScalarCells: undefined } : env.get(name)))
        .toBeUndefined();
    const matrix: ValueFacts = { ...array, rank: 2, shape: [3, 3] };
    const lookup = (name: string) => name === 'A' ? matrix : env.get(name);
    expect(scalarReadEffects(read, lookup)).toBeUndefined();
    expect([...(scalarReadEffects(expression('A I 0'), lookup)?.arrays ?? [])]).toEqual(['A']);
});

it('keeps the diagnostics arithmetic predicate free of array dependencies', () => {
    expect(scalarArithmetic(expression('I ** 2'), env)).toBe(true);
    expect(scalarArithmetic(expression('(A 0) + 1'), env)).toBe(false);
});
