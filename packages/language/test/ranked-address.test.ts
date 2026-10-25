import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues, applicationForm, isArrayAssignmentStatement, isAssignmentStatement, type Program } from '../src/index.js';
import { createRankServices } from '../src/rank-module.js';

const services = createRankServices(EmptyFileSystem);
const parser = services.Rank.parser.LangiumParser;
const parse = (source: string) => {
    const parsed = parser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return parsed.value;
};

it.each([
    ['A I J rank 0 0', [0, 0]],
    ['A I # J rank 0 # 0', [0, '#', 0]],
    ['A # # rank # #', ['#', '#']],
    ['A I J K rank -1 2 0', [-1, 2, 0]],
])('classifies positional addressing ranks: %s', (source, ranks) => {
    const statement = parse('Result = ' + source).statements[0];
    if (!isAssignmentStatement(statement)) throw Error('expected assignment');
    expect(applicationForm(statement.value)).toMatchObject({ kind: 'ranked-address', ranks });
});

it('separates ranked write metadata from evaluated selectors', () => {
    const statement = parse('A I # J rank 0 # -1 += Values .accumulate').statements[0];
    if (!isArrayAssignmentStatement(statement)) throw Error('expected addressed assignment');
    expect(statement.indices).toHaveLength(3);
    expect(statement.selectorRanks).toHaveLength(3);
    expect(statement.selectorRanks[1].all).toBe(true);
    expect(statement.selectorRanks[2].sign).toBe('-');
    expect(statement.accumulate).toBe(true);
});

it.each([
    ['I = array 0 1\nJ = array 1 2\nResult = A I J rank 0 0', [2]],
    ['I = array 0 1\nJ = (array 0 1 2 1) reshape 2 2\nResult = A I J rank 0 1', [2, 2]],
    ['J = array 0 1 2\nResult = A # J rank # 0', [3, 2]],
    ['Result = A # # rank # #', [2, 3]],
    ['I = array shape 0 fill 0\nResult = A I # rank 0 #', [0, 3]],
])('infers ranked selection shapes: %s', (source, shape) => {
    const analysis = analyzeValues(parse('use sequences\nA = array shape 2 3 fill 0\n' + source));
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.bindings.get('Result')).toMatchObject({ types: ['array'], rank: shape.length, shape, elements: ['integer'] });
});

it('diagnoses incompatible frames for reads and writes', () => {
    const setup = 'A = array shape 3 3 fill 0\nI = array 0 1\nJ = array 0 1 2\n';
    for (const expression of ['Result = A I J rank 0 0', 'A I J rank 0 0 = 1']) {
        expect(analyzeValues(parse(setup + expression)).diagnostics.map(item => item.message))
            .toContain('shape mismatch: [2] and [3]');
    }
});

it('diagnoses rank arity, placeholders and ranked RHS shapes', () => {
    const setup = 'A = array shape 2 3 fill 0\nI = array 0 1\n';
    for (const expression of ['Result = A I # rank 0 0', 'A I # rank 0 0 = 1', 'A I # rank 0 # = array 1 2']) {
        expect(analyzeValues(parse(setup + expression)).diagnostics.length).toBeGreaterThan(0);
    }
});

it('forwards ranked frame errors to editor validation at the address', () => {
    const program = parse('A = array shape 3 3 fill 0\nI = array 0 1\nJ = array 0 1 2\nResult = A I J rank 0 0');
    const messages: { code: unknown; text: string | undefined }[] = [];
    services.Rank.validation.RankValidator.checkExpressions(program, (_severity, _message, info) => {
        messages.push({ code: info.code, text: info.node?.$cstNode?.text });
    });
    expect(messages).toContainEqual({ code: 'DimensionMismatch', text: 'A I J rank 0 0' });
});
