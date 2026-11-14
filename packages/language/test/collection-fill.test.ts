import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues, applicationForm, createRankServices, isAssignmentStatement, type Program } from '../src/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
it.each([
    'A M fill 0', 'A M fill -1', 'A unique shape 8 fill 0',
    'A findall 2 shape 8 fill -1', 'M indices shape 8 fill -1',
    'A M shape 2 3 fill 0', 'A unique shape 2 3 fill 0', 'M indices shape (array 2 3) fill -1',
])('parses and classifies %s', source => {
    const result = parser.parse<Program>(`Result = ${source}`);
    expect(result.lexerErrors).toEqual([]);
    expect(result.parserErrors).toEqual([]);
    const statement = result.value.statements[0];
    if (!isAssignmentStatement(statement)) throw Error('expected assignment');
    expect(applicationForm(statement.value).kind).toBe('collection-fill');
});

it('retains source shape and fixed result capacity in analysis', () => {
    const parsed = parser.parse<Program>(`use sequences
A = (1 to 6) reshape 2 3
M = A greater 2
Filled = A M fill 0
Positions = M indices shape 8 fill -1
Vector = array 1 2 1
Distinct = Vector unique shape 5 fill 0
Total = Vector unique shape 5 fill 0 sum
`);
    expect(parsed.parserErrors).toEqual([]);
    const facts = analyzeValues(parsed.value);
    expect(facts.diagnostics).toEqual([]);
    const result = (name: string) => facts.assignments.get(parsed.value.statements.filter(isAssignmentStatement).find(statement => statement.name === name)!);
    expect(result('Filled')?.shape).toEqual([2, 3]);
    expect(result('Positions')?.shape).toEqual([8, 2]);
    expect(result('Distinct')?.shape).toEqual([5]);
    expect(result('Total')?.rank).toBe(0);
});

it('keeps runtime capacity unknown in static shape facts', () => {
    const parsed = parser.parse<Program>(`use sequences
arg Count integer = 5
A = array 1 2 1
Result = A unique shape Count fill 0
`);
    const facts = analyzeValues(parsed.value);
    expect(facts.diagnostics).toEqual([]);
    const statement = parsed.value.statements.filter(isAssignmentStatement).at(-1)!;
    expect(facts.assignments.get(statement)?.shape).toEqual([null]);
});

it('preserves existing array fill parsing', () => {
    const parsed = parser.parse<Program>('A = array shape 2 3 fill -1');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.shape).toEqual([2, 3]);
});

it('uses the scalar fill type for an empty bounded result', () => {
    const parsed = parser.parse<Program>('use sequences\nA = array 1 2\nEmpty = A unique shape 0 fill 0.5');
    const facts = analyzeValues(parsed.value);
    const statement = parsed.value.statements.filter(isAssignmentStatement).at(-1)!;
    expect(facts.assignments.get(statement)?.shape).toEqual([0]);
    expect(facts.assignments.get(statement)?.elements).toEqual(['real']);
});

it('retains every requested result dimension and coordinate cell shape', () => {
    const parsed = parser.parse<Program>(`use sequences
arg Rows integer = 2
A = (1 to 6) reshape 2 3
M = A greater 2
Collected = A M shape 2 3 fill 0
Positions = M indices shape 2 3 fill -1
Dims = array 3 2
ByVector = A M shape Dims fill 0
Dynamic = A M shape Rows 3 fill 0
Empty = A M shape 2 0 3 fill 0.5
`);
    expect(parsed.parserErrors).toEqual([]);
    const facts = analyzeValues(parsed.value);
    expect(facts.diagnostics).toEqual([]);
    const result = (name: string) => facts.assignments.get(parsed.value.statements.filter(isAssignmentStatement).find(statement => statement.name === name)!);
    expect(result('Collected')?.shape).toEqual([2, 3]);
    expect(result('Positions')?.shape).toEqual([2, 3, 2]);
    expect(result('ByVector')?.shape).toEqual([3, 2]);
    expect(result('Dynamic')?.shape).toEqual([null, 3]);
    expect(result('Empty')?.shape).toEqual([2, 0, 3]);
    expect(result('Empty')?.elements).toEqual(['real']);
});
