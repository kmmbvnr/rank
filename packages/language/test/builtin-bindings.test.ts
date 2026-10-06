import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function messages(source: string) {
    const parsed = parser.parse<Program>(source + '\n');
    expect(parsed.parserErrors.map(error => error.message)).toEqual([]);
    return analyzeValues(parsed.value).diagnostics.map(diagnostic => diagnostic.message);
}

it('reports core, local and parameter conflicts', () => {
    for (const source of ['fun sum X\n return X\nend', 'fun f sum\n return sum\nend',
        'fun f X\n fun sum Y\n return Y\n end\n return X\nend']) {
        expect(messages(source)).toContain('cannot redefine available builtin: sum');
    }
});

it('reserves module names only when the module is opened, in either order', () => {
    const declaration = 'fun solve X\n return X\nend';
    expect(messages(declaration)).toEqual([]);
    expect(messages(`use linalg\n${declaration}`)).toContain('cannot redefine available builtin: solve');
    expect(messages(`${declaration}\nuse linalg`)).toContain('cannot redefine available builtin: solve');
    expect(messages('op = sum')).toEqual([]);
});

it('checks parameters of declarations retained from an earlier analysis', () => {
    const previous = parser.parse<Program>('fun f mean\n return mean\nend\n').value;
    const declarations = new Map(previous.statements.filter(isFunctionStatement).map(fn => [fn.name, fn]));
    const next = parser.parse<Program>('use stats\n').value;
    expect(analyzeValues(next, new Map(), declarations).diagnostics.map(item => item.message))
        .toContain('cannot redefine available builtin: mean');
});

it('uses builtin identity for an aliased axis reduction', () => {
    const program = parser.parse<Program>('A = array shape 2 2\n 1 2\n 3 4\nend\n'
        + 'op = sum\nResult = A op axis 1\n');
    expect(program.parserErrors).toEqual([]);
    const analysis = analyzeValues(program.value);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.bindings.get('Result')).toMatchObject({ types: ['array'], rank: 1, shape: [2] });
});
