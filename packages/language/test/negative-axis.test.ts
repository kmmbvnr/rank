import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { expressionFacts } from '../src/analysis/value-facts.js';
import { groupExpressions } from '../src/expression-grouping.js';
import { isAssignmentStatement } from '../src/generated/ast.js';
import { rankedFunctionFacts } from '../src/analysis/ranked-function-facts.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';

const services = createRankServices(EmptyFileSystem);
function analyze(expression: string) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'use sequences\nuse stats\nM = array shape 2 3\n 1 2 3\n 4 5 6\nend\n' + expression + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value);
}
it.each([
    ['M reduce + axis -1', [2]], ['M reduce + axis -2', [3]],
    ['M reduce + axis -2 -1', []], ['M sum axis -1', [2]],
    ['M mean axis -1', [2]], ['M std axis -2', [3]],
    ['M scan + axis -1', [2, 3]],
    ['M window 2 axis -1', [2, 2, 2]],
    ['M M equal axis -1', [2]], ['M len axis -1', []],
    ['M reduce + rank 1 axis -2', [3]],
] as const)('infers normalized result shapes: %s', (expression, shape) => {
    const result = analyze('Result = ' + expression);
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('Result')).toMatchObject({ rank: shape.length, shape });
});
it.each(['M reduce + axis 1 -1', 'M sum axis 1 -1', 'M reverse axis 1 -1',
    'M transpose axis 1 -1', 'M window 1 1 axis 1 -1', 'M M equal axis 1 -1'])('diagnoses normalized duplicates: %s', expression => {
    expect(analyze('Result = ' + expression).diagnostics.some(d => d.message.includes('unique'))).toBe(true);
});
it.each(['M reduce + axis -3', 'M sum axis -3', 'M reverse axis -3',
    'M scan + axis -3', 'M transpose axis 0 -3', 'M window 1 axis -3'])('diagnoses out-of-range axes: %s', expression => {
    expect(analyze('Result = ' + expression).diagnostics.some(d => d.message.includes('invalid for rank 2'))).toBe(true);
});
it('checks trailing input cells after normalization', () => {
    expect(analyze('Result = M reduce + rank 1 axis -1').diagnostics.some(d => d.message.includes('outside the trailing input cell'))).toBe(true);
});
it('accepts implicit pipelines and a source whose rank is not known yet', () => {
    expect(analyze('products = reduce * axis -1 max\nResult = M products').diagnostics).toEqual([]);
    expect(analyze('fun X total\n return X sum axis -1\nend').diagnostics).toEqual([]);
});

it('normalizes concat and callback axes with known source facts', () => {
    const source = { types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'], eagerScalarCells: true as const };
    const parsed = services.Rank.parser.LangiumParser.parse<Program>('use sequences\nResult = concat M M axis -1\n').value;
    groupExpressions(parsed);
    const assignment = parsed.statements[1];
    if (!isAssignmentStatement(assignment)) throw Error('expected assignment');
    expect(expressionFacts(assignment.value, name => name === 'M' ? source : undefined)).toMatchObject({ rank: 2, shape: [2, 6] });
    expect(rankedFunctionFacts([source], [1], cells => cells[0], [-1])).toMatchObject({ rank: 2, shape: [2, 3] });
    expect(rankedFunctionFacts([source], [1], cells => ({ ...cells[0], shape: [4] }), [-2])).toMatchObject({ rank: 2, shape: [4, 3] });
});

it('checks all loop cell axes rather than treating the last one as an index', () => {
    expect(analyze('for Cell in M axis -1\n Cell sum\nend').diagnostics).toEqual([]);
    expect(analyze('for Cell in M axis 1 -1\n Cell sum\nend').diagnostics.some(d => d.message.includes('unique'))).toBe(true);
    expect(analyze('for Cell in M axis -3\n Cell sum\nend').diagnostics.some(d => d.message.includes('invalid for rank 2'))).toBe(true);
});
