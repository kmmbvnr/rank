import { EmptyFileSystem } from 'langium';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';
import { functionTestExamples, moduleSummary, type ModuleSummary } from '../src/analysis/test-examples.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function examples(source: string, moduleName: string | null = 'helpers', moduleFunctions?: ReadonlySet<string>,
    summarize?: ModuleSummary) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return functionTestExamples(parsed.value, moduleName ?? undefined, moduleFunctions, summarize);
}
it('extracts arguments and expectations without running the test', () => {
    const result = examples('test "one"\n use "helpers"\n A = 3\n B = A addone\n B equal 4\nend');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'addone', arguments: [{ types: ['integer'] }], expected: { types: ['integer'] }, test: 'one', line: 5 });
});
it('extracts tests in the same file without an import', () => {
    const source = 'fun addone X\n return X + 1\nend\ntest "local"\n Result = 3 addone\n Result equal 4\n (2 unrelated) equal "ignored"\nend';
    expect(examples(source, null)).toMatchObject([{ name: 'addone', expected: { types: ['integer'] }, line: 6 }]);
    expect(examples(source.replace('Result =', 'use "other"\n Result ='), null)).toEqual([]);
});
it('resolves an aliased import and ignores another module', () => {
    expect(examples('test "one"\n use "helpers" as H\n (3 H.addone) equal 4\nend')[0]?.name).toBe('addone');
    expect(examples('test "one"\n use "other"\n (3 addone) equal 4\nend')).toEqual([]);
});

it('passes a completed builtin pipeline as one test argument', () => {
    const source = 'test "pipeline"\n use "helpers"\n use text\n'
        + ' Lines = array "a" "b"\n Answer = Lines "," join solve\n Answer equal 2\nend';
    expect(examples(source, 'helpers', new Set(['solve']))).toMatchObject([{
        name: 'solve', arguments: [{ types: ['text'] }], expected: { types: ['integer'] },
    }]);
    expect(examples(source.replace(' use text\n', ''), 'helpers', new Set(['solve']))[0].arguments)
        .toHaveLength(3);
});

it('attributes a shape-preserving assertion to the imported function, not round', () => {
    const source = 'test "array result"\n use "softmaxmod"\n use numbers\n Scores = array 1 2 3\n'
        + ' Expected = array 0.1 0.2 0.7\n Result = Scores softmax\n Result round 4 equal Expected\nend';
    expect(examples(source, 'softmaxmod', new Set(['softmax']))).toMatchObject([{
        name: 'softmax', arguments: [{ types: ['array'], rank: 1, shape: [3] }],
        expected: { types: ['array'], rank: 1, shape: [3] }, line: 7,
    }]);
    expect(examples(source.replace('Expected = array 0.1 0.2 0.7', 'Expected = 1'),
        'softmaxmod', new Set(['softmax']))).toEqual([]);
    expect(examples(source.replace(' use numbers\n', ''),
        'softmaxmod', new Set(['softmax']))).toEqual([]);
});

describe('records built by the tested module', () => {
    const module = 'fun make N\n return record\n .weights = array shape N N fill 0.0\n .count = 1\n end\nend\n'
        + 'fun predict Model X\n W = Model .weights\n Model .count = 2\n return X W matmul\nend\n';
    const tests = (body: string) => 'test "t"\n use "m"\n use linalg\n Model = 2 make\n' + body + '\nend';
    const run = (body: string) => {
        const imported = services.Rank.parser.LangiumParser.parse<Program>(module);
        expect(imported.parserErrors).toEqual([]);
        return examples(tests(body), 'm', new Set(['make', 'predict']), moduleSummary(imported.value));
    };
    const source = ' X = array shape 2 2 fill 1.0\n (Model X predict) equal X';

    it('binds the returned record only when a summary is supplied', () => {
        expect(examples(tests(source), 'm', new Set(['make', 'predict']))[0].arguments[0].types).toEqual([]);
        expect(run(source)[0].arguments[0]).toMatchObject({ types: ['record'],
            fields: { count: { types: ['integer'] }, weights: { types: ['array'] } } });
    });

    it('applies a field write of the same type and forgets dimensions after other effects', () => {
        const written = run(' Model .weights = array shape 3 3 fill 1.0\n' + source)[0].arguments[0];
        expect(written.fields?.weights).toMatchObject({ rank: 2, shape: [3, 3], elements: ['real'] });
        const after = run(' Model .weights = array shape 3 3 fill 1.0\n Other = 1 make\n' + source)[0].arguments[0];
        expect(after.fields?.weights).toMatchObject({ types: ['array'], rank: 2, shape: [null, null] });
        expect(after.fields?.count).toMatchObject({ types: ['integer'] });
    });

    it('drops the record when a write cannot be proven to keep the field type', () => {
        for (const write of [' Model .weights = 1', ' Model .missing = 1', ' Model .count += 1']) {
            expect(run(write + '\n' + source)[0].arguments[0].types).toEqual([]);
        }
    });

    it('lets an aliased write resize the fields of every record binding', () => {
        const aliased = run(' Alias = Model\n Alias .weights = array shape 5 5 fill 1.0\n' + source)[0].arguments[0];
        expect(aliased.fields?.weights).toMatchObject({ types: ['array'], rank: 2, shape: [null, null] });
    });
});

describe('matrix predictions from record fields', () => {
    const analyze = (source: string, ...args: ValueFacts[]) => {
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
        expect(parsed.parserErrors).toEqual([]);
        return analyzeValues(parsed.value, new Map(), new Map(), [{ name: 'f', arguments: args }]).functionResults[0];
    };
    const model: ValueFacts = { types: ['record'], rank: 0, shape: [], closedRecord: true, fields: {
        weights: { types: ['array'], rank: 1, shape: [null], elements: ['real'] },
        bias: { types: ['real'], rank: 0, shape: [] },
        scale: { types: ['array'], rank: 1, shape: [null], elements: ['real'] },
    } };
    const matrix: ValueFacts = { types: ['array'], rank: 2, shape: [4, 3], elements: ['real'], eagerScalarCells: true };

    it('reads a field in the middle of an application', () => {
        expect(analyze('use linalg\nfun f X Model\n return X Model .weights matmul + Model .bias\nend', matrix, model))
            .toMatchObject({ types: ['array'], rank: 1, shape: [4] });
    });

    it('keeps the array result after writing a different field first', () => {
        const layer: ValueFacts = { ...model, fields: { ...model.fields,
            input: { types: ['array'], rank: 2, shape: [null, null] } } };
        expect(analyze('use linalg\nfun f Layer X\n Layer .input = X\n W = Layer .weights\n return X W matmul\nend',
            layer, matrix)).toMatchObject({ types: ['array'], rank: 1 });
    });

    it('selects numeric cells by a boolean mask with the broadcast shape', () => {
        const source = 'use numbers\nuse sequences\nuse stats\nfun f X\n Std = X std axis 0\n'
            + ' return (Std equal 0) 1.0 Std choose\nend';
        expect(analyze(source, matrix)).toMatchObject({ types: ['array'], rank: 1, shape: [3], elements: ['real'] });
        expect(analyze(source, { ...matrix, elements: ['integer'] })).toMatchObject({ types: ['array'], rank: 1,
            shape: [3], elements: ['real'] });
        expect(analyze(source, { types: [] }).types).toEqual([]);
    });

    it('leaves a mask selection unknown without a boolean array mask or numeric branches', () => {
        const scalarMask = 'use sequences\nfun f A B\n return true A B choose\nend';
        expect(analyze(scalarMask, matrix, matrix).types).toEqual([]);
        const textBranch = 'use sequences\nuse numbers\nfun f A\n return (A equal 0) "x" A choose\nend';
        expect(analyze(textBranch, { types: ['array'], rank: 1, shape: [3], elements: ['integer'] }).types).toEqual([]);
    });

    it('does not group a label after a name with no proven record field', () => {
        const source = 'use linalg\nfun f X Model\n return X Model .weights matmul\nend';
        expect(analyze(source, matrix, { ...model, fields: { bias: model.fields!.bias } }).rank).toBeUndefined();
        expect(analyze(source, matrix, { types: [] }).rank).toBeUndefined();
    });
});
