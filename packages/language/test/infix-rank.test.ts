import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function analyze(expression: string, declarations = 'B = array 3 6') {
    const parsed = parser.parse<Program>(`use sequences
A = array shape 2 3 fill 1
${declarations}
Result = ${expression}`);
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value);
}

it.each(['+', '-', '*', '/', '//', 'mod', '**'])('infers infix %s cells and frames', operator => {
    const analysis = analyze(`A ${operator} B rank 1 0`);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.bindings.get('Result')).toMatchObject({ types: ['array'], rank: 2, shape: [2, 3] });
});

it('infers negative ranks and empty shapes', () => {
    expect(analyze('A - B rank -1 0').bindings.get('Result')).toMatchObject({ rank: 2, shape: [2, 3] });
    expect(analyze('E - B rank 1 0', 'B = array 3 6\nE = array shape 2 0 fill 0')
        .bindings.get('Result')).toMatchObject({ rank: 2, shape: [2, 0] });
});

it('diagnoses incompatible ranked frames while ordinary broadcasting stays unchanged', () => {
    expect(analyze('A - B rank 1 0', 'B = array 1 2 3').diagnostics)
        .toMatchObject([{ kind: 'DimensionMismatch' }]);
    expect(analyze('A - B').diagnostics).toMatchObject([{ kind: 'DimensionMismatch' }]);
});
