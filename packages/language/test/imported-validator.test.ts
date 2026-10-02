import { EmptyFileSystem, URI } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeEach, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';

let parse: ReturnType<typeof parseHelper<Program>>;
let services: ReturnType<typeof createRankServices>;
beforeEach(() => {
    services = createRankServices(EmptyFileSystem);
    parse = parseHelper<Program>(services.Rank);
});

const at = (name: string) => ({ documentUri: `file:///work/${name}.ra` });
const MAIN = 'use "helper" as M\nA = 1\nA = 2 M.label\n';
const TEXT_ERROR = 'A has type integer and cannot receive text';

async function messages(source: string, name = 'main'): Promise<string[]> {
    const document = await parse(source, { ...at(name), validation: true });
    return (document.diagnostics ?? []).map(diagnostic => String(diagnostic.message));
}

it('uses the result of a call into an imported module that the workspace holds', async () => {
    await parse('fun label X\n return "x"\nend\n', at('helper'));
    expect(await messages(MAIN)).toContain(TEXT_ERROR);
});

it('resolves the path relative to the importing document and accepts an explicit extension', async () => {
    await parse('fun label X\n return "x"\nend\n', { documentUri: 'file:///work/lib/helper.ra' });
    expect(await messages(MAIN, 'main')).not.toContain(TEXT_ERROR);
    expect(await messages('use "lib/helper.ra" as M\nA = 1\nA = 2 M.label\n', 'again')).toContain(TEXT_ERROR);
});

it('says nothing about an import the workspace does not hold', async () => {
    expect(await messages(MAIN)).toEqual([]);
});

it('says nothing about an import with syntax errors', async () => {
    await parse('fun label X\n return "x"\nend\nB =\n', at('helper'));
    expect(await messages(MAIN)).toEqual([]);
});

it('follows a changed module rather than a remembered summary', async () => {
    await parse('fun label X\n return 1\nend\n', at('helper'));
    expect(await messages(MAIN)).not.toContain(TEXT_ERROR);
    // The workspace replaces the document when its file changes.
    services.shared.workspace.LangiumDocuments.deleteDocument(URI.parse('file:///work/helper.ra'));
    await parse('fun label X\n return "x"\nend\n', at('helper'));
    expect(await messages(MAIN, 'second')).toContain(TEXT_ERROR);
});

it('drops the summary once the alias is bound to another module or the name is rebound', async () => {
    await parse('fun label X\n return "x"\nend\n', at('helper'));
    await parse('fun label X\n return 1\nend\n', at('other'));
    expect(await messages('use "helper" as M\nuse "other" as M\nA = 1\nA = 2 M.label\n', 'rebound'))
        .not.toContain(TEXT_ERROR);
    expect(await messages('use "helper" as M\nM.label = 5\nA = 1\nA = 2 M.label\n', 'written'))
        .not.toContain(TEXT_ERROR);
});

it('survives modules that import each other and a module that imports itself', async () => {
    await parse('use "second" as S\nfun label X\n return 1 S.label\nend\n', at('first'));
    await parse('use "first" as F\nfun label X\n return 1 F.label\nend\n', at('second'));
    await parse('use "selfish" as Me\nfun label X\n return 1 Me.label\nend\n', at('selfish'));
    expect(await messages('use "first" as M\nA = 1\nA = 2 M.label\n', 'cycle')).not.toContain(TEXT_ERROR);
    expect(await messages('use "selfish" as M\nA = 1\nA = 2 M.label\n', 'self')).not.toContain(TEXT_ERROR);
});
