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
    expect(facts(matrix, `M reduce ${operation} axis 1 with 0`))
        .toMatchObject({ types: ['array'], rank: 1, shape: [2], elements: ['integer'] });
    expect(facts(matrix, `M reduce ${operation} axis 0 with 0`))
        .toMatchObject({ types: ['array'], rank: 1, shape: [3], elements: ['integer'] });
    expect(facts(matrix, `M reduce ${operation} axis 1 0 with 0`))
        .toMatchObject({ types: ['integer'], rank: 0, shape: [] });
    expect(facts(matrix, `M scan ${operation} axis 1 with 0`))
        .toMatchObject({ types: ['array'], rank: 2, shape: [2, 4], elements: ['integer'] });
    expect(facts(matrix, `M scan ${operation} axis 0 with 0`))
        .toMatchObject({ types: ['array'], rank: 2, shape: [3, 3], elements: ['integer'] });
    expect(facts(matrix, `M scan ${operation} axis 0`))
        .toMatchObject({ types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'] });
});

it.each(['+', 'plus'])('preserves empty axis and empty frame shapes for %s', operation => {
    const empty = 'E = array shape 2 0 3 fill 0\n';
    expect(facts(empty, `E reduce ${operation} axis 1 with 7`)).toMatchObject({ shape: [2, 3], elements: ['integer'] });
    expect(facts(empty, `E reduce ${operation} axis 2 with 7`)).toMatchObject({ shape: [2, 0] });
    expect(facts(empty, `E scan ${operation} axis 1 with 7`)).toMatchObject({ shape: [2, 1, 3] });
    expect(facts(empty, `E scan ${operation} axis 2 with 7`)).toMatchObject({ shape: [2, 0, 4] });
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
    expect(facts('fun A mystery B\n return B text\nend\n' + matrix, 'M reduce mystery axis 1')?.elements)
        .toBeUndefined();
});

it('infers symbolic input-cell shapes without treating callback cells as scalars', () => {
    expect(facts(matrix, 'M reduce + rank 1 axis 0'))
        .toMatchObject({ types: ['array'], rank: 1, shape: [3], elements: ['integer'] });
    expect(facts('T = array shape 2 3 4 fill 1\n', 'T reduce + rank 1 axis 1'))
        .toMatchObject({ types: ['array'], rank: 2, shape: [2, 4], elements: ['integer'] });
    expect(facts(matrix, 'M reduce +')).toMatchObject({ rank: 0, shape: [] });
});

it('uses the scalar seed shape for empty input-cell folds and frames', () => {
    expect(facts('E = array shape 0 3 fill 0\n', 'E reduce + rank 1 axis 0 with 7'))
        .toMatchObject({ rank: 0, shape: [] });
    expect(facts('E = array shape 0 2 3 fill 0\n', 'E reduce + rank 1 axis 1 with 7'))
        .toMatchObject({ rank: 1, shape: [0] });
});

it.each(['+', 'plus', 'max'])('infers input-cell scan states for %s', operation => {
    expect(facts(matrix, `M scan ${operation} rank 1 axis 0`))
        .toMatchObject({ types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'] });
    expect(facts(matrix, `M scan ${operation} axis -2 rank 1 with (array 0 0 0)`))
        .toMatchObject({ rank: 2, shape: [3, 3], elements: ['integer'] });
    expect(facts('T = array shape 2 3 4 fill 1\n', `T scan ${operation} rank 1 axis 1`))
        .toMatchObject({ rank: 3, shape: [2, 3, 4] });
    expect(facts('T = array shape 2 3 4 fill 1\n', `T scan ${operation} rank 2 axis 0 with (array shape 3 4 fill 0)`))
        .toMatchObject({ rank: 3, shape: [3, 3, 4] });
});

it('uses accumulator shapes independently of input-cell shapes', () => {
    expect(facts('fun Acc total Row = Acc + (Row sum)\n', '((array 1 2 3 4 5 6) reshape 2 3) scan total rank 1 axis 0 with 0'))
        .toMatchObject({ rank: 1, shape: [3], elements: ['integer'] });
    expect(facts(matrix, 'M scan + rank 0 axis 1 with (array 10 20)'))
        .toMatchObject({ rank: 3, shape: [2, 4, 2], elements: ['integer'] });
    expect(facts('E = array shape 0 2 3 fill 0\n', 'E scan + rank 1 axis 1 with (array 7 8)'))
        .toMatchObject({ shape: [0, 3, 2] });
    expect(facts('E = array shape 0 3 fill 0\n', 'E scan + rank 1 axis 0'))
        .toMatchObject({ shape: [0, 3] });
});

it.each(['reduce +', 'reduce plus', 'scan +', 'scan plus'])('diagnoses missing traversal axes for %s', fold => {
    for (const rank of [0, 1, 2]) {
        const parsed = parser.parse<Program>(`${plus}${matrix}M ${fold} rank ${rank}\n`);
        expect(analyzeValues(parsed.value).diagnostics.some(d => d.message.includes('requires an explicit axis'))).toBe(true);
    }
    const parsed = parser.parse<Program>(`${plus}${matrix}M ${fold} rank 2 axis -1\n`);
    expect(analyzeValues(parsed.value).diagnostics.some(d => d.message.includes('axis count exceeds'))).toBe(true);
});

it('infers cells from remaining axes for reduce and scan (#454)', () => {
    expect(facts(matrix, 'M reduce + rank 1 axis 1')).toMatchObject({ shape: [2], rank: 1 });
    const tensor = 'T = array shape 2 3 4 fill 1\n';
    expect(facts(tensor, 'T reduce + rank 1 axis 2')).toMatchObject({ shape: [2, 3], rank: 2 });
    expect(facts(tensor, 'T reduce + rank 2 axis 1')).toMatchObject({ shape: [2, 4], rank: 2 });
    expect(facts(tensor, 'T reduce + rank 1 axis 2 0')).toMatchObject({ shape: [3], rank: 1 });
    for (const operation of ['+', 'plus', 'max']) {
        expect(facts(matrix, `M scan ${operation} rank 1 axis 1`)).toMatchObject({ shape: [3, 2], rank: 2 });
        expect(facts(tensor, `T scan ${operation} rank 1 axis 2`)).toMatchObject({ shape: [2, 4, 3], rank: 3 });
        expect(facts(tensor, `T scan ${operation} rank 2 axis 1`)).toMatchObject({ shape: [3, 2, 4], rank: 3 });
    }
    for (const expression of ['M reduce plus rank 1 axis 1', 'T reduce plus rank 1 axis 2', 'T reduce plus rank 2 axis 1']) {
        facts(matrix + tensor, expression); // Unknown callback result shapes stay conservative.
    }
});

it('infers empty selected cells and seeded states on nonleading traversal axes', () => {
    expect(facts('E = array shape 2 0 fill 0\n', 'E reduce + rank 1 axis 1')).toMatchObject({ shape: [2] });
    expect(facts('E = array shape 2 0 fill 0\n', 'E scan + rank 1 axis 1')).toMatchObject({ shape: [0, 2] });
    expect(facts('E = array shape 0 2 3 fill 0\n', 'E reduce + rank 1 axis 2')).toMatchObject({ shape: [0, 2] });
    expect(facts('E = array shape 0 2 3 fill 0\n', 'E scan + rank 1 axis 2')).toMatchObject({ shape: [0, 3, 2] });
    expect(facts(matrix, 'M scan + rank 1 axis 1 with (array 10 20)')).toMatchObject({ shape: [4, 2] });
    expect(facts('fun Acc total Col = Acc + (Col sum)\n' + matrix, '((array 1 2 3 4 5 6) reshape 2 3) scan total rank 1 axis 1 with 0'))
        .toMatchObject({ shape: [4] });
});

it.each(['+', 'plus'])('requires explicit fold axes for %s even with unknown inputs', operation => {
    for (const fold of ['reduce', 'scan']) {
        for (const source of ['M', '(array 1 2 3)', '(1 to 3)', '"abc"', 'Input']) {
            for (const rank of [0, 1]) {
                for (const seed of ['', ' with 0']) {
                    const parsed = parser.parse<Program>(`use sequences\n${plus}${matrix}${source} ${fold} ${operation} rank ${rank}${seed}`);
                    expect(parsed.parserErrors).toEqual([]);
                    expect(analyzeValues(parsed.value).diagnostics.map(d => d.message), `${source} ${fold} ${operation} rank ${rank}${seed}`)
                        .toContain(`${fold} with rank requires an explicit axis; specify rank R axis N`);
                }
            }
        }
    }
});
