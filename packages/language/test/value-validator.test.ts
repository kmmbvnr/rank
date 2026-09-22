import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';

let parse: ReturnType<typeof parseHelper<Program>>;
beforeAll(() => { parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank); });
it('publishes a located type diagnostic through language validation', async () => {
    const document = await parse('A = 1\nA = "x"\n', { validation: true });
    expect(document.diagnostics).toContainEqual(expect.objectContaining({
        message: 'A has type integer and cannot receive text', code: 'TypeError',
        range: expect.objectContaining({ start: expect.objectContaining({ line: 1 }) }),
    }));
});
it('does not analyze a parser-recovered incomplete draft', async () => {
    const document = await parse('A = 1\nA = "x"\nB =\n', { validation: true });
    expect(document.parseResult.parserErrors.length).toBeGreaterThan(0);
    expect(document.diagnostics?.filter(diagnostic => diagnostic.code === 'TypeError')).toEqual([]);
});
