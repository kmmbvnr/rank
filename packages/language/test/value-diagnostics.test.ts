import { EmptyFileSystem } from 'langium';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { functionTestExamples } from '../src/analysis/test-examples.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

it('does not join an explicit raise with successful function returns', () => {
    const source = 'fun choose Flag\n if Flag\n  return .Missing raise\n else\n  return 1\n end\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const result = analyzeValues(program.value, new Map(), new Map(), [{ name: 'choose',
        arguments: [{ types: ['boolean'], rank: 0, shape: [] }] }]);
    expect(result.functionResults[0]).toMatchObject({ types: ['integer'], rank: 0 });

    const shadowed = services.Rank.parser.LangiumParser.parse<Program>(
        'fun raise Error\n return "ok"\nend\n' + source);
    const shadowedResult = analyzeValues(shadowed.value, new Map(), new Map(), [{ name: 'choose',
        arguments: [{ types: ['boolean'], rank: 0, shape: [] }] }]);
    expect(shadowedResult.diagnostics.map(item => item.message))
        .toContain('cannot redefine available builtin: raise');
});

it('infers covariance results from the declared matrix axis length', () => {
    const moduleName = '010_cov';
    const source = readFileSync(new URL(`../../../demos/deepml/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/deepml/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['covmatrix']));
    expect(examples).toHaveLength(3);
    const analysis = analyzeValues(program.value, new Map(), new Map(), examples);
    expect(analysis.functionResults.map(fact => fact.types)).toEqual(examples.map(() => ['array']));
});

it('infers the numeric value of the built-in maximum-flow record', () => {
    const moduleName = '033_downloadspeed';
    const source = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['download_speed']));
    expect(examples).toHaveLength(4);
    const analysis = analyzeValues(program.value, new Map(), new Map(), examples);
    expect(analysis.functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer', 'real']));
});

it('reports a record field type mismatch before execution', () => {
    expect(messages('R = record\n  .count = 1\nend\nR .count + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('R = record\n  .count = 1\nend\nR = R with\n  .count += 2\nend\nR .count + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('R = record\n  .count = 1\nend\nR .count = "x"'))
        .toEqual(['record field .count has type integer and cannot receive text']);
    expect(messages('R = record\n  .count = 1\nend\nAlias = R\nR .count = 2\nAlias .count + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('rejects changing graph result cell types through a record alias', () => {
    const source = 'Graph = new graph (1 to 3) .directed\nSorted = Graph topological\n';
    expect(messages(source + 'Sorted .order 0 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    const before = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(analyzeValues(before.value).bindings.get('Sorted')?.fields?.order?.elements).toEqual(['integer']);
    const after = services.Rank.parser.LangiumParser.parse<Program>(source
        + 'Alias = Sorted\nAlias .order = array "x"\n');
    expect(analyzeValues(after.value).bindings.get('Sorted')?.fields?.order)
        .toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
    expect(messages(source + 'Alias = Sorted\nAlias .order = array "x"\nSorted .order 0 + "bad"'))
        .toEqual(['record field .order has array cells of type integer and cannot receive text',
            'operator + does not accept integer and text']);
});

it('retains only stable record field types after a field write', () => {
    const source = 'fun update Layer X\n Layer .input = X\n return Layer .weights\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const result = analyzeValues(program.value, new Map(), new Map(), [{ name: 'update', arguments: [
        { types: ['record'], fields: { input: { types: ['array'] }, weights: { types: ['array'] } } },
        { types: ['array'], rank: 1, shape: [2], elements: ['integer'], eagerScalarCells: true },
    ] }]);
    expect(result.functionResults[0].types).toEqual(['array']);
    const rankChange = services.Rank.parser.LangiumParser.parse<Program>(
        'R = record\n .items = array 1 2\nend\nR .items = array shape 2 2 fill 0\n');
    const fields = analyzeValues(rankChange.value);
    expect(fields.diagnostics.map(item => item.message)).toEqual(['record field .items has rank 1 and cannot receive rank 2']);
    expect(fields.bindings.get('R')?.fields?.items)
        .toEqual({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
});

it('infers game routes from integer vertices in a closed graph', () => {
    const moduleName = '017_gameroutes';
    const source = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['game_routes']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers tree diameter from BFS distance entries', () => {
    const moduleName = '003_diameter';
    const source = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['tree_diameter']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers tree matching from DFS vertex and parent entries', () => {
    const moduleName = '002_matching';
    const source = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['tree_matching']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('keeps closed graph vertex types across a proven scalar edge insertion', () => {
    const source = 'G = new graph (1 to 3) .directed\nG add 1 2\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(analyzeValues(program.value).bindings.get('G')?.elements).toEqual(['integer']);
    const unknown = services.Rank.parser.LangiumParser.parse<Program>(
        'G = new graph (1 to 3) .directed\nG add Edges\n');
    expect(analyzeValues(unknown.value).bindings.get('G')?.elements).toBeUndefined();
});

it('infers subordinates after inserting proven integer edges', () => {
    const moduleName = '001_subordinates';
    const source = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['subordinates']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers centroid from rooted tree record fields', () => {
    const moduleName = '014_centroid';
    const source = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['centroid']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers tree distance sums through the leading-axis drop', () => {
    const moduleName = '005_distances2';
    const source = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['distance_sums']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers road-construction results through closed dsu operations', () => {
    const moduleName = '023_roadconstruction';
    const source = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['road_progress']));
    expect(examples).toHaveLength(3);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers path counts through rooted-tree LCA vertices', () => {
    const moduleName = '009_countpaths';
    const source = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/tree/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['path_counts']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers movie-query answers from unweighted functional paths', () => {
    const moduleName = '020_movies';
    const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['movie_queries']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers numeric segment-tree demo results after safe point updates', () => {
    for (const [moduleName, name] of [
        ['003_dynamicsum', 'dynamic_sums'],
        ['004_dynamicmin', 'dynamic_mins'],
        ['008_hotel', 'assign_hotels'],
        ['009_listremovals', 'removals'],
    ]) {
        const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        const examples = functionTestExamples(testProgram.value, moduleName, new Set([name]));
        expect(examples).toHaveLength(2);
        expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
            .toEqual(examples.map(() => ['array']));
    }
});

it('infers the salary-query result through a unary unique-sort pipeline', () => {
    const moduleName = '010_salary';
    const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['salaries']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers distinct-query answers from integer argsort positions', () => {
    const moduleName = '017_distinct';
    const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['distinct']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers maxsum query fields in range-query demos and after numeric point updates', () => {
    for (const [moduleName, name] of [
        ['015_subarraysum', 'max_subarrays'],
        ['016_subarraysum2', 'range_max_sums'],
    ]) {
        const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        const examples = functionTestExamples(testProgram.value, moduleName, new Set([name]));
        expect(examples).toHaveLength(2);
        expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
            .toEqual(examples.map(() => ['array']));
    }
    const source = 'use algo\nTree = (array 1 2) segment maxsum\nAlias = Tree\nAlias 0 = 1.5\n';
    const analysis = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    expect(analysis.bindings.get('Tree')?.elements).toEqual(['integer', 'real']);
    expect(messages(source + 'State = Tree 0 1 query\nState .best + "bad"'))
        .toEqual(['operator + does not accept integer or real and text']);
    expect(messages('use algo\nTree = (array 1 2) segment maxsum\nTree 0 = Unknown\n'
        + 'State = Tree 0 1 query\nState .best + "bad"')).toEqual([]);
});

it('keeps integer bitwise segment reads through integer writes but forgets unproven writes', () => {
    const source = 'use algo\nuse bits\nTree = (array 1 2) segment bxor\nAlias = Tree\nAlias 0 = 3\n';
    expect(messages(source + 'Tree 0 1 query + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nuse bits\nTree = (array 1 2) segment bxor\nTree 0 = Unknown\n'
        + 'Tree 0 1 query + "bad"')).toEqual([]);
    expect(messages('use algo\nuse bits\nTree = (array 1) segment bxor\nTree 0 = 1.5\n'
        + 'Tree 0 + "bad"')).toEqual([]);
});

it('widens numeric segment payloads across aliases and forgets unsafe updates', () => {
    const source = 'use algo\nTree = (array 1 2) segment +\nAlias = Tree\nAlias 0 = 1.5\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    const analysis = analyzeValues(program.value);
    expect(analysis.bindings.get('Tree')?.elements).toEqual(['integer', 'real']);
    expect(analysis.bindings.get('Alias')?.elements).toEqual(['integer', 'real']);
    expect(messages(source + 'Tree 0 1 query + "bad"'))
        .toEqual(['operator + does not accept integer or real and text']);
    expect(messages('use algo\nTree = (array 1 2) segment +\nTree 0 = Unknown\nTree 0 1 query + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 1\nTree = (array 1 2) segment +\n'
        + 'for I in 0 till 2\n Tree I = 3\nend\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nTree = (array 1 2) segment +\n'
        + 'for I in 0 till 2\n Tree I = Unknown\nend\nCount + "bad"'))
        .toEqual([]);
});

it('infers PCA results through numeric axis reductions and eigenvector unpacking', () => {
    const moduleName = '019_pca';
    const source = readFileSync(new URL(`../../../demos/deepml/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/deepml/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['pca']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('forgets positional eigenvector facts after changing the result array', () => {
    const source = 'use linalg\nMatrix = array shape 2 2 fill 1.0\nPair = Matrix eigh\n'
        + 'Pair 1 = array 3 4\nunpack Values Vectors = Pair\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    const analysis = analyzeValues(program.value);
    expect(analysis.bindings.get('Pair')?.positionFacts).toBeUndefined();
    expect(analysis.bindings.get('Vectors')?.rank).toBeUndefined();
});

it('keeps unrelated scalar facts through a proven dsu merge', () => {
    expect(messages('use graph\nCount = 1\nD = new dsu (1 to 2)\nD merge 1 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use graph\nCount = 1\nD = new dsu\nD merge Unknown 2\nCount + "bad"'))
        .toEqual([]);
});

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function messages(source: string): string[] {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value).diagnostics.map(item => item.message);
}

it('selects only reachable branches for exact integer comparisons', () => {
    const source = 'fun choose Values\n N = Values len\n if N equal 0\n  return 1\n'
        + ' elif N less 2\n  return "one"\n else\n  return false\n end\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const args: ValueFacts[] = [
        { types: ['array'], rank: 1, shape: [0] },
        { types: ['array'], rank: 1, shape: [1], elements: ['integer'], eagerScalarCells: true },
        { types: ['array'], rank: 1, shape: [2], elements: ['integer'], eagerScalarCells: true },
        { types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true },
    ];
    expect(args.map(argument => analyzeValues(program.value, new Map(), new Map(), [
        { name: 'choose', arguments: [argument] },
    ]).functionResults[0].types)).toEqual([
        ['integer'], ['text'], ['boolean'], ['integer', 'text', 'boolean'],
    ]);
});

it('selects only reachable branches for an unchanged boolean literal binding', () => {
    const source = 'fun choose Flag\n if Flag\n  return 1\n else\n  return "off"\n end\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect([true, false, undefined].map(boolean => analyzeValues(program.value, new Map(), new Map(), [
        { name: 'choose', arguments: [{ types: ['boolean'], rank: 0, shape: [],
            ...(boolean === undefined ? {} : { boolean }) }] },
    ]).functionResults[0].types)).toEqual([['integer'], ['text'], ['integer', 'text']]);
    expect(messages('Flag = false\nif not Flag\n A = 1\nelse\n A = "off"\nend\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('narrows type guards in reachable branches without changing a parameter contract', () => {
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    const source = parse('fun classify X\n if X is .integer\n  return X\n end\n return "other"\nend');
    const result = (input: ValueFacts) => analyzeValues(source, new Map(), new Map(), [
        { name: 'classify', arguments: [input] },
    ]).functionResults[0].types;
    expect(result({ types: [] })).toEqual(['integer', 'text']);
    expect(result({ types: ['boolean'], rank: 0, shape: [] })).toEqual(['text']);
    expect(result({ types: ['integer'], rank: 0, shape: [] })).toEqual(['integer']);
    const numeric = parse('fun classify X\n if X is .integer or X is .real\n  return X\n end\n return "other"\nend');
    expect(analyzeValues(numeric, new Map(), new Map(), [{ name: 'classify', arguments: [
        { types: [] },
    ] }]).functionResults[0].types).toEqual(['integer', 'real', 'text']);
    const complement = parse('fun classify X\n if X is .integer\n  return X\n else\n  return X + "!"\n end\nend');
    expect(analyzeValues(complement, new Map(), new Map(), [{ name: 'classify', arguments: [
        { types: ['integer', 'text'] },
    ] }]).functionResults[0].types).toEqual(['integer', 'text']);
});

it('lets an infinity-seeded accumulator hold the integers it settles on', () => {
    const body = (tail: string) => `use numbers\nfun smallest Xs\n Best = infinity\n for X in Xs\n  Best = Best X min\n end\n${tail}\nend\n`;
    expect(messages(body(' if Best equal infinity\n  return -1\n end\n return Best'))).toEqual([]);
    expect(messages(body(' Best = 3\n return Best'))).toEqual([]);
    expect(messages('use numbers\nBest = 2.5\nBest = 3')).toEqual(['Best has type real and cannot receive integer']);
});

it('reports an incompatible reassignment before execution', () => {
    expect(messages('Count = 1\nCount = "x"')).toEqual(['Count has type integer and cannot receive text']);
    expect(messages('Count = 1\nCount /= 2')).toEqual(['Count has type integer and cannot receive real']);
    expect(messages('Count = Unknown\nCount = 1\nCount = "x"'))
        .toEqual(['Count has type integer and cannot receive text']);
});

it('reports incompatible scalar operands', () => {
    expect(messages('Count = 1\nCount + "x"')).toEqual(['operator + does not accept integer and text']);
    expect(messages('"a" + "b"')).toEqual([]);
    expect(messages('Unknown + "b"')).toEqual([]);
});

it('checks known shapes using singleton broadcasting', () => {
    expect(messages('A = array shape 2 3 fill 0\nB = array shape 2 4 fill 0\nA + B'))
        .toEqual(['shape mismatch: [2, 3] and [2, 4]']);
    expect(messages('A = array shape 2 3 fill 0\nB = array shape 1 3 fill 0\nA + B')).toEqual([]);
});

it('does not freeze elastic dimensions or require known external values', () => {
    expect(messages('A = array 1 2\nA = array 1 2 3')).toEqual([]);
    expect(messages('A = array shape N 3 fill 0\nB = array shape 4 3 fill 0\nA + B')).toEqual([]);
});

it('keeps the first array rank across assignments and unknown calls', () => {
    for (const replacement of ['array 2 2 2 2 shape 2 2', 'array shape 2 2\n 2 2\n 2 2\nend',
        'array shape N 2 fill 0', 'array shape 0 2 fill 0']) {
        expect(messages(`A = array 1 2 3\nA = ${replacement}`))
            .toEqual(['A has rank 1 and cannot receive rank 2']);
    }
    expect(messages('A = array 1 2\nA = 0 external\nA = array shape 2 2 fill 0'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
    expect(messages('A = array shape 2 2 fill 0\nA = array shape 3 4 fill 0')).toEqual([]);
    expect(messages('A = array 1 2\nA += array shape 2 2 fill 0'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
});

it('checks inline array element counts without executing dimensions', () => {
    expect(messages('M = array 1 2 3 shape 2 2')).toEqual(['array shape 2 2 expects 4 elements, got 3']);
    expect(messages('M = array 1 2 3 4 shape 2 2')).toEqual([]);
    expect(messages('M = array 1 2 shape N 2')).toEqual([]);
});

it('keeps slice result types during program analysis', () => {
    expect(messages('A = (1 to 5) (1 till 3)\nA = "text"'))
        .toEqual(['A has type array and cannot receive text']);
    expect(messages('T = "A😀БC" (1 till 3)\nT = array 1 2'))
        .toEqual(['T has type text and cannot receive array']);
});

it('infers safe unpacked shape cells without losing unrelated types', () => {
    expect(messages('M = array shape 2 3 fill 0\nunpack Rows Cols = M shape\nRows + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nM = array shape 2 3 fill 0\nunpack Rows Cols = M shape\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nA = array Unknown Unknown\nunpack First Second = A\nCount + "bad"'))
        .toEqual([]);
    expect(messages('Count = 1\nfor I in 0 till 1\n unpack First Second = array 2 3\nend\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('First = true\nunpack First Second = array 2 3'))
        .toEqual(['First has type boolean and cannot receive integer']);
    expect(messages('M = array shape N fill 0\nunpack First Second = M\nFirst + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers each type from a fixed mixed array and a parse pattern', () => {
    expect(messages('Values = array 1 "two"\nunpack Number Text = Values\nNumber + "bad"\nText + 1'))
        .toEqual(['operator + does not accept integer and text', 'operator + does not accept text and integer']);
    expect(messages('Values = array "one" "two"\nunpack First Second = Values\nFirst + 1'))
        .toEqual(['operator + does not accept text and integer']);
    expect(messages('fun pair X\n return array X "two"\nend\nValues = 1 pair\n'
        + 'unpack Number Text = Values\nNumber + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use text\nPattern = "/integer:/word"\nValues = "42:abc" Pattern parse\n'
        + 'unpack Number Text = Values\nNumber + "bad"\nText + 1'))
        .toEqual(['operator + does not accept integer and text', 'operator + does not accept text and integer']);
    expect(messages('if Flag\n Values = array 1 "one"\nelse\n Values = array 2 "two"\nend\n'
        + 'unpack Number Text = Values\nNumber + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Values = array 1 "two"\nValues 0 = "three"\n'
        + 'unpack Number Text = Values\nNumber + "bad"')).toEqual([]);
});

it('infers mixed parse positions in the unchanged AoC snow demo', () => {
    const source = readFileSync(new URL('../../../demos/aoc/2015/025_snow.ra', import.meta.url), 'utf8');
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [{
        name: 'solve', arguments: [{ types: ['text'], rank: 1, shape: [null] }],
    }]);
    const capture = [...result.expressions].find(([expression]) =>
        expression.$cstNode?.text === 'Text Pattern parse')?.[1];
    expect(capture?.positions).toEqual([['text'], ['integer'], ['integer']]);
    expect(result.functionResults[0].types).toEqual(['integer']);
});

it('keeps unrelated facts through a scalar minimum helper', () => {
    expect(messages('fun minimum X Y\n return X Y min\nend\nCount = 1\n'
        + 'R = 2 3 minimum\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps unrelated facts through local index writes', () => {
    expect(messages('use algo\nCount = 1\nindex "x" = 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun read X\n Count = 1\n index X = 2\n return Count\nend\nA = 0 read\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun read X\n Count = 1\n for I in 0 till 1\n  index I = 2\n end\n return Count\nend\nA = 0 read\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nA = Unknown\nindex (A 0) = 2\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 1\nA = Unknown\nindex 0 = (A 0) + 1\nCount + "bad"'))
        .toEqual([]);
});

it('keeps unrelated scalar facts through direct named-index writes', () => {
    expect(messages('use algo\nCount = 1\nCache = new index\nCache "a" = 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun read\n Cache = new index\n Count = 1\n'
        + ' for I in 0 to 2\n  Cache I = I\n end\n return Count\nend\nR = read\nR + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nCache = new index\nA = Unknown\nCache (A 0) = 2\nCount + "bad"'))
        .toEqual([]);
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'use algo\nCache = new index\nCache "a" = 2\nR = Cache "a"\n');
    expect(analyzeValues(parsed.value).bindings.get('R')?.types).toEqual(['integer']);
    const alias = services.Rank.parser.LangiumParser.parse<Program>(
        'use algo\nfun read\n index "a" = 1\n Alias = index\n'
        + ' Alias "b" = "x"\n return index "a"\nend\nR = read\n');
    expect(analyzeValues(alias.value).bindings.get('R')?.types).toEqual(['integer', 'text']);
});

it('widens possible named-index values through aliases and forgets unsafe writes', () => {
    const source = 'use algo\nCache = new index\nCache "a" = 2\nAlias = Cache\nAlias "b" = "text"\n';
    const result = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    expect(result.bindings.get('Cache')?.elements).toEqual(['integer', 'text']);
    const read = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(
        source + 'R = Cache "a"\n').value);
    expect(read.bindings.get('R')?.types).toEqual(['integer', 'text']);
    const unsafe = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(
        'use algo\nCache = new index\nCache "a" = 2\nCache Unknown = 3\nR = Cache "a"\n').value);
    expect(unsafe.bindings.get('R')?.types).toEqual([]);
});

it('keeps a closed named-index value type across loop iterations and aliases', () => {
    const source = 'use algo\nfun lookup\n Cache = new index\n Alias = Cache\n'
        + ' for I in 0 till 3\n  Alias I = I\n end\n return Cache 1\nend\nR = lookup\n';
    expect(messages(source + 'R + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun lookup X\n Cache = new index\n'
        + ' for I in 0 till 3\n  Cache I = X\n end\n return Cache 1\nend\n'
        + 'R = Unknown lookup\nR + "bad"')).toEqual([]);
});

it('retains scalar rank for a loop-carried index value', () => {
    const source = 'use algo\nfun lookup\n Cache = new index\n Position = 0\n'
        + ' for I in 0 till 3\n  Cache I = Position\n  Position += 1\n end\n'
        + ' return Cache 1\nend\nR = lookup\n';
    expect(messages(source + 'R + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers a guarded index read before a later loop write', () => {
    const source = 'use algo\nfun lookup\n Cache = new index\n Total = 0\n Position = 0\n'
        + ' for I in 0 till 3\n  if I greater 0\n   Total += Cache 0\n  end\n'
        + '  Cache 0 = Position\n  Position += 1\n end\n return Total\nend\nR = lookup\n';
    expect(messages(source + 'R + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('includes aliased index writes from earlier iterations in a loop read', () => {
    const source = 'use algo\nCache = new index\nCache 0 = 1\nAlias = Cache\n'
        + 'for I in 0 till 2\n Seen = Cache 0\n Alias 0 = "text"\nend\n';
    const analysis = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    const read = [...analysis.expressions].find(([expression]) => expression.$cstNode?.text === 'Cache 0')?.[1];
    expect(read?.types).toEqual(['integer', 'text']);
    const implicit = 'use algo\nfun lookup\n index 0 = 1\n Alias = index\n'
        + ' for I in 0 till 2\n  Seen = Alias 0\n  index 0 = "text"\n end\n return Alias 0\nend\nR = lookup\n';
    const result = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(implicit).value);
    expect(result.bindings.get('R')?.types).toEqual(['integer', 'text']);
});

it('does not reuse an index alias value across a loop that can return early', () => {
    const source = 'use algo\nfun lookup\n Cache = new index\n Cache 0 = 1\n Alias = Cache\n'
        + ' for I in 0 till 2\n  if I greater 0\n   return Cache 0\n  end\n'
        + '  Alias 0 = "text"\n end\n return 0\nend\nR = lookup\n';
    const analysis = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    expect(analysis.bindings.get('R')?.types).toEqual([]);
});

it('infers a fresh local index read from earlier iterations on an early-return path', () => {
    const moduleName = '026_reciprocal';
    const source = readFileSync(new URL(`../../../demos/euler/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/euler/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['cycle_length']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual([['integer'], ['integer']]);
    expect(messages(source.slice(source.indexOf('fun cycle_length'))
        + '\nR = 7 cycle_length\nR + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun lookup X\n Cache = new index\n'
        + ' for I in 0 till 3\n  if I greater 0\n   return Cache 0\n  end\n'
        + '  Cache 0 = X\n end\n return 0\nend\nR = Unknown lookup\nR + "bad"'))
        .toEqual([]);
});

it('keeps unrelated facts through scalar set additions but not lazy array keys', () => {
    expect(messages('use algo\nCount = 1\nset add "x"\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun read X\n Count = 1\n for I in 0 till 1\n  counter add "x"\n end\n return Count\nend\nA = 0 read\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nset add (array Unknown Unknown)\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 1\nA = Unknown\nset add (A 0)\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 1\nCounts = new counter\nKey = "x"\nCounts add Key\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\ncounter add "x"\nX = counter "x"\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nA = Unknown\nX = counter (A 0)\nCount + "bad"'))
        .toEqual([]);
});

it('keeps unrelated facts through direct queue pushes but not computed receivers', () => {
    expect(messages('use algo\nCount = 1\nQ = new queue\nQ push 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun append X\n Count = 1\n Q = new queue\n for I in 0 till 1\n  Q push X\n end\n return Count\nend\nA = 0 append\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nA = Unknown\n(A 0) push 2\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 1\nqueue push 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'use algo\nfun collect X\n Q = new queue\n Q push X\n return Q\nend\nA = 0 collect\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['queue']);
});

it('infers indexed text loops without trusting an unknown iterator', () => {
    const reader = 'fun indexed Text\n Count = 0\n for C I in Text\n  Count += I\n end\n return Count\nend\n';
    expect(messages(reader + 'Result = "abc" indexed\nResult + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nfor C I in Unknown\n Count += I\nend\nCount + "bad"'))
        .toEqual([]);
    expect(messages('Count = 1\nA = Unknown\nfor Value I in (A 0) to 3\n Count += I\nend\n'
        + 'Count + "bad"')).toEqual([]);
    expect(messages('Count = 1\nA = Unknown\nfor Value I in 0 to 3 by (A 0)\n Count += I\nend\n'
        + 'Count + "bad"')).toEqual([]);
    expect(messages('Count = 1\nfor C I in ""\n Count = "bad"\nend\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps types through a scalar lookup in the local index', () => {
    expect(messages('use algo\nfun read X\n Count = 1\n First = index X default -1\n return Count\nend\n'
        + 'Result = "x" read\nResult + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nA = Unknown\nFirst = index (A 0) default -1\nCount + "bad"'))
        .toEqual([]);
});

it('infers value types written to a fresh function-local index', () => {
    expect(messages('use algo\nfun lookup\n index "a" = 1\n return index "a"\nend\nA = lookup\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun lookup\n index "a" = true\n return index "b" default false\nend\nA = lookup\nA + 1'))
        .toEqual(['operator + does not accept boolean and integer']);
    expect(messages('use algo\nfun lookup Key Value\n index "a" = 1\n index Key = Value\n return index "a"\nend\nA = Unknown Unknown lookup\nA + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nfun lookup Key\n index "a" = 1\n index "b" = "text"\n return index Key\nend\nA = "a" lookup\nA = true'))
        .toEqual(['A has type integer or text and cannot receive boolean']);
    expect(messages('use algo\nfun lookup\n for I in 0 to 1\n  index I = I\n end\n return index 0\nend\nA = lookup\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun lookup\n index 0 = 1\n for I in 0 to 1\n  index I = "text"\n end\n return index 0\nend\nA = lookup\nA + "bad"'))
        .toEqual([]);
});

it('keeps the type of a local index when a cell is copied with a default', () => {
    expect(messages('use algo\nfun copy\n index 0 = true\n index 1 = index 0 default false\n return index 1 default false\nend\nA = copy\nA + 1'))
        .toEqual(['operator + does not accept boolean and integer']);
});

it('keeps local index facts across a key computed from scalar arithmetic', () => {
    expect(messages('use algo\nfun grid Text\n index 0 0 = true\n for Symbol I in Text\n  index (I + 1) 0 = true\n end\n return index 1 0 default false\nend\nA = "ab" grid\nA + 1'))
        .toEqual(['operator + does not accept boolean and integer']);
    expect(messages('use algo\nfun grid\n index 0 0 = true\n index (1 + 1) 0 = true\n return index 1 0 default false\nend\nA = grid\nA + 1'))
        .toEqual(['operator + does not accept boolean and integer']);
});

it('forgets local index facts when a computed key is not plain scalar arithmetic', () => {
    expect(messages('use algo\nfun grid Key\n index 0 0 = true\n index (Key + 1) 0 = true\n return index 1 0 default false\nend\nA = Unknown grid\nA + 1'))
        .toEqual([]);
    expect(messages('use algo\nfun grid Key\n index 0 0 = true\n index (Key first) 0 = true\n return index 1 0 default false\nend\nA = (array 1 2) grid\nA + 1'))
        .toEqual([]);
});

it('reads a scalar array cell as the first operand of a trailing dyadic operation', () => {
    expect(messages('Steps = array 9 8 7\nA = Steps 1 5 min\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Steps = array 9 8 7\nA = Steps 1 5 max\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    // A partial read of a matrix selects a row, and an unproved selector leaves the result unknown.
    expect(messages('M = array shape 2 2\n 1 2\n 3 4\nend\nA = M 1 5 min\nA + "bad"')).toEqual([]);
    expect(messages('Steps = array 9 8 7\nA = Steps Unknown 5 min\nA + "bad"')).toEqual([]);
});

it('reverses a queue into an array', () => {
    const reversed = (setup: string, read = '') => messages(`use algo\nuse sequences\nfun back Item\n Q = new queue\n${setup}\n return Q reverse${read}\nend\nA = 1 back\nA = 1`);
    expect(reversed(' Q push Item\n Q push 2'))
        .toEqual(['A has type array and cannot receive integer']);
    // The reversed array keeps the queue's item types only when they are proved.
    const first = (setup: string) => messages(`use algo\nuse sequences\nfun back Item\n Q = new queue\n${setup}\n R = Q reverse\n return R first\nend\nA = 1 back\nA = "text"`);
    expect(first(' Q push Item\n Q push 2')).toEqual(['A has type integer and cannot receive text']);
    expect(first(' Q push (new queue)')).toEqual([]);
});

it('keeps outer loop facts when only a nested loop continues', () => {
    const nested = (exit: string) => `fun count Width\n Current = array shape 4 fill 0\n for Column in 1 to Width\n  Next = array shape 4 fill 0\n${exit}\n  Current = Next\n end\n return Current 0\nend\nA = 3 count\nA + "bad"`;
    expect(messages(nested('  for Mask in 0 till 4\n   Ways = Current Mask\n   if Ways equal 0\n    continue\n   end\n   Next 0 += Ways\n  end')))
        .toEqual(['operator + does not accept integer and text']);
    // The loop's own continue still takes the conservative exit analysis.
    expect(messages(nested('  if Column equal 2\n   continue\n  end\n  Next 0 += 1'))).toEqual([]);
});

it('infers the simplified regular-expression matcher from its local index writes', () => {
    const source = readFileSync(new URL('./fixtures/010_regexp.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/010_regexp_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '010_regexp', new Set(['match']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['boolean']));
});

it('gives function locals their own rank contract', () => {
    expect(messages('A = array 1 2\nfun make N\n A = array 1 2 3 4 shape 2 2\n return A\nend\nM = 0 make')).toEqual([]);
    expect(messages('fun change A\n A = array 1 2 3 4 shape 2 2\n return A\nend\n(array 1 2) change'))
        .toEqual(['change: A has rank 1 and cannot receive rank 2']);
    expect(messages('A = array 1 2\nuse sequences\nA = array 1 2 3 4 shape 2 2'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
});

it('does not reuse dimensions across a conditional reassignment', () => {
    expect(messages('A = array 1 2\nif Flag\n A = array 1 2 3\nend\nB = array 1 2 3\nA + B')).toEqual([]);
});

it('joins new bindings from nested branches and preserves their common rank', () => {
    const body = 'if Flag\n if Other\n  M = array shape 2 3 fill 0\n else\n  M = array shape 4 3 fill 0\n end\nelse\n M = array shape 5 3 fill 0\nend\n';
    expect(messages(body + 'M # # #')).toEqual(['3 selectors exceed array rank 2']);
    expect(messages(body + 'M = array shape 7 8 fill 0')).toEqual([]);
    expect(messages(body + 'M = array 1 2')).toEqual(['M has rank 2 and cannot receive rank 1']);
    expect(messages('fun choose Flag Other\n' + body + 'return M\nend\nA = X Y choose\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('if Flag\n M = array shape 2 3 fill 0\nend\nM # # #')).toEqual([]);
});

it('respects ordered elif reachability and unreachable side effects', () => {
    expect(messages('if false\n A = "bad"\nelif true\n A = 1\nelse\n A = "bad"\nend\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun choose X\n if false\n  return "bad"\n elif true\n  return 1\n else\n  return "bad"\n end\nend\nA = Flag choose\nA = "bad"'))
        .toEqual(['A has type integer and cannot receive text']);
    expect(messages('A = array 1 2\nif true\n A = array 1 2 3\nelif change\n A = array 1\nend\nA + (array 1 2)'))
        .toEqual(['shape mismatch: [3] and [2]']);
});

it('checks loop binding contracts without freezing iteration dimensions', () => {
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A = array shape 2 2 fill 0\nend'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
    expect(messages('Count = 1\nfor I in 1 to 3\n Count = "bad"\nend'))
        .toEqual(['Count has type integer and cannot receive text']);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A + (array 1 2 3)\n A = array 1 2 3\nend\nA + (array 1 2)'))
        .toEqual([]);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n for J in 1 to 2\n A = array shape 2 2 fill 0\n end\nend'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
});

it('does not diagnose empty or unproven loops or statements after a loop exit', () => {
    for (const header of ['I in 1 till 1', 'I in Items', 'false']) {
        expect(messages(`A = 1\nfor ${header}\n A = "bad"\nend`)).toEqual([]);
    }
    expect(messages('A = array 1 2\nfor I in 1 till 1\n A = array 1 2 3\nend\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages('A = 1\nfor I in 1 to 3\n break\n A = "bad"\nend')).toEqual([]);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n continue\n A = array shape 2 2 fill 0\nend')).toEqual([]);
});

it('keeps loop contracts in functions and after loops while discarding mutation facts', () => {
    expect(messages('fun make X\n A = array shape 2 3 fill 0\n for I in 1 to 3\n A = array shape 4 3 fill 0\n end\n return A\nend\nM = 0 make\nM # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('A = array 1 2\nfor I in Items\n A = array 1 2 3\nend\nA = array shape 2 2 fill 0'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A 0 = "text"\n A + (array 1 2)\nend')).toEqual([]);
    expect(messages('fun choose X\n for I in 1 to 3\n  return 1\n end\n return "text"\nend\nA = 0 choose\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
});

it('checks reductions against the actual runtime rule, allowing full rank', () => {
    expect(messages('A = array shape 2 3 fill 0\nA reduce + rank 3'))
        .toEqual(['rank 3 exceeds value rank 2']);
    expect(messages('A = array shape 2 3 fill 0\nA reduce + rank 2')).toEqual([]);
});

it('checks axis bounds and selector counts', () => {
    expect(messages('A = array shape 2 3 fill 0\nA sum axis 2'))
        .toEqual(['axis 2 is invalid for rank 2']);
    expect(messages('A = array shape 2 3 fill 0\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('A = array shape 2 3 fill 0\nA # 0')).toEqual([]);
});

it('does not reuse shapes after a call that may change a captured binding', () => {
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\nend\nchange\nB = array 1 2 3\nA + B')).toEqual([]);
});

it('checks nested expressions and respects text rank', () => {
    expect(messages('array (1 + "x")')).toEqual(['operator + does not accept integer and text']);
    expect(messages('"a" + "long"')).toEqual([]);
    expect(messages('"abc" reduce + rank 1')).toEqual([]);
});

it('infers a helper result from its body and literal call arguments', () => {
    expect(messages('fun addone X\n return X + 1\nend\nA = 3 addone\nA = "x"'))
        .toEqual(['A has type integer and cannot receive text']);
    expect(messages('fun matrix X\n return array shape 2 3 fill X\nend\nA = 0 matrix\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('fun addone X\n return X + 1\nend\nInput = 3\nA = Input addone\nA = "x"'))
        .toEqual(['A has type integer and cannot receive text']);
});

it('checks variable arguments and results through local calculations and helper calls', () => {
    const helpers = 'fun increment X\n Y = X + 1\n return Y\nend\nfun twice X\n Y = X increment\n return Y increment\nend\n';
    expect(messages(helpers + 'Input = "bad"\nInput twice'))
        .toContain('twice: increment: operator + does not accept text and integer');
    expect(messages(helpers + 'Input = 3\nResult = Input twice\nResult = "bad"'))
        .toEqual(['Result has type integer and cannot receive text']);
    expect(messages(helpers + 'Input = Unknown\nInput twice')).toEqual([]);
});

it('checks array argument shapes and preserves the rank of computed results', () => {
    const helper = 'fun combine A B\n Result = A + B\n return Result\nend\n';
    expect(messages(helper + 'A = array shape 2 3 fill 0\nB = array shape 2 4 fill 0\nA B combine'))
        .toEqual(['combine: shape mismatch: [2, 3] and [2, 4]']);
    expect(messages(helper + 'A = array shape 2 3 fill 0\nB = array shape 1 3 fill 0\nC = A B combine\nC # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
});

it('does not preserve caller facts through unknown calls, mutations or recursive helpers', () => {
    for (const body of ['X external\n return X + 1', 'X 0 = 1\n return X + 1', 'return X helper',
        'X delete\n return X + 1', 'X += 1\n return X + 1', 'Y = stdin .integer\n return X + 1']) {
        expect(messages(`fun helper X\n ${body}\nend\nInput = "bad"\nInput helper`)).toEqual([]);
    }
});

it('does not guess results for recursion and joins all covered return paths', () => {
    expect(messages('fun again X\n return X again\nend\nA = 1 again\nA = "x"')).toEqual([]);
    expect(messages('fun choose X\n if X\n  return 1\n end\n return "x"\nend\nA = Flag choose\nA = true'))
        .toEqual(['choose returns incompatible ranks: 0 and 1',
            'choose returns incompatible types: integer and text',
            'A has type integer or text and cannot receive boolean']);
    expect(messages('fun choose X\n if X\n  return 1\n end\nend\nA = Flag choose\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
});

it('checks recursive numeric specializations including empty median inputs', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/004_medarrs.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/004_medarrs_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '004_medarrs', new Set(['median']));
    expect(examples).toHaveLength(8);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['real']));
    expect(messages('fun gcd A B\n if B equal 0\n  return A\n end\n'
        + ' return B (A % B) gcd\nend\nR = 12 8 gcd\nR + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun change X\n if X less 1\n  return X\n end\n'
        + ' return (X / 2) change\nend\nR = 2 change\nR + "bad"'))
        .toEqual(['change returns incompatible types: real and integer',
            'operator + does not accept real and text']);
    expect(messages('fun swap A B\n if A less 1\n  return A\n end\n'
        + ' return B A swap\nend\nR = 2 1.0 swap\nR + "bad"'))
        .toEqual(['swap returns incompatible types: integer and real']);
    expect(messages('Hidden = 1\nfun captured X\n if X less 1\n  return Hidden\n end\n'
        + ' return (X - 1) captured\nend\nR = 2 captured\nR + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps cell facts through reads guarded by numeric conditions on an unchanged array', () => {
    const cells = (length: number | null, type = 'integer'): ValueFacts => ({ types: ['array'], rank: 1,
        shape: [length], elements: [type], eagerScalarCells: true });
    const index: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    const result = (source: string, ...args: ValueFacts[]) => {
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        expect(program.parserErrors).toEqual([]);
        return analyzeValues(program.value, new Map(), new Map(), [{ name: 'pick', arguments: args }])
            .functionResults[0];
    };
    const guarded = 'fun pick A I\n M = A len\n X = 0\n if I at least 0\n  if I less M\n   X = A I\n  end\n end\n'
        + ' return X\nend\n';
    for (const length of [null, 3]) {
        expect(result(guarded, cells(length), index)).toMatchObject({ types: ['integer'], rank: 0 });
        expect(result(guarded, cells(length, 'real'), index).types.slice().sort()).toEqual(['integer', 'real']);
    }
    // No index is in bounds for an empty array, so the read never contributes its cell type.
    expect(result(guarded, cells(0, 'real'), index)).toMatchObject({ types: ['integer'], rank: 0 });
    // The guard proves nothing outside its branch: a read after it is not claimed to be in bounds.
    const unguarded = 'fun pick A I\n if I less 0\n  return 0\n end\n return A I\nend\n';
    expect(result(unguarded, cells(null, 'real'), index).types.slice().sort()).toEqual(['integer', 'real']);
    // A write may change the array, so no cell fact survives it.
    const rewritten = 'fun pick A I\n A I = "x"\n return A I\nend\n';
    expect(result(rewritten, cells(null), index).types).not.toEqual(['integer']);
});

it('prunes branches that proven integer bounds make unreachable, and nothing else', () => {
    const index: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    const cells = (length: number | null): ValueFacts => ({ types: ['array'], rank: 1, shape: [length],
        elements: ['integer'], eagerScalarCells: true });
    const run = (source: string, ...args: ValueFacts[]) => {
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        expect(program.parserErrors).toEqual([]);
        const result = analyzeValues(program.value, new Map(), new Map(), [{ name: 'pick', arguments: args }]);
        return { types: result.functionResults[0].types.slice().sort(), messages: result.diagnostics.map(item => item.message) };
    };
    const guarded = 'fun pick A I\n M = A len\n if I at least 0\n  if I less M\n   return A I\n  end\n end\n return 0.5\nend\n';
    // An empty array leaves no index that is both non-negative and below its length, so this call
    // cannot return a cell. The contract check over widened inputs still reports the mixed returns.
    expect(run(guarded, cells(0), index).types).toEqual(['real']);
    // Otherwise the read may run, so both results stay possible.
    expect(run(guarded, cells(3), index).types).toEqual(['integer', 'real']);
    expect(run(guarded, cells(null), index).types).toEqual(['integer', 'real']);
    // Conjunctions, negations and the else path narrow too.
    expect(run('fun pick A I\n M = A len\n if I at least 0 and I less M\n  return A I\n end\n return 0.5\nend\n',
        cells(0), index).types).toEqual(['real']);
    expect(run('fun pick A I\n if I less 0\n  return 0.5\n end\n if I less 0\n  return "x"\n end\n return 1\nend\n',
        cells(null), index).types).toEqual(['integer', 'real']);
    expect(run('fun pick A I\n if not (I at least 0)\n  return 0.5\n else\n  if I less 0\n   return "x"\n  end\n end\n return 1\nend\n',
        cells(null), index).types).toEqual(['integer', 'real']);
    // A reassignment or update invalidates the bounds.
    expect(run('fun pick A I\n if I at least 0\n  I = I - 5\n  if I less 0\n   return 0.5\n  end\n end\n return 1\nend\n',
        cells(null), index).types).toEqual(['integer', 'real']);
    expect(run('fun pick A I\n if I at least 0\n  I -= 5\n  if I less 0\n   return 0.5\n  end\n end\n return 1\nend\n',
        cells(null), index).types).toEqual(['integer', 'real']);
    // `-I` is at most -1 here; inheriting I's bounds would wrongly prove `J less 1` false.
    expect(run('fun pick A I\n if I at least 1\n  J = -I\n  if J less 1\n   return 0.5\n  end\n end\n return 1\nend\n',
        cells(null), index).types).toEqual(['integer', 'real']);
    // A loop can change the name between the guard and the inner test.
    expect(run('fun pick A I\n if I at least 0\n  for I less 3\n   I = I - 10\n   if I less 0\n    return 0.5\n   end\n  end\n end\n return 1\nend\n',
        cells(null), index).types).toEqual(['integer', 'real']);
    // Bounds do not outlive the branch that proved them.
    expect(run('fun pick A I\n if I at least 0\n  X = 1\n end\n if I less 0\n  return 0.5\n end\n return 1\nend\n',
        cells(null), index).types).toEqual(['integer', 'real']);
});

it('infers every median example including the empty-array cases', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/004_medarrs.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/004_medarrs_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '004_medarrs', new Set(['median']));
    const results = analyzeValues(program.value, new Map(), new Map(), examples).functionResults;
    expect(results.map(fact => [fact.types, fact.rank])).toEqual(examples.map(() => [['real'], 0]));
});

it('closes a numeric recursive result through assignments and arithmetic', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/001_josephus.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/001_josephus_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '001_josephus', new Set(['removed']));
    expect(examples).toHaveLength(9);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(Array.from({ length: 9 }, () => ['integer']));
    expect(messages('fun change X\n if X less 1\n  return 1\n end\n'
        + ' Next = (X / 2) change\n return Next + 1\nend\nR = 2 change\nR + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun widenresult X\n if X less 1\n  return 1\n end\n'
        + ' Next = (X - 1) widenresult\n return Next / 2\nend\nR = 2 widenresult\nR + "bad"'))
        .toEqual(['widenresult returns incompatible types: integer and real']);
});

it('keeps a fresh numeric array through a nested read-only helper in a loop', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/012_rectcut.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/012_rectcut_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '012_rectcut', new Set(['rectangle_cuts']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(Array.from({ length: 4 }, () => ['integer']));
});

it('keeps a fresh numeric array through a proved nested scalar writer', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/020_elevator.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/020_elevator_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '020_elevator', new Set(['elevator_rides']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(Array.from({ length: 4 }, () => ['integer']));
});

it('uses a settled binding type for a direct return after an unknown branch', () => {
    const source = 'fun choose Flag Next\n Result = 1\n if Flag\n  Result = Next\n end\n return Result\nend\n';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [{
        name: 'choose', arguments: [{ types: ['boolean'], rank: 0, shape: [] }, { types: [] }],
    }]);
    expect(result.functionResults[0].types).toEqual(['integer']);
    expect(result.diagnostics).toEqual([]);
});

it('infers the result of the unchanged CSES maximum-subarray loop', () => {
    const source = readFileSync(new URL('./fixtures/008_maxsubarray.ra', import.meta.url), 'utf8');
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source.slice(source.indexOf('fun max_subarray')));
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [{
        name: 'max_subarray', arguments: [{ types: ['array'], rank: 1, shape: [3], elements: ['integer'],
            eagerScalarCells: true }],
    }]);
    expect(result.functionResults[0].types).toEqual(['integer']);
    expect(result.diagnostics).toEqual([]);
    expect(messages(`${source.slice(source.indexOf('fun max_subarray'))}\nA = array 1 2 3\n`
        + 'Result = A max_subarray\nResult + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers scalar results from the unchanged AoC cookie clamp and unpack', () => {
    const source = readFileSync(new URL('../../../demos/aoc/2015/015_cookie.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/aoc/2015/015_cookie_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '015_cookie')
        .filter(example => example.name === 'cookiescore');
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults)
        .toEqual(examples.map(() => ({ types: ['integer', 'real'], rank: 0, shape: [] })));
});

it('infers booleans from the unchanged AoC indexed-window demo', () => {
    const source = readFileSync(new URL('../../../demos/aoc/2015/005_nice.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/aoc/2015/005_nice_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '005_nice')
        .filter(example => example.name === 'nice2');
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults)
        .toEqual(examples.map(() => ({ types: ['boolean'], rank: 0, shape: [] })));
});

it('infers an accumulator across the unchanged CSES dice array-write loop', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/001_dice.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/001_dice_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '001_dice');
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults)
        .toEqual(examples.map(() => ({ types: ['integer'], rank: 0, shape: [] })));
});

it('proves scalar array cell types through closed plain and compound writes in nested loops', () => {
    const source = 'fun fill_array N\n A = array shape (N + 1) fill 0\n for I in 1 to N\n'
        + '  A I = A (I - 1) + 1\n end\n return A N\nend\n'
        + 'fun nested\n A = array 0 0\n for I in 0 to 1\n  for J in 0 to 1\n'
        + '   A J += 1\n  end\n end\n return A 0\nend\n';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [
        { name: 'fill_array', arguments: [{ types: ['integer'], rank: 0, shape: [] }] },
        { name: 'nested', arguments: [] },
    ]);
    expect(result.functionResults.map(fact => fact.types)).toEqual([['integer'], ['integer']]);
    expect(result.diagnostics).toEqual([]);
    const mixed = source.replace('A I = A (I - 1) + 1', 'A I = "text"');
    const changed = services.Rank.parser.LangiumParser.parse<Program>(mixed);
    expect(analyzeValues(changed.value, new Map(), new Map(), [
        { name: 'fill_array', arguments: [{ types: ['integer'], rank: 0, shape: [] }] },
    ]).functionResults[0].types).toEqual([]);
});

it('proves full-cell writes across every axis without assuming slice writes are scalar', () => {
    const source = 'fun grid\n A = array shape 2 2 fill 0\n for I in 0 to 1\n'
        + '  for J in 0 to 1\n   A I J += 1\n  end\n end\n return A 0 0\nend\n';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value, new Map(), new Map(), [{ name: 'grid', arguments: [] }])
        .functionResults[0].types).toEqual(['integer']);
    const mixed = services.Rank.parser.LangiumParser.parse<Program>(source.replace('A I J += 1', 'A I J = "text"'));
    expect(analyzeValues(mixed.value, new Map(), new Map(), [{ name: 'grid', arguments: [] }])
        .functionResults[0].types).toEqual([]);
});

it('infers the unchanged AtCoder grid-path table', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/edpc/08_grid1.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/atcoder/edpc/08_grid1_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '08_grid1', new Set(['path_count']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged CSES book-shop dynamic program from its test inputs', () => {
    const source = readFileSync(new URL('./fixtures/007_bookshop.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/007_bookshop_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '007_bookshop', new Set(['book_shop']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers indexed values from the unchanged CSES next-prime sequence', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/010_nextprime.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/010_nextprime_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '010_nextprime', new Set(['next_prime']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('widens array element facts before analyzing repeated writes', () => {
    expect(messages('Count = 1\nA = array 1 2\nfor I in 0 to 1\n A 0 = "x"\nend\n'
        + 'A 0 + 1\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nA = array 1 2\nfor I in 0 to 1\n A Key = 0\nend\n'
        + 'Count + "bad"')).toEqual([]);
});

it('infers returns from loops in unchanged reverse-integer and bill-count demos', () => {
    for (const [path, moduleName, type, rank] of [
        ['leetcode/007_revint', '007_revint', 'integer', 0],
        ['atcoder/beginners/010_otoshidama', '010_otoshidama', 'array', 1],
    ] as const) {
        const source = readFileSync(new URL(`../../../demos/${path}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/${path}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        expect(program.parserErrors).toEqual([]);
        expect(testProgram.parserErrors).toEqual([]);
        const examples = functionTestExamples(testProgram.value, moduleName);
        const results = analyzeValues(program.value, new Map(), new Map(), examples).functionResults;
        expect(results.length).toBeGreaterThan(0);
        expect(results.every(result => result.types.join() === type && result.rank === rank)).toBe(true);
    }
});

it('does not infer scalar results for array-valued demo test examples', () => {
    const conflicts: string[] = [];
    const paths = [
        'demos/cody/43007_pd.ra',
        'demos/cses/range/025_missingcoins.ra',
        'demos/deepml/014_linreg.ra',
        'demos/deepml/015_gd.ra',
        'demos/deepml/022_sigmoid.ra',
        'demos/deepml/027_basis.ra',
        'demos/deepml/042_relu.ra',
        'demos/deepml/045_kernel.ra',
    ];
    for (const path of paths) {
        const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../${path.replace(/\.ra$/, '_test.ra')}`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source).value;
        const suite = services.Rank.parser.LangiumParser.parse<Program>(tests).value;
        const name = path.split('/').at(-1)!.replace(/\.ra$/, '');
        const examples = functionTestExamples(suite, name);
        const results = analyzeValues(program, new Map(), new Map(), examples).functionResults;
        for (const [index, example] of examples.entries()) {
            const result = results[index];
            if (!example.expected.types.length || !result.types.length) continue;
            if (!result.types.some(type => example.expected.types.includes(type))) {
                conflicts.push(`${path}:${example.line} ${example.name}: ${result.types} versus ${example.expected.types}`);
            }
            if (result.rank !== undefined && example.expected.rank !== undefined) {
                if (result.rank !== example.expected.rank) {
                    conflicts.push(`${path}:${example.line} ${example.name}: rank ${result.rank} versus ${example.expected.rank}`);
                }
            }
        }
    }
    expect(conflicts).toEqual([]);
});

it('retains unrelated facts after the unchanged maximum-subarray reader on eager input', () => {
    const source = readFileSync(new URL('./fixtures/008_maxsubarray.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun max_subarray'));
    expect(messages(`${definition}\nA = array 1 2 3\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nA = array shape 3 fill 1\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nA = array shape 3 fill Unknown\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual([]);
    expect(messages(`${definition}\nA = array shape 3 fill 1\nA 0 = Unknown\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual([]);
    const boundIndex = definition.replace(/\bi\b/g, 'I');
    expect(messages(`${boundIndex}\nI = 0\nA = array 1 2 3\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
});

it('retains unrelated facts after the unchanged AtCoder vacation loop', () => {
    const source = readFileSync(new URL('./fixtures/03_vacation.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun best_score'));
    expect(messages(`${definition}\nA = array 1 2 3\nB = array 3 2 1\nC = array 2 3 1\n`
        + 'Count = 3\nA B C best_score\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('retains unrelated facts after the unchanged bracket-count demo on integer input', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/017_brackets1.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun bracket_count'));
    expect(messages(`${definition}\nCount = 3\n6 bracket_count\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 3\nUnknown bracket_count\nCount + "bad"`))
        .toEqual([]);
});

it('retains unrelated facts after the unchanged palindrome loop on integer input', () => {
    const source = readFileSync(new URL('./fixtures/009_palnum.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun palindrome'));
    expect(messages(`${definition}\nCount = 3\n121 palindrome\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    const uncertain = definition.replace('Back = Back * 10 + Digit', 'Unknown external');
    expect(messages(`${uncertain}\nCount = 3\n121 palindrome\nCount + "bad"`)).toEqual([]);
});

it('retains unrelated facts after the unchanged reverse-integer loop with an early return', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/007_revint.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun reverse'));
    expect(messages(`${definition}\nCount = 3\n123 reverse\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nResult = 123 reverse\nResult + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    const uncertain = definition.replace('Result = Result * 10 + Digit', 'Unknown external');
    expect(messages(`${uncertain}\nCount = 3\n123 reverse\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts across the unchanged modular-power demo for proven integer inputs', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/002_exponentiation.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun power'));
    expect(messages(`${definition}\nCount = 1\n3 4 power\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nUnknown 4 power\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts across the unchanged sigmoid demo only for scalar input', () => {
    const source = readFileSync(new URL('../../../demos/deepml/022_sigmoid.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun sigmoid'));
    expect(messages(`${definition}\nCount = 1\n0.5 sigmoid\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\n(array 0 1) sigmoid\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts across the unchanged recall demo only for callback-free cells', () => {
    const source = readFileSync(new URL('../../../demos/deepml/052_recall.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun recall'));
    expect(messages(`${definition}\nCount = 1\n(array 1 0) (array 1 1) recall\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill 1\nA (array 1 1) recall\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill Unknown\nA (array 1 1) recall\nCount + "bad"`))
        .toEqual([]);
});

it('drops a derived mask read proof after an indexed replacement', () => {
    const reader = 'fun count_mask Mask\n return Mask count\nend';
    const before = `${reader}\nMask = (array 1 0) equal 1\nCount = 1`;
    expect(messages(`${before}\nMask count_mask\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${before}\nMask 0 = "text"\nMask count_mask\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts after the unchanged CSES sum-and-max reader', () => {
    const source = readFileSync(new URL('../../../demos/cses/sortnsrch/025_books.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun minimum_reading_time'));
    expect(messages(`${definition}\nCount = 1\n(array 2 3) minimum_reading_time\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill 1\nA minimum_reading_time\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill Unknown\nA minimum_reading_time\nCount + "bad"`))
        .toEqual([]);
});

it('retains caller facts across the unchanged softmax pipeline only for safe cells', () => {
    const source = readFileSync(new URL('../../../demos/deepml/023_softmax.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun softmax'));
    expect(messages(`${definition}\nCount = 1\n(array 1 2 3) softmax\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 3 fill 1\nA softmax\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 3 fill Unknown\nA softmax\nCount + "bad"`))
        .toEqual([]);
});

it('retains a caller fact after the unchanged normal-equation pipeline on eager arrays', () => {
    const source = readFileSync(new URL('../../../demos/deepml/014_linreg.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun linear_regression'));
    const matrix = 'X = array shape 3 2\n 1 1\n 1 2\n 1 3\nend';
    const vector = 'Y = array 1 2 3';
    expect(messages(`${definition}\nCount = 1\n${matrix}\n${vector}\nX Y linear_regression\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\n${matrix}\n${vector}\nResult = X Y linear_regression\nResult # #`))
        .toEqual(['2 selectors exceed array rank 1']);
    expect(messages(`${definition}\nCount = 1\nX = array shape 3 2 fill 1\n${vector}\nX Y linear_regression\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nX = array shape 3 2 fill Unknown\n${vector}\nX Y linear_regression\nCount + "bad"`))
        .toEqual([]);
});

it('retains a caller fact after the unchanged gradient-descent loop on numeric arrays', () => {
    const source = readFileSync(new URL('../../../demos/deepml/015_gd.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun linear_regression'));
    const matrix = 'X = array shape 3 2\n 1 1\n 1 2\n 1 3\nend';
    const vector = 'Y = array 1 2 3';
    expect(messages(`${definition}\nCount = 1\n${matrix}\n${vector}\nX Y 0.01 2 linear_regression\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nX = array shape 3 2 fill Unknown\n${vector}\nX Y 0.01 2 linear_regression\nCount + "bad"`))
        .toEqual([]);
});

it('skips an unreachable K-means loop body for a proven zero-step call', () => {
    const source = readFileSync(new URL('../../../demos/deepml/017_kmeans.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun k_means'));
    const points = 'Points = array shape 2 1\n 0\n 10\nend';
    const centroids = 'Centroids = array shape 2 1\n 0\n 10\nend';
    const draft = (steps: number) => `${definition}\nCount = 1\n${points}\n${centroids}`
        + `\nPoints 2 Centroids ${steps} k_means\nCount + "bad"`;
    expect(messages(draft(0))).toEqual(['operator + does not accept integer and text']);
    expect(messages(draft(1))).toEqual([]);
});

it('keeps known empty arrays but not arbitrary empty sequences', () => {
    const source = 'Count = 1\nfor Cell in Items\n Unknown external\nend\nCount + "bad"\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    for (const type of ['array', 'sequence'] as const) {
        const items = { types: [type], rank: 1, shape: [0], elements: ['integer'] };
        expect(analyzeValues(program.value, new Map([['Items', items]])).diagnostics.map(item => item.message))
            .toEqual(type === 'array' ? ['operator + does not accept integer and text'] : []);
    }
    expect(messages(source.replace('Items', '0 till 0')))
        .toEqual(['operator + does not accept integer and text']);
});

it('checks the result rank of the unchanged bill-count loop before execution', () => {
    const source = readFileSync(new URL('./fixtures/010_otoshidama.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun otoshidama'));
    expect(messages(`${definition}\nResult = 9 45000 otoshidama\nResult # #`))
        .toEqual(['2 selectors exceed array rank 1']);
});

it('collects returns from reachable loop paths with break and continue', () => {
    for (const exit of ['break', 'continue']) {
        expect(messages(`fun choose N\n for I in 0 till N\n  if I equal 0\n   ${exit}\n  end\n  return 1\n end\n return "text"\nend\nA = 2 choose\nA = true`))
            .toEqual(['choose returns incompatible ranks: 0 and 1',
            'choose returns incompatible types: integer and text',
            'A has type integer or text and cannot receive boolean']);
        expect(messages(`fun choose\n for I in 1 to 2\n  ${exit}\n  return 1\n end\n return "text"\nend\nA = choose\nA = true`))
            .toEqual(['A has type text and cannot receive boolean']);
    }
    expect(messages('fun choose\n for I in 1 to 2\n  for J in 1 to 2\n   break\n  end\n  return 1\n end\n return "text"\nend\nA = choose\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
    expect(messages('fun choose\n for I in 0 till 0\n  return "text"\n end\n return 1\nend\nA = choose\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
});

it('keeps settled types after loop exits without trusting writes or unknown effects', () => {
    expect(messages('A = 1\nfor I in 1 to 3\n if I equal 2\n  break\n end\nend\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('A = 1\nfor I in 1 to 3\n A external\n break\nend\nA + "bad"'))
        .toEqual([]);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A = array 1 2 3\n break\nend\nA + (array 1 2 3)'))
        .toEqual([]);
});

it('skips a proven empty array loop without needing element facts', () => {
    expect(messages('Count = 1\nA = array shape 0\nend\nfor Value in A\n Unknown external\nend\n'
        + 'Count + "bad"')).toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nA = Unknown\nfor Value in A\n Unknown external\nend\n'
        + 'Count + "bad"')).toEqual([]);
    const moduleName = '013_playlist';
    const source = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['longest_distinct']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged atoi function through both break and return paths', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/008_atoi.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/008_atoi_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '008_atoi', new Set(['atoi', 'clamp']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('retains unrelated facts after the unchanged marble-count text loop', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/beginners/003_marbles.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun marbles'));
    expect(messages(`${definition}\nCount = 3\n"101" marbles\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    const uncertain = definition.replace('Count += 1', 'Unknown external');
    expect(messages(`${uncertain}\nCount = 3\n"101" marbles\nCount + "bad"`)).toEqual([]);
});

it('still discards facts after an unknown call inside a loop', () => {
    expect(messages('A = array 1 2\nfor I in 0 till 1\n A external\nend\nA 0 + "bad"'))
        .toEqual([]);
});

it('does not snapshot a direct-call argument that executes another function', () => {
    expect(messages('fun touch\n Unknown external\n return 0\nend\n'
        + 'fun inspect X Y\n return Y 0\nend\n'
        + 'A = array 1 2\nResult = touch A inspect\nResult + "bad"')).toEqual([]);
});

it('preserves unrelated scalar facts across known parameter and captured writes', () => {
    for (const target of ['X', 'Shared']) {
        expect(messages(`fun change X\n ${target} 0 = 1\n return 0\nend\nShared = array 1 2\nCount = 3\nShared change\nCount + "bad"`))
            .toEqual(['operator + does not accept integer and text']);
    }
    expect(messages('fun write X\n X 0 = 1\n return 0\nend\nfun helper X\n X write\n return 0\nend\nA = array 1 2\nCount = 3\nA helper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('retains caller facts after a helper writes only its caller’s private array', () => {
    const code = 'fun write V\n V 0 = 9\n return 0\nend\n'
        + 'fun outer\n Temp = array 1 2\n Temp write\n return 0\nend\n';
    expect(messages(code + 'Count = 3\nouter\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(code.replace('Temp = array 1 2', 'Temp = Source')
        + 'Count = 3\nouter\nCount + "bad"')).toEqual([]);
});

it('maps a direct nested reader or writer to the enclosing argument', () => {
    const reader = 'fun outer X\n fun read\n  return X 0\n end\n return read\nend\n';
    expect(messages(reader + 'A = array 1 2\nCount = 3\nA outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    const writer = 'fun outer X\n fun change\n  X 0 = "x"\n  return 0\n end\n change\n return 0\nend\n';
    expect(messages(writer + 'A = array 1 2\nCount = 3\nA outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(writer + 'A = array 1 2\nA outer\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun outer X\n X = Source\n fun read\n  return X 0\n end\n return read\nend\n'
        + 'A = array 1 2\nCount = 3\nA outer\nCount + "bad"')).toEqual([]);
});

it('keeps unrelated facts across proven eager-cell reader helpers', () => {
    const readers = 'fun read X\n return X 0\nend\nfun helper A\n return A read\nend\n';
    expect(messages(readers + 'A = array 1 2\nCount = 3\nA helper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun read\n return Shared 0\nend\nShared = array 1 2\nCount = 3\nread\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(readers + 'A = array 1 2\nA 0 = 3\nCount = 3\nA helper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('reads top-level captures rather than equally named caller parameters', () => {
    const reader = 'Shared = array 1 2\nCount = 3\nfun read\n return Shared 0\nend\n'
        + 'fun outer Shared\n return read\nend\n';
    expect(messages(reader + '(array 3 4) outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(reader.replace('Shared = array 1 2', 'Shared = Unknown')
        + '(array 3 4) outer\nCount + "bad"')).toEqual([]);

    expect(messages('Offset = 1\nfun read Ignored\n return Offset\nend\n'
        + 'fun outer Offset\n return 1 read\nend\nResult = "x" outer\nResult + "y"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Shared = array 1 2\nfun read Ignored\n return Shared 0\nend\n'
        + 'fun outer Ignored\n Shared 0 = "x"\n return 0 read\nend\nResult = 0 outer\nResult + 1'))
        .toEqual([]);
});

it('invalidates a global capture rather than an equally named caller parameter', () => {
    const prefix = 'Shared = array 1 2\nOther = array 3 4\nCount = 3\n'
        + 'fun write Value\n Shared 0 = Value\n return 0\nend\n'
        + 'fun outer Shared\n 9 write\n return Shared 0\nend\n';
    expect(messages(prefix + 'Other outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(prefix + 'Other outer\nShared + "bad"')).toEqual([]);
    expect(messages(prefix + 'Other outer\nOther + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps unrelated facts across a reader of its own eager literal array', () => {
    const reader = 'fun read X\n return X 0\nend\nfun helper\n Temp = array 1 2\n return Temp read\nend\n';
    expect(messages(reader + 'Count = 3\nhelper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun helper\n Temp = Source\n return Temp 0\nend\nCount = 3\nhelper\nCount + "bad"'))
        .toEqual([]);
});

it('keeps unrelated shapes across a private literal array write', () => {
    const build = 'fun build\n Temp = array 1 2\n Temp 0 = 9\n return Temp\nend\n';
    expect(messages(build + 'A = array 1 2\nbuild\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
    const read = build.replace('return Temp', 'return Temp 0');
    expect(messages(read + 'A = array 1 2\nbuild\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
});

it('keeps unrelated facts across a nested reader of its parent eager array', () => {
    const body = 'fun outer N\n Temp = array 1 2\n fun read\n  return Temp 0\n end\n return read\nend\n';
    expect(messages(body + 'Count = 3\n0 outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(body.replace('fun read', 'Temp = Source\n fun read')
        + 'Count = 3\n0 outer\nCount + "bad"')).toEqual([]);
    const second = body.replace('Temp = array 1 2', 'Other = array 3 4\n Temp = array 1 2');
    expect(messages(second + 'Count = 3\n0 outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('does not trust indexed readers of lazy or unsupported array values', () => {
    const reader = 'fun read X\n return X 0\nend\n';
    expect(messages(reader + 'A = Unknown\nCount = 3\nA read\nCount + "bad"')).toEqual([]);
    expect(messages(reader + 'A = array 1 2\nA # = Unknown\nCount = 3\nA read\nCount + "bad"')).toEqual([]);
    expect(messages(reader + 'A = array 1 2\nA 0 = Unknown\nCount = 3\nA read\nCount + "bad"')).toEqual([]);
});

it('does not retain facts across direct or transitive stdin reads', () => {
    const prefix = 'fun input\n return stdin .integer\nend\nCount = 3\n';
    expect(messages(prefix + 'input\nCount + "bad"')).toEqual([]);
    expect(messages('fun helper\n return input\nend\n' + prefix + 'helper\nCount + "bad"')).toEqual([]);
});

it('invalidates facts across file I/O but not across stdin or an unrelated native pop', () => {
    // Standard input is a host token source with a declared type: reading it runs no Rank code.
    expect(messages('use io\nCount = 3\nstdin .integer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use io\nCount = 3\n"path" read\nCount + "bad"')).toEqual([]);
    expect(messages('fun file Path\n return Path read\nend\nCount = 3\n"path" file\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 3\nQ = new queue\nQ pop\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('follows copy-on-write when a function writes a parameter array', () => {
    const code = 'fun change X\n X 0 = 9\n return X\nend\nA = array 1 2\nB = A\nC = array 3 4 5\n';
    expect(messages(code + 'Result = B change\nA + C')).toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'Result = B change\nB + C')).toEqual(['shape mismatch: [2] and [3]']);
    expect(messages('A = array 1 2\nB = A\nB 0 = 9\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
});

it('invalidates the written binding while retaining independent array facts', () => {
    const code = 'A = array 1 2\nB = A\nC = array 3 4 5\n';
    expect(messages(code + 'A 0 = "x"\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'fun change\n A 0 = "x"\n return 0\nend\nchange\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'fun change\n A 0 = "x"\n return 0\nend\nchange\nA + (array 1 2)'))
        .toEqual([]);
});

it('uses proven integer selectors through assignments and branch joins', () => {
    const code = 'I = 0\nA = array 1 2\nB = A\nC = array 3 4 5\n';
    expect(messages(code + 'A I = 9\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'if Flag\n A I = 9\nend\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'A I = "x"\nA + (array 3 4)')).toEqual([]);
    expect(messages('Key = .n\nA = array true false\nB = A\nA Key = 1\nB + 1'))
        .toEqual([]);
});

it('retains known cell types after a proven single-cell replacement', () => {
    const code = 'A = array 1 2\nB = A\nA 0 = 3\n';
    expect(messages(code + 'A + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages(code + 'B + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nif Flag\n A 0 = 3\nend\nA + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nA 0 = true\nA + (array 3 4)')).toEqual([]);
    expect(messages('A = array 1 2\nA # = 3\nA + (array true false)')).toEqual([]);
    expect(messages('A = array 1 2\nA 0 += 3\nA + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nA 0 %= 3\nA + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nA 0 += "text"\nA + (array true false)')).toEqual([]);
});

it('keeps array values separate across rebinding and joined write paths', () => {
    expect(messages('A = array 1 2\nB = A\nA = array 3 4 5\nB + A'))
        .toEqual(['shape mismatch: [2] and [3]']);
    const prefix = 'A = array 1 2\nC = array 3 4 5\nif Flag\n B = A\nelse\n B = C\nend\nB 0 = 9\n';
    expect(messages(prefix + 'A + C')).toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(prefix + 'B + A')).toEqual([]);
    expect(messages('A = array 1 2\nB = A * 2\nA 0 = 9\nB + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
});

it('distinguishes local assignment from a possible nested capture', () => {
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\n return 0\nend\nchange\nA + (array 1 2)'))
        .toEqual([]);
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\n return 0\nend\nchange\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages('fun outer\n A = array 1 2\n fun change\n  A = array 1 2 3\n  return 0\n end\n change\n return A\nend\nR = outer\nR + (array 1 2)'))
        .toEqual([]);
});

it('retains unrelated shapes across a proven nested parameter rebinding', () => {
    const body = 'fun outer X\n Y = array 1 2\n fun replace\n  X = array 3 4 5\n  return 0\n end\n replace\n return Y + (array 1 2 3)\nend\nA = array 1 2\nA outer';
    expect(messages(body)).toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(body.replace('return Y + (array 1 2 3)', 'return X + (array 1 2)'))).toEqual([]);
});

it('invalidates a captured local binding without losing independent shapes', () => {
    const body = 'fun outer X\n Y = array 1 2\n Z = array 3 4\n fun replace\n  Y = array 5 6 7\n  return 0\n end\n replace\n return Z + (array 1 2 3)\nend\n0 outer';
    expect(messages(body)).toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(body.replace('return Z + (array 1 2 3)', 'return Y + (array 1 2)'))).toEqual([]);
    const second = body.replace('Y = array 5 6 7', 'Z = array 5 6 7');
    expect(messages(second.replace('return Z + (array 1 2 3)', 'return Y + (array 1 2 3)')))
        .toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(second.replace('return Z + (array 1 2 3)', 'return Z + (array 1 2)'))).toEqual([]);
});

it('keeps independent facts through a grandchild replacement of an outer local', () => {
    const source = 'fun outer\n Z = array 1 2\n Y = array 3 4\n fun middle\n  fun replace\n   Z = array 5 6 7\n   return 0\n  end\n  replace\n  return 0\n end\n middle\n return Y + (array 1 2 3)\nend\nouter';
    expect(messages(source)).toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(source.replace('return Y + (array 1 2 3)', 'return Z + (array 1 2)'))).toEqual([]);
});

it('drops caller facts when a nested helper name is redefined', () => {
    const source = 'fun outer A\n fun reader X\n  X 0 = 9\n  return 0\n end\n A reader\n fun reader X\n  return X 0\n end\n return 0\nend\nA = array 1 2\nCount = 3\nA outer\nCount + "bad"';
    expect(messages(source)).toEqual([]);
});

it('falls back for unknown effects and reference-like writes', () => {
    const prefix = 'fun change X\n X 0 = 1\n return 0\nend\nA = array true false\nAlias = A\nCount = 3\n';
    expect(messages(prefix + 'A change\nAlias + 1')).toEqual(['operator + does not accept boolean and integer']);
    expect(messages(prefix + 'A external\nCount + "bad"')).toEqual([]);
    expect(messages(prefix + 'Unknown change\nCount + "bad"')).toEqual([]);
    expect(messages('fun change X\n Alias = X\n Alias 0 = 1\n return 0\nend\nA = array 1 2\nCount = 3\nA change\nCount + "bad"')).toEqual([]);
    expect(messages('A = array true false\nB = A\nA 0 += 1\nB + 1')).toEqual([]);
});

it('joins function result dimensions without freezing elastic lengths', () => {
    expect(messages('fun choose X\n if X\n  return array shape 2 3 fill 0\n else\n  return array shape 4 3 fill 0\n end\nend\nA = Flag choose\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
});

it('infers result facts only from paths that return', () => {
    expect(messages('fun choose Flag\n if Flag\n  return array 1 2\n end\nend\nA = true choose\nA # #'))
        .toEqual(['2 selectors exceed array rank 1']);
    expect(messages('fun choose Flag\n if Flag\n  return 1\n end\nend\nA = true choose\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun fail\n Value = 1\nend\nA = fail\nA + "bad"')).toEqual([]);
});

it('keeps a text parameter when an implicit queue selects its characters', () => {
    const source = 'fun reorder Text\n for I in 0 till 2\n  queue push I\n end\n return Text queue\nend\nA = "abc" reorder';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['text']);
    expect(messages('fun character Text I\n return Text I\nend\nA = "abc" 1 character\nA + 1'))
        .toEqual(['operator + does not accept text and integer']);
});

it('binds each matrix row as an array when iterating its first axis', () => {
    const source = 'fun first_cell Matrix\n for Row in Matrix\n  return Row 0\n end\nend\n'
        + 'A = (array 1 2 3 4 shape 2 2) first_cell';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['integer']);
    const rows = services.Rank.parser.LangiumParser.parse<Program>(source.replace('return Row 0', 'return Row') + '\n');
    expect(analyzeValues(rows.value).bindings.get('A')).toMatchObject({ types: ['array'], rank: 1 });
    expect(messages(source.replace('return Row 0', 'return Row 0 0')))
        .toEqual(['first_cell: 2 selectors exceed array rank 1']);
    const empty = 'fun empty\n Matrix = array shape 0 2 fill 0\n for Row in Matrix\n  return 1\n end\n return "x"\nend\nA = empty';
    expect(analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(empty + '\n').value)
        .bindings.get('A')?.types).toEqual(['text']);
});

it('preserves scalar cells through a proven integer spread index', () => {
    const source = 'fun write Position\n A = array shape 2 2 fill 0\n for I in 0 till 2\n'
        + '  A unpack Position += 1\n end\n return A 0 1\nend\nResult = (array 0 1) write';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('Result')?.types).toEqual(['integer']);
    expect(analyzeValues(parse(source.replace('array 0 1', 'array 0'))).bindings.get('Result')?.types).toEqual([]);
    expect(analyzeValues(parse(source.replace('array 0 1', 'array 0.5 1'))).bindings.get('Result')?.types).toEqual([]);
});

it('keeps numeric matrix cells only when loop rebindings are closed', () => {
    const source = 'fun combine Base\n Result = array shape 2 2 fill 1\n'
        + ' for I in 0 till 3\n  Result = Result Base matmul\n end\n return Result 0 0\nend\n'
        + 'A = (array 1 2 3 4 shape 2 2) combine';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('A')?.types).toEqual(['integer']);
    const broken = source.replace('Result = Result Base matmul\n end',
        'Result = Result Base matmul\n  if I equal 1\n   Result = "bad"\n  end\n end');
    expect(analyzeValues(parse(broken)).bindings.get('A')?.types).toEqual([]);
    expect(messages('A = array shape 2 2 fill 1\nfor I in 0 till 2\n'
        + ' A = array shape 2 3 fill 1\nend\nA + (array shape 2 4 fill 1)')).toEqual([]);
});

it('joins integer and real cells across proven matrix writes in a loop', () => {
    const source = 'fun build_matrix Size\n M = array shape Size Size fill infinity\n'
        + ' for I in 0 till Size\n  M I I = 0\n end\n return M 0 0\nend\nA = 2 build_matrix';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['real', 'integer']);
    expect(messages('A = array shape 2 2 fill 0\nfor I in 0 till 2\n A I I = 1\nend\nA 0 0 + "x"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps the unchanged LCS element type before widening numeric loop cells', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/011_lcs.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/011_lcs_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '011_lcs', new Set(['longest_common']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('does not close a numeric loop through an effectful helper', () => {
    const source = 'fun impure X\n Unknown external\n return X\nend\n'
        + 'fun compute\n A = array 1 2\n for I in 0 till 2\n  A = A impure\n end\n return A 0\nend\nResult = compute';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(analyzeValues(parsed.value).bindings.get('Result')?.types).toEqual([]);
});

it('infers the unchanged CSES min-plus graph-path result through safe helpers', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/024_graphpaths2.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/024_graphpaths2_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '024_graphpaths2', new Set(['min_path']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer', 'real']));
});

it('infers the unchanged counting-Sundays result through boolean helper updates', () => {
    const source = readFileSync(new URL('../../../demos/euler/019_sundays.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/euler/019_sundays_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '019_sundays', new Set(['count_sundays']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged lattice-paths result through integer reductions', () => {
    const source = readFileSync(new URL('../../../demos/euler/015_latticepaths.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/euler/015_latticepaths_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '015_latticepaths', new Set(['lattice_paths']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged removing-digits result through ranked digit conversion', () => {
    const source = readFileSync(new URL('./fixtures/005_removedigits.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/005_removedigits_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '005_removedigits', new Set(['removing_digits']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged creating-strings result through counter reads', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/012_creatingstrings2.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/012_creatingstrings2_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '012_creatingstrings2', new Set(['string_count']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers unchanged probability demos through numeric text formatting', () => {
    for (const [module, name] of [
        ['028_diceprobability', 'probability_text'], ['029_movingrobots', 'empty_text'],
        ['030_candylottery', 'candy_text'], ['031_inversionprob', 'inversion_text'],
    ]) {
        const source = readFileSync(new URL(`../../../demos/cses/math/${module}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/cses/math/${module}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        const examples = functionTestExamples(testProgram.value, module, new Set([name]));
        expect(examples.length).toBeGreaterThan(0);
        expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
            .toEqual(examples.map(() => ['text']));
    }
});

it('infers the unchanged necklace result through integer divisor sequences', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/019_countingnecklaces.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/019_countingnecklaces_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '019_countingnecklaces', new Set(['necklaces']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged palindrome result through implicit counter reads', () => {
    const source = readFileSync(new URL('../../../demos/cses/intro/012_palindrome.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/intro/012_palindrome_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '012_palindrome', new Set(['palindrome']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['text']));
});

it('infers the unchanged removal-game result through a dense array copy', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/015_removal.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/015_removal_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '015_removal', new Set(['removal_game']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged card-game result through sorted scalar cells', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/beginners/007_cardgame.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/atcoder/beginners/007_cardgame_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '007_cardgame', new Set(['card_game']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged mex-grid result through a named outer operation', () => {
    const source = readFileSync(new URL('../../../demos/cses/intro/019_mexgrid.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/intro/019_mexgrid_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '019_mexgrid', new Set(['grid']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults)
        .toEqual(examples.map(example => ({ types: ['array'], rank: 2,
            shape: [Number(example.arguments[0].integer), Number(example.arguments[0].integer)],
            elements: ['integer'], callbackFreeScalarCells: true })));
});

it('infers the unchanged local-extrema result through native coordinate pairs', () => {
    const moduleName = '54730_lx';
    const source = readFileSync(new URL(`../../../demos/cody/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cody/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['local_extrema']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers the unchanged weather interpolation through direct return calls', () => {
    const moduleName = '00071_wx';
    const source = readFileSync(new URL(`../../../demos/cody/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cody/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['interpolate_weather']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers the unchanged longest-palindrome result through numeric call arguments', () => {
    const moduleName = '005_longestpal';
    const source = readFileSync(new URL(`../../../demos/leetcode/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/leetcode/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['longest']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['text']));
});

it('passes a preceding pipeline result to a unary user function', () => {
    const source = 'use text\nfun count_parts Parts\n return Parts len\nend\n'
        + 'fun count_source Source\n return Source "," split count_parts\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'count_source', arguments: [{
        types: ['text'], rank: 1, shape: [3], textLiteral: 'a,b',
    }] }]).functionResults[0].types).toEqual(['integer']);
});

it('passes a captured array to a return call before the callee changes its facts', () => {
    const source = 'fun outer A\n fun change B\n  A 0 = 9\n  return B 0\n end\n return A change\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'outer', arguments: [{
        types: ['array'], rank: 1, shape: [2], elements: ['integer'], eagerScalarCells: true,
    }] }]).functionResults[0].types).toEqual(['integer']);
});

it('passes a safe indexed scalar to a call before the callee changes its array', () => {
    const source = 'fun outer A\n fun change X\n  A 0 = 9\n  return X\n end\n'
        + ' return (A 0) change\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'outer', arguments: [{
        types: ['array'], rank: 1, shape: [2], elements: ['integer'], eagerScalarCells: true,
    }] }]).functionResults[0].types).toEqual(['integer']);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'outer', arguments: [{
        types: ['array'], rank: 1, shape: [2], elements: ['integer'],
    }] }]).functionResults[0].types).toEqual([]);
    const apples = readFileSync(new URL('../../../demos/cses/intro/016_apples.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/intro/016_apples_test.ra', import.meta.url), 'utf8');
    const appleProgram = services.Rank.parser.LangiumParser.parse<Program>(apples);
    const appleTests = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(appleTests.value, '016_apples', new Set(['solve']));
    expect(examples).toHaveLength(3);
    expect(analyzeValues(appleProgram.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual([['integer'], ['integer'], ['integer']]);
});

it('keeps the exact numeric scalar type through abs', () => {
    expect(messages('A = 3 abs\nA = 1.5'))
        .toEqual(['A has type integer and cannot receive real']);
    expect(messages('A = 1.5 abs\nA = 2'))
        .toEqual(['A has type real and cannot receive integer']);
});

it('keeps the exact numeric cell type through unary min and max', () => {
    expect(messages('A = (array 1 2 3) max\nA = 1.5'))
        .toEqual(['A has type integer and cannot receive real']);
    expect(messages('A = (array 1.5 2.5) min\nA = 1'))
        .toEqual(['A has type real and cannot receive integer']);
});

it('retains a private scalar parameter type but not its value across an unknown call', () => {
    const source = 'fun outer N\n Unknown external\n return N + 1\nend\nA = 3 outer';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('A')?.types).toEqual(['integer']);
    const withCapture = source.replace(' Unknown external', ' fun nested\n  N = 4\n  return 0\n end\n Unknown external');
    expect(analyzeValues(parse(withCapture)).bindings.get('A')?.types).toEqual([]);
});

it('keeps a local type when nested functions only read its binding', () => {
    const source = 'fun outer N\n fun read\n  return N\n end\n Unknown external\n return N + 1\nend\nA = 3 outer';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('A')?.types).toEqual(['integer']);
    const withRebinding = source.replace('  return N', '  N = "x"\n  return N');
    expect(analyzeValues(parse(withRebinding)).bindings.get('A')?.types).toEqual([]);
});

it('analyzes hoisted local functions declared after return without leaking their binding', () => {
    const source = 'fun helper X\n return "text"\nend\n'
        + 'fun outer X\n return X helper\n fun helper Y\n  return Y + 1\n end\nend\n'
        + 'A = 1 outer\nB = 1 helper\nA + "bad"\nB + 1';
    expect(messages(source)).toEqual([
        'operator + does not accept integer and text',
        'operator + does not accept text and integer',
    ]);
});

it('retains the rank of a private array but not its cells after an unknown call', () => {
    const source = 'fun f\n A = array 1 2\n Unknown external\n return A (0 to 1)\nend\nR = f';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('R')).toMatchObject({ types: ['array'], rank: 1 });
    const withCapture = source.replace(' Unknown external',
        ' fun change\n  A = "x"\n  return 0\n end\n Unknown external');
    expect(analyzeValues(parse(withCapture)).bindings.get('R')?.types).toEqual([]);
    expect(analyzeValues(parse('A = array 1 2\nUnknown external\nR = A (0 to 1)'))
        .bindings.get('R')?.types).toEqual([]);
});

it('retains the outer type of a private collection but not its contents after an unknown call', () => {
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    for (const kind of ['queue', 'stack', 'deque', 'heap', 'set', 'counter', 'index', 'segment']) {
        const source = `fun f Value\n C = Value\n Unknown external\n return C\nend\nR = f`;
        const result = analyzeValues(parse(source), new Map(), new Map(), [{ name: 'f', arguments: [{ types: [kind] }] }]);
        expect(result.functionResults[0]).toMatchObject({ types: [kind] });
        expect(result.functionResults[0].elements).toBeUndefined();
    }
    const withCapture = 'fun f Value\n C = Value\n fun change\n  C = 1\n  return 0\n end\n Unknown external\n return C\nend';
    expect(analyzeValues(parse(withCapture), new Map(), new Map(), [
        { name: 'f', arguments: [{ types: ['queue'] }] },
    ]).functionResults[0].types).toEqual([]);
    expect(analyzeValues(parse('C = new queue\nUnknown external\nR = C')).bindings.get('R')?.types).toEqual([]);
});

it('keeps numeric cells through a callback-free integer-sequence compound write', () => {
    expect(messages('A = array shape 5 fill 0\nA (1 to 4 by 2) += 1\nA 1 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('A = array shape 5 fill 0\nA (1 to 4 by 2) /= 2\nA 1 + "bad"'))
        .toEqual(['operator + does not accept integer or real and text']);
    expect(messages('A = array shape 5 fill 0\nA Unknown += 1\nA 1 + "bad"'))
        .toEqual([]);
    expect(messages('A = array shape 5 fill 0\nfor I in 1 to 2\n'
        + ' if I equal 1\n  continue\n end\n A (1 to 4 by 2) += 1\nend\nA 1 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('A = array shape 5 fill 0\nfor I in 1 to 2\n'
        + ' if I equal 1\n  A 0 = "x"\n  continue\n end\n A (1 to 4 by 2) += 1\nend\nA 1 + "bad"'))
        .toEqual([]);
});

it('infers the unchanged right-triangle perimeter through numeric slice updates', () => {
    const moduleName = '039_righttriangles';
    const source = readFileSync(new URL(`../../../demos/euler/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/euler/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['right_triangle_perimeter']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged Hamiltonian-flight count through loop exits and array writes', () => {
    const moduleName = '031_hamiltonian';
    const source = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['hamiltonian_flights']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged longest-prime-sum result through a numeric prefix scan', () => {
    const moduleName = '050_primesum';
    const source = readFileSync(new URL(`../../../demos/euler/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/euler/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['longest_prime_sum']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged maximum-bounded-sum result through a numeric prefix scan', () => {
    const moduleName = '035_maxsum2';
    const source = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['maximum_bounded_sum']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('keeps numeric matrix cells through a safe vector-index replacement', () => {
    expect(messages('A = array shape 3 4 fill 0\nI = 1 to 2\nA 0 I = array 5 6\nA 0 1 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('A = array shape 3 4 fill 0\nI = 1 to 2\nA 0 I = array "x" "y"\nA 0 1 + "bad"'))
        .toEqual([]);
    expect(messages('A = array shape 3 4 fill 0\nA 0 Unknown = array 5 6\nA 0 1 + "bad"'))
        .toEqual([]);
    expect(messages('A = array shape 3 4 fill 0\nA 0 # = array 1 2 3 4\nA 0 1 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('A = array shape 3 4 fill 0\nI = 1 to 2\nA 0 I += array 5 6\nA 0 1 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('A = array shape 3 4 fill 0\nA 0 # = array "a" "b" "c" "d"\nA 0 1 + "bad"'))
        .toEqual([]);
    expect(messages('A = array shape 3 4 fill 1.0\nA # 1 *= -1\nA 0 1 + "bad"'))
        .toEqual(['operator + does not accept real and text']);
    expect(messages('A = array shape 3 4 fill 1.0\nA # # *= -1\nA 0 1 + "bad"'))
        .toEqual([]);
});

it('infers the unchanged forest-query answers through numeric matrix rows', () => {
    const moduleName = '007_forest';
    const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['forest_queries']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('infers the unchanged self-power remainder despite an unknown lazy mapper', () => {
    const moduleName = '048_selfpowers';
    const source = readFileSync(new URL(`../../../demos/euler/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/euler/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['self_power_tail']));
    expect(examples).toHaveLength(1);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults[0].types)
        .toEqual(['integer', 'real']);
});

it('infers unchanged nested-helper demos without assuming their collection contents', () => {
    for (const [directory, moduleName, functionName] of [
        ['graph', '001_countrooms', 'count_rooms'],
        ['sortnsrch', '018_josephus', 'josephus'],
    ]) {
        const source = readFileSync(new URL(`../../../demos/cses/${directory}/${moduleName}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/cses/${directory}/${moduleName}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        const examples = functionTestExamples(testProgram.value, moduleName, new Set([functionName]));
        expect(examples).toHaveLength(4);
        expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
            .toEqual(examples.map(() => [moduleName === '001_countrooms' ? 'integer' : 'queue']));
    }
});

it('infers the unchanged nearest-smaller array despite mutable stack reads', () => {
    const moduleName = '028_smaller';
    const source = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['nearest_smaller']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('does not discard unrelated facts when popping a known native container', () => {
    for (const [kind, operation] of [['queue', 'pop'], ['stack', 'pop'], ['deque', 'popfront'],
        ['deque', 'popback'], ['heap', 'pop']]) {
        expect(messages(`use algo\nA = array 1 2\nQ = new ${kind}\nQ push 1\nQ ${operation}\nA 0 + "bad"`))
            .toEqual(['operator + does not accept integer and text']);
    }
    expect(messages('use algo\nA = array 1 2\nUnknown pop\nA 0 + "bad"')).toEqual([]);
    expect(messages('use algo\nA = array 1 2\nQ = new stack\n'
        + 'fun pop X\n A 0 = "changed"\n return 0\nend\nQ pop\nA 0 + "bad"')).toEqual(['cannot redefine available builtin: pop']);
});

it('infers elements inserted into named collections and rejects a definite mismatch', () => {
    for (const kind of ['queue', 'stack', 'deque', 'heap']) {
        const operation = kind === 'deque' ? 'popfront' : 'pop';
        expect(messages(`use algo\nQ = new ${kind}\nQ push 1\nX = Q ${operation}\nX + "bad"`))
            .toEqual(['operator + does not accept integer and text']);
        expect(messages(`use algo\nQ = new ${kind}\nQ push 1\nQ push "bad"`))
            .toEqual([`Q holds integer and cannot receive text`]);
    }
    for (const kind of ['set', 'counter']) {
        expect(messages(`use algo\nS = new ${kind}\nS add 1\nS add "bad"`))
            .toEqual([`S holds integer and cannot receive text`]);
        expect(messages(`use algo\nS = new ${kind}\nS add array 1 2\nS add array 1 2 3 4 shape 2 2`))
            .toEqual(['S holds array rank 1 and cannot receive rank 2']);
    }
    expect(messages('use algo\nQ = new queue\nQ push array 1 2\nQ push array 1 2 3 4 shape 2 2'))
        .toEqual(['Q holds array rank 1 and cannot receive rank 2']);
    for (const kind of ['queue', 'set']) {
        const insert = kind === 'queue' ? 'push' : 'add';
        const source = `use algo\nfun first_item\n Q = new ${kind}\n Q ${insert} array 1 2 3 4 shape 2 2\n`
            + ' for Item in Q\n  return Item\n end\n return array shape 2 2 fill 0\nend\nA = first_item\n';
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        expect(program.parserErrors).toEqual([]);
        expect(analyzeValues(program.value).bindings.get('A')).toMatchObject({ types: ['array'], rank: 2 });
    }
    expect(messages('use algo\nQ = new queue\nQ push 1\nAlias = Q\nX = Alias pop\nX + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nQ = new queue\nAlias = Q\nAlias push 1\nX = Q pop\nX + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nQ = new queue\nQ push 1\nQ = new queue\nQ push "text"\nX = Q pop\nX + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nuse io\nQ = new queue\nQ push 1\nInput = stdin .integer\nX = Q pop\nX + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers minimal grid path results through a typed set iteration', () => {
    const moduleName = '013_minpath';
    const source = readFileSync(new URL(`../../../demos/cses/dynamic/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/dynamic/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['minimal_grid_path']));
    expect(examples).toHaveLength(4);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['text']));
});

it('infers table projection ranks from literal JSON test inputs', () => {
    for (const [moduleName, name] of [['001_titanic', 'predictall'], ['004_digitsreq', 'solve_table'],
        ['005_distweets', 'solve_table']]) {
        const source = readFileSync(new URL(`../../../demos/kaggle/${moduleName}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/kaggle/${moduleName}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        const examples = functionTestExamples(testProgram.value, moduleName, new Set([name]));
        const results = analyzeValues(program.value, new Map(), new Map(), examples).functionResults;
        expect(results.some(fact => fact.types.join() === 'array' && fact.rank === 2)).toBe(true);
    }
});

it('uses only loaded and unchanged imported function bindings', () => {
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    const module = parse('fun twice X\n return X + X\nend');
    const source = 'use "helper" as M\nfun solve X\n return X M.twice\nend';
    const example = [{ name: 'solve', arguments: [{ types: ['integer'], rank: 0, shape: [] }] }];
    const load = (path: string) => path === 'helper' ? module : undefined;
    expect(analyzeValues(parse(source), new Map(), new Map(), example, load).functionResults[0].types)
        .toEqual(['integer']);
    expect(analyzeValues(parse(source), new Map(), new Map(), example).functionResults[0].types)
        .toEqual([]);
    const changed = source.replace(' return X M.twice', ' M.twice = X\n return X M.twice');
    expect(analyzeValues(parse(changed), new Map(), new Map(), example, load).functionResults[0].types)
        .toEqual([]);
});

it('checks imported effects before preserving caller globals', () => {
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    const program = parse('A = array 1\nuse "helper" as M\nM.read\nR = A 0');
    const quiet = parse('fun read\n return 0\nend');
    const noisy = parse('fun read\n Value = stdin .integer\n return 0\nend');
    expect(analyzeValues(program, new Map(), new Map(), [], path => path === 'helper' ? quiet : undefined)
        .bindings.get('R')?.types).toEqual(['integer']);
    expect(analyzeValues(program, new Map(), new Map(), [], path => path === 'helper' ? noisy : undefined)
        .bindings.get('R')?.types).toEqual([]);
});

it('infers the disaster-tweets imported prediction result from its module', () => {
    const moduleName = '005_distweets';
    const source = readFileSync(new URL(`../../../demos/kaggle/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/kaggle/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const module = readFileSync(new URL('../../../demos/kaggle/001_titanic.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source).value;
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests).value;
    const importedProgram = services.Rank.parser.LangiumParser.parse<Program>(module).value;
    const examples = functionTestExamples(testProgram, moduleName, new Set(['solve']));
    expect(examples).toHaveLength(1);
    expect(analyzeValues(program, new Map(), new Map(), examples,
        path => path === '001_titanic' ? importedProgram : undefined).functionResults[0].types)
        .toEqual(['array']);
});

it('reports excess axes after filtering a rank-one table', () => {
    expect(messages('use json\nuse tables\nRows = "[{\\"name\\":\\"x\\"}]" json\n'
        + 'Found = Rows filter .name equal "x"\nFound # #'))
        .toEqual(['2 selectors exceed array rank 1']);
});

it('reports excess axes after a broadcast prefix test', () => {
    expect(messages('use text\nFlags = (array "ab" "bc") "a" startswith\nFlags 0 0'))
        .toEqual(['2 selectors exceed array rank 1']);
});

it('keeps a private outer type after unsupported iteration and unpacking', () => {
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    for (const body of ['for X Y in Source\n  X = 0\n end', 'unpack X Y = Source']) {
        const program = parse(`fun keep Source\n A = array 1 2\n ${body}\n return A\nend`);
        expect(analyzeValues(program, new Map(), new Map(), [{ name: 'keep', arguments: [{ types: [] }] }])
            .functionResults[0].types).toEqual(['array']);
    }
});

it('keeps the array result of shortest-path demos through heap loops', () => {
    for (const [moduleName, functionName] of [['008_routes1', 'shortest'],
        ['013_flightroutes', 'flight_routes']]) {
        const source = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/cses/graph/${moduleName}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        const examples = functionTestExamples(testProgram.value, moduleName, new Set([functionName]));
        expect(examples).toHaveLength(4);
        expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
            .toEqual(examples.map(() => ['array']));
    }
});

it('infers unchanged range-query results through native stack pops', () => {
    for (const [moduleName, functionName] of [['013_visible', 'visible'],
        ['019_increasing', 'increase_costs']]) {
        const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        const examples = functionTestExamples(testProgram.value, moduleName, new Set([functionName]));
        expect(examples).toHaveLength(2);
        expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
            .toEqual([['array'], ['array']]);
    }
});

it('retains a private container binding after an uncertain indexed write', () => {
    const source = 'fun collect Tree Key\n Answers = new queue\n Tree Key = 1\n return Answers\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>('use algo\n' + source);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'collect', arguments: [
        { types: [] }, { types: [] },
    ] }]).functionResults[0].types).toEqual(['queue']);
    expect(messages('use algo\nCount = 1\nTree = Unknown\nTree Unknown = 1\nCount + "bad"'))
        .toEqual([]);
    const captured = source.replace(' Tree Key = 1', ' fun change\n  Answers = "changed"\n  return 0\n end\n Tree Key = 1');
    const capturedProgram = services.Rank.parser.LangiumParser.parse<Program>('use algo\n' + captured);
    expect(analyzeValues(capturedProgram.value, new Map(), new Map(), [{ name: 'collect', arguments: [
        { types: [] }, { types: [] },
    ] }]).functionResults[0].types).toEqual([]);
    const cells = services.Rank.parser.LangiumParser.parse<Program>(
        'fun read Tree Key\n A = array 1 2\n Tree Key = 1\n return A 0\nend\n');
    expect(analyzeValues(cells.value, new Map(), new Map(), [{ name: 'read', arguments: [
        { types: [] }, { types: [] },
    ] }]).functionResults[0].types).toEqual([]);
});

it('infers the unchanged range-copy result despite an uncertain indexed write', () => {
    const moduleName = '024_copies';
    const source = readFileSync(new URL(`../../../demos/cses/range/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/range/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['copies']));
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual([['queue'], ['queue']]);
});

it('retains a private text parameter type across an unknown call but not through a nested capture', () => {
    const source = 'fun outer Text\n Unknown external\n return Text\nend\nA = "abc" outer';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('A')?.types).toEqual(['text']);
    const withCapture = source.replace(' Unknown external',
        ' fun nested\n  Text = 4\n  return 0\n end\n Unknown external');
    expect(analyzeValues(parse(withCapture)).bindings.get('A')?.types).toEqual([]);
});

it('retains private scalar loop bindings across unknown calls', () => {
    const source = 'fun outer Text\n for C I in Text\n  Unknown external\n  return I + 1\n end\n return 0\nend\n';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body);
    const argument = { types: ['text'], rank: 1, shape: [3], textLiteral: 'abc' };
    expect(analyzeValues(parse(source).value, new Map(), new Map(), [
        { name: 'outer', arguments: [argument] },
    ]).functionResults[0].types).toEqual(['integer']);
    const withCapture = source.replace(' for C I in Text',
        ' fun nested\n  I = "changed"\n  return 0\n end\n for C I in Text');
    expect(analyzeValues(parse(withCapture).value, new Map(), new Map(), [
        { name: 'outer', arguments: [argument] },
    ]).functionResults[0].types).toEqual([]);
});

it('retains the private loop scalar type across an indirect index write', () => {
    const moduleName = '020_presents';
    const source = readFileSync(new URL(`../../../demos/aoc/2015/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/aoc/2015/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['firsthouse']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers circuit signals through a read-only helper and a caught retry loop', () => {
    const moduleName = '007_circuit';
    const source = readFileSync(new URL(`../../../demos/aoc/2015/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/aoc/2015/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['circuit']));
    expect(examples).toHaveLength(9);
    const helperFacts = analyzeValues(program.value, new Map(), new Map(), [
        { name: 'signal', arguments: [{ types: ['text'], rank: 1, shape: [null] },
            { types: ['index'], elements: ['integer'] }] },
        { name: 'eval_expr', arguments: [{ types: ['text'], rank: 1, shape: [null] },
            { types: ['index'], elements: ['integer'] }] },
    ]).functionResults;
    expect(helperFacts.map(fact => fact.types)).toEqual([['integer'], ['integer']]);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
    const unknownHelper = services.Rank.parser.LangiumParser.parse<Program>(source.replace(
        'Expression index eval_expr', 'Expression index Unproved'));
    expect(analyzeValues(unknownHelper.value, new Map(), new Map(), examples).functionResults
        .every(fact => !fact.types.length)).toBe(true);
    const indexWriter = services.Rank.parser.LangiumParser.parse<Program>(source.replace(
        'return Wires Token', 'Wires Token = "changed"\n      return Wires Token'));
    expect(analyzeValues(indexWriter.value, new Map(), new Map(), examples).functionResults
        .every(fact => !fact.types.length)).toBe(true);
    // Analyzing the whole circuit demo takes about 3 s, near the default limit on a slow runner.
}, 30_000);

it('joins an index before and after a potentially throwing write', () => {
    const source = 'fun read\n index "a" = 1\n try\n  index "a" = "x"\n'
        + '  Value = 1 / 0\n catch .DivisionByZero Error\n end\n return index "a"\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'read', arguments: [] }])
        .functionResults[0].types).toEqual(['integer', 'text']);
});

it('retains a private text local through indirect index writes in a loop', () => {
    const moduleName = '023_reorder';
    const source = readFileSync(new URL(`../../../demos/cses/intro/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/intro/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['solve']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['text']));
});

it('retains stdin element types in the unchanged subarray-sums program', () => {
    const moduleName = '030_sums2';
    const source = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const input = program.value.statements.filter(isAssignmentStatement).find(statement => statement.name === 'A');
    expect(input).toBeDefined();
    expect(analyzeValues(program.value).expressions.get(input!.value)).toMatchObject({ types: ['array'],
        rank: 1, elements: ['integer'], eagerScalarCells: true });
    expect(messages('use io\nA = stdin .integer 2 array\nfor Value in A\n Value + "bad"\nend'))
        .toEqual(['operator + does not accept integer and text']);
});

it('uses a proved array length as a later shape dimension', () => {
    const program = services.Rank.parser.LangiumParser.parse<Program>(
        'A = array 1 2 3\nCount = A len\nB = array shape Count fill 0\n');
    const analysis = analyzeValues(program.value);
    expect(analysis.bindings.get('Count')?.integer).toBe('3');
    expect(analysis.bindings.get('B')?.shape).toEqual([3]);
    const range = services.Rank.parser.LangiumParser.parse<Program>(
        'Count = (1 to 5) len\nB = array shape Count fill 0\n');
    expect(analyzeValues(range.value).bindings.get('B')?.shape).toEqual([5]);
});

it('invalidates captured facts when len consumes a generator', () => {
    const generator = 'fun stream\n A 0 = "x"\n yield 1\nend\nS = stream\nA = array 1 2\n';
    expect(messages(generator + 'N = S len\nA 0 + "bad"')).toEqual([]);
    expect(messages('use sequences\n' + generator + 'N = S len axis 0\nA 0 + "bad"')).toEqual([]);
    expect(messages('A = array 1 2\nS = 1 to 5\nN = S len\nA 0 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers indices of safe masks without trusting a lazy mask read', () => {
    expect(messages('use sequences\nMask = array true false true\nI = Mask indices\nI 0 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    const program = services.Rank.parser.LangiumParser.parse<Program>(
        'use sequences\nfun probe Mask\n A = array 1 2\n Mask indices\n return A 0\nend\n');
    const input = { types: ['array'], rank: 1, shape: [2], elements: ['boolean'] };
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'probe', arguments: [input] }])
        .functionResults[0].types).toEqual([]);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'probe', arguments: [
        { types: [] },
    ] }]).functionResults[0].types).toEqual([]);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'probe', arguments: [
        { ...input, eagerScalarCells: true },
    ] }]).functionResults[0].types).toEqual(['integer']);
});

it('infers findall positions only after callback-free source and key reads', () => {
    expect(messages('use sequences\nI = "ababa" "a" findall\nI 0 + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    const values = { types: ['array'], rank: 1, shape: [2], elements: ['integer'] };
    const target = { types: ['integer'], rank: 0, shape: [] };
    for (const operation of ['find', 'findall']) {
        const program = services.Rank.parser.LangiumParser.parse<Program>(
            `use sequences\nfun probe Values Target\n A = array 1 2\n Values Target ${operation}\n return A 0\nend\n`);
        const result = (...arguments_: ValueFacts[]) => analyzeValues(program.value, new Map(), new Map(), [
            { name: 'probe', arguments: arguments_ },
        ]).functionResults[0].types;
        expect(result(values, target)).toEqual([]);
        expect(result({ ...values, eagerScalarCells: true }, { types: [] })).toEqual([]);
        expect(result({ ...values, eagerScalarCells: true }, target)).toEqual(['integer']);
    }
});

it('infers the unchanged CSES subarray-sums result through computed index values', () => {
    const moduleName = '030_sums2';
    const source = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/sortnsrch/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['count_subarray_sums']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('retains a private scalar after loop widening and an unknown call', () => {
    const source = 'fun choose Items\n Best = -1\n for I in 0 till 3\n'
        + '  if Items I external\n   Best = I\n  end\n end\n return Best\nend\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    expect(analyzeValues(program.value, new Map(), new Map(), [{ name: 'choose', arguments: [{
        types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true,
    }] }]).functionResults[0].types).toEqual(['integer']);
    expect(analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source.replace(
        ' Best = -1', ' fun nested\n  Best = "changed"\n  return 0\n end\n Best = -1')).value,
    new Map(), new Map(), [{ name: 'choose', arguments: [{
        types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true,
    }] }]).functionResults[0].types).toEqual([]);
});

it('infers the unchanged Connect X result through later helper calls', () => {
    const moduleName = '010_connectx';
    const source = readFileSync(new URL(`../../../demos/kaggle/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/kaggle/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['move']));
    expect(examples).toHaveLength(6);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers pandigital primes through pure permutations, membership and first where', () => {
    const moduleName = '041_pandigitalprime';
    const source = readFileSync(new URL(`../../../demos/euler/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/euler/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['largest_pandigital_prime']));
    expect(examples).toHaveLength(1);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual([['integer']]);
});

it('uses the preceding join result for an imported unary function example', () => {
    const moduleName = '003_triangles';
    const source = readFileSync(new URL(`../../../demos/aoc/2016/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/aoc/2016/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['solve']));
    expect(examples).toHaveLength(1);
    expect(examples[0].arguments.map(fact => fact.types)).toEqual([['text']]);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults[0].types)
        .toEqual(['array']);
});

it('checks scalar cells after reshaping eager input', () => {
    expect(messages('use sequences\nA = array 1 2 3 4\nB = A (array 2 2) reshape\n'
        + 'for Row in B\n Row 0 + "bad"\nend'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use sequences\nB = (1 to 4) (array 2 2) reshape\n'
        + 'for Row in B\n Row 0 + "bad"\nend'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers the unchanged CSES increasing-subsequences Fenwick result', () => {
    const moduleName = '023_incsubseq2';
    const source = readFileSync(new URL(`../../../demos/cses/dynamic/${moduleName}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/cses/dynamic/${moduleName}_test.ra`, import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(['increasing_subsequences']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
    expect(messages('use algo\nF = 2 fenwick\nF 0 = 1\n(F sum 0) + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nF = 2 fenwick\nF = 1'))
        .toEqual(['F has type fenwick and cannot receive integer']);
    expect(messages('use algo\nF = 2 fenwick\nF "x" = 1'))
        .toEqual(['fenwick index must be integer, got text']);
    expect(messages('use algo\nF = 2 fenwick\nF 0 = "x"'))
        .toEqual(['fenwick value must be integer, got text']);
    expect(messages('use algo\nF = 2 fenwick\nF 0 /= 2'))
        .toEqual(['fenwick value must be integer, got real']);
    expect(messages('use algo\nF = 2 fenwick\nF "x"'))
        .toEqual(['fenwick index must be integer, got text']);
    expect(messages('use algo\nF = 2 fenwick\nF sum "x"'))
        .toEqual(['fenwick index must be integer, got text']);
    expect(messages('use algo\nF = 2 fenwick\nF X = Y')).toEqual([]);
    expect(messages('use algo\nF = 2 fenwick\nF X\nF sum X')).toEqual([]);
});

it('infers the unchanged CSES graph-path matrix result', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/023_graphpaths1.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/023_graphpaths1_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '023_graphpaths1', new Set(['path_count']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged Zigzag demo from its test inputs', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/006_zigzag.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/006_zigzag_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '006_zigzag', new Set(['zigzag']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['text']));
});

it('infers returns through try and catch without assuming partial writes', () => {
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    const both = 'fun choose\n try\n  return 1\n catch Error\n  return "fallback"\n end\nend\nA = choose';
    expect(analyzeValues(parse(both)).bindings.get('A')?.types).toEqual(['integer', 'text']);
    const caught = 'fun choose\n Value = 1\n try\n  Value = 2\n  1 / 0\n catch Error\n  return Value\n end\nend\nA = choose';
    expect(analyzeValues(parse(caught)).bindings.get('A')?.types).toEqual(['integer']);
    expect(analyzeValues(parse(caught)).bindings.get('A')?.integer).toBeUndefined();
    expect(messages('fun choose\n try\n  return array 1 2\n catch Error\n  return array 3 4\n end\nend\nA = choose\nA # #'))
        .toEqual(['2 selectors exceed array rank 1']);
});

it('does not analyze statements after a definite no-return call', () => {
    const fail = 'fun fail\n Value = 1\nend\n';
    expect(messages(fail + 'fail\nA = 1\nA + "bad"')).toEqual([]);
    expect(messages(fail + 'A = fail\nA + "bad"')).toEqual([]);
    expect(messages('fun fail\n fun nested\n  return 1\n end\n nested\nend\nfail\nA = 1\nA + "bad"'))
        .toEqual([]);
    expect(messages(fail + 'if Flag\n fail\nelse\n A = 1\nend\nA + "bad"')).toEqual([]);
    expect(messages(fail + 'fun choose Flag\n if Flag\n  fail\n else\n  return 1\n end\nend\nA = true choose\nA + "bad"'))
        .toEqual([]);
    expect(messages(fail + 'fun choose Flag\n if Flag\n  fail\n else\n  return 1\n end\nend\nA = false choose\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun stream\n if false\n  yield 1\n end\nend\nstream\nA = 1\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(fail + 'try\n fail\ncatch Error\n A = 1\nend\nA + "bad"')).toEqual([]);
});

it('infers a generator sequence without executing its body', () => {
    const source = 'fun stream\n if false\n  yield 1\n end\nend\nS = stream\n';
    expect(messages(source + 'S = 1')).toEqual(['S has type sequence and cannot receive integer']);
    expect(messages(source + 'A = S array\nA # #')).toEqual(['2 selectors exceed array rank 1']);
    expect(messages('fun stream\n yield array 1 2\nend\nA = stream array\nA # #')).toEqual([]);
    expect(messages('fun outer\n fun inner\n  yield 1\n end\n return 2\nend\nA = outer\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    expect(analyzeValues(parse('fun stream X\n yield X\nend\nS = 1 stream')).bindings.get('S'))
        .toMatchObject({ types: ['sequence'], elements: ['integer'], rank: 1 });
    expect(analyzeValues(parse('fun stream\n yield 1\n yield "x"\nend\nS = stream')).bindings.get('S')?.elements)
        .toEqual(['integer', 'text']);
    expect(messages('fun stream\n yield 1\n yield "x"\nend'))
        .toEqual(['stream yields incompatible types: integer and text']);
    expect(messages('fun stream\n if false\n  yield 1\n end\n yield "x"\nend')).toEqual([]);
    expect(messages('fun stream\n return\n yield 1\n yield "x"\nend')).toEqual([]);
    expect(messages('fun stream Flag\n if Flag\n  return\n else\n  return\n end\n yield 1\n yield "x"\nend'))
        .toEqual([]);
    expect(messages('fun stream X\n yield 1\n yield X\nend\nS = "x" stream'))
        .toEqual(['stream yields incompatible types: integer and text']);
    expect(messages('fun stream\n Cell = 1\n yield Cell\n yield "x"\nend'))
        .toEqual(['stream yields incompatible types: integer and text']);
    expect(messages('fun stream X\n Cell = X\n yield Cell\n yield 1\nend\nS = "x" stream'))
        .toEqual(['stream yields incompatible types: text and integer']);
    expect(messages('fun stream\n First = "x"\n Second = First\n yield Second\n yield 1\nend'))
        .toEqual(['stream yields incompatible types: text and integer']);
    expect(messages('fun stream Flag\n Cell = 1\n if Flag\n  Cell = "x"\n end\n yield Cell\n yield "x"\nend'))
        .toEqual([]);
    expect(messages('fun stream X\n yield 1\n yield X\nend\nS = Unknown stream')).toEqual([]);
    expect(analyzeValues(parse('fun stream X\n X = "changed"\n yield X\nend\nS = 1 stream')).bindings.get('S')?.elements)
        .toBeUndefined();
    expect(analyzeValues(parse('Shared = 1\nfun stream\n yield Shared\nend\nS = stream')).bindings.get('S')?.elements)
        .toBeUndefined();
});

it('checks reshape element counts when source and target dimensions are known', () => {
    expect(messages('use sequences\nA = (1 to 5) (array 2 3) reshape'))
        .toEqual(['reshape expects 6 elements, got 5']);
    expect(messages('use sequences\nA = (1 to 6) (array 2 3) reshape')).toEqual([]);
});

it('allows integer addressing to continue into a text array element', () => {
    expect(messages('A = array "ab" "cd"\nA 0 1')).toEqual([]);
});

it('invalidates dimensions for a potentially effectful call inside a branch', () => {
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\nend\nif Flag\n change\nend\nB = array 1 2 3\nA + B')).toEqual([]);
});

it('does not apply builtin reshape rules to a local function with the same name', () => {
    expect(messages('fun reshape A B\n return 1\nend\nX = (array 1 2) (array 3 4) reshape'))
        .toEqual([]);
});

it('does not report an error in an unproven or unreachable function branch', () => {
    expect(messages('fun choose X\n if X\n  return 1 + "bad"\n end\n return 0\nend\nfalse choose')).toEqual([]);
    expect(messages('fun choose X\n if false\n  return 1 + "bad"\n end\n return 0\nend\nfalse choose')).toEqual([]);
});

it('checks known array element types while treating text as a broadcast atom', () => {
    expect(messages('A = array true false\nB = array 1 2\nA + B'))
        .toEqual(['operator + does not accept boolean and integer']);
    expect(messages('A = "prefix" + (array "a" "b")\nB = array "c" "d"\nA + B')).toEqual([]);
});

it('reports the removed DSU find spelling with and without sequences', () => {
    for (const modules of ['use graph', 'use graph\nuse sequences']) {
        for (const call of ['D find "a"', 'D "a" find', '(new dsu (array "a")) "a" find']) {
            expect(messages(`${modules}\nD = new dsu (array "a")\n${call}`))
                .toEqual(['DSU find is now findroot']);
        }
    }
});

it('limits rename diagnostics to known receivers and builtin names', () => {
    expect(messages('use sequences\n(array "a" "b") "b" find')).toEqual([]);
    expect(messages('use graph\nD = new dsu (array "a")\nD findroot "a"')).toEqual([]);
    expect(messages('use graph\nfun find D X\n return 99\nend\nD = new dsu (array "a")\nD "a" find')).toEqual([]);
    expect(messages('use sequences\nfun search D X\n return D X find\nend')).toEqual([]);
});
