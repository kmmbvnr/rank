import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const matrix = 'M = array shape 2 3\n 1 2 3\n 4 5 6\nend\n';
const plus = 'fun A plus B\n return A + B\nend\n';
function facts(source: string, expression: string) {
    const parsed = parser.parse<Program>(`use sequences\n${plus}${source}Result = ${expression}\n`);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    expect(analysis.diagnostics).toEqual([]);
    return analysis.bindings.get('Result');
}

it.each(['+', 'plus', 'min'])('infers ranked and axis fold shapes for %s', operation => {
    expect(facts(matrix, `M reduce ${operation} rank 1 with 0`))
        .toMatchObject({ types: ['array'], rank: 1, shape: [2], elements: ['integer'] });
    expect(facts(matrix, `M reduce ${operation} axis 0 with 0`))
        .toMatchObject({ types: ['array'], rank: 1, shape: [3], elements: ['integer'] });
    expect(facts(matrix, `M reduce ${operation} axis 1 0 with 0`))
        .toMatchObject({ types: ['integer'], rank: 0, shape: [] });
    expect(facts(matrix, `M scan ${operation} rank 1 with 0`))
        .toMatchObject({ types: ['array'], rank: 2, shape: [2, 4], elements: ['integer'] });
    expect(facts(matrix, `M scan ${operation} axis 0 with 0`))
        .toMatchObject({ types: ['array'], rank: 2, shape: [3, 3], elements: ['integer'] });
    expect(facts(matrix, `M scan ${operation} rank 2`))
        .toMatchObject({ types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'] });
});

it.each(['+', 'plus'])('preserves empty axis and empty frame shapes for %s', operation => {
    const empty = 'E = array shape 2 0 3 fill 0\n';
    expect(facts(empty, `E reduce ${operation} axis 1 with 7`)).toMatchObject({ shape: [2, 3], elements: ['integer'] });
    expect(facts(empty, `E reduce ${operation} rank 1 with 7`)).toMatchObject({ shape: [2, 0] });
    expect(facts(empty, `E scan ${operation} axis 1 with 7`)).toMatchObject({ shape: [2, 1, 3] });
    expect(facts(empty, `E scan ${operation} rank 1 with 7`)).toMatchObject({ shape: [2, 0, 4] });
});

it('infers boolean and mixed numeric cells without narrowing a one-element fold', () => {
    expect(facts('B = array shape 2 3 fill true\n', 'B scan and axis 1 with true'))
        .toMatchObject({ types: ['array'], shape: [2, 4], elements: ['boolean'] });
    expect(facts(matrix, 'M reduce + axis 0 with 0.5'))
        .toMatchObject({ shape: [3], elements: ['integer', 'real'] });
    expect(facts('V = array 2\n', 'V reduce /')).toMatchObject({ types: ['integer', 'real'] });
    expect(facts('V = array 2 -1\n', 'V reduce **')).toMatchObject({ types: ['integer', 'real'] });
});

it('does not claim numeric cells for a type-changing callback', () => {
    expect(facts('fun A mystery B\n return B text\nend\n' + matrix, 'M reduce mystery rank 1')?.elements)
        .toBeUndefined();
});
