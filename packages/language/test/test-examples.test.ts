import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { functionTestExamples } from '../src/analysis/test-examples.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function examples(source: string, moduleName: string | null = 'helpers') {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return functionTestExamples(parsed.value, moduleName ?? undefined);
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
