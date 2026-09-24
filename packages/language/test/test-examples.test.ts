import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { functionTestExamples } from '../src/analysis/test-examples.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function examples(source: string, moduleName: string | null = 'helpers', moduleFunctions?: ReadonlySet<string>) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return functionTestExamples(parsed.value, moduleName ?? undefined, moduleFunctions);
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
