import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices, forIteration, isForStatement, loopNames, type Program } from '../src/index.js';
import { loopBinding } from '../src/analysis/control-flow.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;

it.each([
    ['Value in Items', ['Value']],
    ['Value Index in Items', ['Value', 'Index']],
    ['Value Row Column Depth in Items', ['Value', 'Row', 'Column', 'Depth']],
    ['# Row # Depth in Items', ['#', 'Row', '#', 'Depth']],
    ['# in Items', ['#']],
    ['Count less 10', undefined],
    ['1 in Items', undefined],
    ['Value + Other in Items', undefined],
    ['', undefined],
] as const)('classifies for %s consistently', (header, names) => {
    const parsed = parser.parse<Program>(`for ${header}\nend\n`);
    expect(parsed.parserErrors).toEqual([]);
    const loop = parsed.value.statements[0];
    if (!isForStatement(loop)) throw new Error('expected loop');
    const binding = forIteration(loop.condition);
    expect(binding?.names).toEqual(names);
    expect(loopBinding(loop.condition)).toEqual(binding);
    expect(loopNames(loop.condition)).toEqual(names?.filter(name => name !== '#') ?? []);
    if (binding) expect(binding.iterable).toMatchObject({ $type: 'NameExpression', name: 'Items' });
});
