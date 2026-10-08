import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isExpressionStatement, isApplicationExpression, type Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;

it('recognizes lazy merge and keyed merge as sequences without reading their items', () => {
    const source = [
        'use sequences',
        'fun identity X',
        '  return X',
        'end',
        'A = array 1 3 5',
        'B = array 2 4 6',
        'Plain = A B merge',
        'Keyed = A B merge by identity',
        'C = array 5 3 1',
        'D = array 6 4 2',
        'Directed = C D merge .descending',
    ].join('\n');
    const parsed = parser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    expect(analysis.bindings.get('Plain')?.types).toEqual(['sequence']);
    expect(analysis.bindings.get('Plain')?.elements).toEqual(['integer']);
    expect(analysis.bindings.get('Keyed')?.types).toEqual(['sequence']);
    expect(analysis.bindings.get('Keyed')?.elements).toEqual(['integer']);
    expect(analysis.bindings.get('Directed')?.types).toEqual(['sequence']);
    expect(analysis.bindings.get('Directed')?.elements).toEqual(['integer']);
});

it('reserves the contextual graph merge name when graph is open', () => {
    const parsed = parser.parse<Program>('use graph\nfun merge A B\n  return A\nend');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).diagnostics.map(diagnostic => diagnostic.message))
        .toContain('cannot redefine available builtin: merge');
});


it('preserves typed scalar merge cells through a filter with a later pure predicate', () => {
    const parsed = parser.parse<Program>('use sequences\nProducts = array 9009 9010 shape 1 2\n'
        + 'Candidates = Products merge .descending\nAnswer = Candidates filter palindrome first\n'
        + 'fun palindrome X\n Text = X text\n return Text equal (Text reverse)\nend');
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    expect(analysis.bindings.get('Candidates')).toMatchObject({ types: ['sequence'], elements: ['integer'] });
    expect(analysis.bindings.get('Answer')).toMatchObject({ types: ['integer'], rank: 0 });
});

it('does not keep source facts across an unknown filter callback', () => {
    const parsed = parser.parse<Program>('use sequences\nCandidates = 1 to 3\n'
        + 'Answer = Candidates filter opaque first\nfun opaque X\n return X unknown_callback\nend');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('Answer')?.types).toEqual([]);
});


it('records a direct argument before an effectful call without preserving the binding afterwards', () => {
    const parsed = parser.parse<Program>('use io\nAnswer = 42\nAnswer print\nAnswer');
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    const print = parsed.value.statements[2];
    if (!isExpressionStatement(print) || !isApplicationExpression(print.value)) throw new Error('expected print call');
    expect(analysis.expressions.get(print.value.head)?.types).toEqual(['integer']);
    expect(analysis.bindings.get('Answer')?.types).toEqual([]);
});
