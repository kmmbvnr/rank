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
it.each([
    ['I = 99\nfor I in 1 to 3\nend\n', 'I', 'for', 1],
    ['Error = 99\ntry\n .Oops raise\ncatch Error\nend\n', 'Error', 'catch', 3],
])('locates a conflicting block header in the editor: %s', async (source, name, kind, line) => {
    const document = await parse(source, { validation: true });
    expect(document.diagnostics).toContainEqual(expect.objectContaining({
        message: `${name} is already bound outside this block; use a different ${kind} binding name.`,
        severity: 1,
        range: expect.objectContaining({ start: expect.objectContaining({ line }) }),
    }));
});
it('does not analyze a parser-recovered incomplete draft', async () => {
    const document = await parse('A = 1\nA = "x"\nB =\n', { validation: true });
    expect(document.parseResult.parserErrors.length).toBeGreaterThan(0);
    expect(document.diagnostics?.filter(diagnostic => diagnostic.code === 'TypeError')).toEqual([]);
});

it('locates incompatible yield types before a generator is called', async () => {
    const document = await parse('fun stream\n yield 1\n yield "x"\nend\n', { validation: true });
    expect(document.diagnostics).toContainEqual(expect.objectContaining({
        message: 'stream yields incompatible types: integer and text', code: 'TypeError',
        range: expect.objectContaining({ start: expect.objectContaining({ line: 2 }) }),
    }));
});

it('locates incompatible yields through a straight-line local alias', async () => {
    const document = await parse('fun stream\n Cell = 1\n yield Cell\n yield "x"\nend\n', { validation: true });
    expect(document.diagnostics).toContainEqual(expect.objectContaining({
        message: 'stream yields incompatible types: integer and text', code: 'TypeError',
        range: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
    }));
});

it('publishes a function return-contract error before the function is called', async () => {
    const document = await parse('fun Flag pick\n if Flag\n return 1\n end\n return true\nend\n', { validation: true });
    expect(document.diagnostics).toContainEqual(expect.objectContaining({
        message: 'pick returns incompatible types: integer and boolean', code: 'TypeError',
        range: expect.objectContaining({ start: expect.objectContaining({ line: 0 }) }),
    }));
});
