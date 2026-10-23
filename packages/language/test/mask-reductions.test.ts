import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { type Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';

let parse: ReturnType<typeof parseHelper<Program>>;
beforeAll(() => { parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank); });
const imports = 'use sequences\nuse numbers\nuse stats\n';

it.each(['sum', 'lcm', 'mean', 'median', 'std', 'variance', 'var', 'skewness', 'skew',
    'quantile', 'percentile'])('diagnoses boolean masks passed to %s', async operation => {
    for (const source of ['array 1 2 3 4 5', '1 to 5', 'fibonacci till 100']) {
        for (const predicate of ['even', 'greater 2']) {
            for (const program of [`A ${predicate} ${operation}`, `Mask = A ${predicate}\nMask ${operation}`,
                `Mask' = A ${predicate}\nMask ${operation}`]) {
                const doc = await parse(`${imports}A = ${source}\n${program}`, { validation: true });
                expect(doc.parseResult.parserErrors).toEqual([]);
                expect(doc.diagnostics).toEqual([expect.objectContaining({ severity: 1, code: 'TypeError',
                    message: expect.stringMatching(/expects numbers, not a boolean mask.*filter.*Mask count/) })]);
            }
        }
    }
});

it('preserves boolean element types and shapes through extraction and extrema', async () => {
    const setup = `${imports}A = (array 1 2 3 4) reshape 2 2\n`;
    const doc = await parse(setup + 'Mask = A even');
    expect(analyzeValues(doc.parseResult.value).bindings.get('Mask')).toMatchObject({
        types: ['array'], elements: ['boolean'], rank: 2, shape: [2, 2],
    });
    for (const program of ['Result = (A even) min', 'Result = (A even) max',
        'Mask = A even\nResult = Mask min', 'Mask = A even\nResult = Mask max']) {
        const doc = await parse(setup + program);
        expect(analyzeValues(doc.parseResult.value).bindings.get('Result')).toMatchObject({
            types: ['boolean'], rank: 0, shape: [],
        });
    }
});

it('accepts explicit selection, filtering, boolean consumers and empty reductions', async () => {
    for (const program of ['A filter even sum', 'Kept = A filter greater 2\nKept sum',
        'A (A even) sum', 'Mask = A even\nA Mask sum', 'A even count', 'A even min', 'A even max',
        'A even min .index', 'A even max .indexed', 'A even any', 'A even all']) {
        const doc = await parse(`${imports}A = 1 to 5\n${program}`, { validation: true });
        expect(doc.diagnostics).toEqual([]);
    }
    const doc = await parse(`${imports}A = array shape 0\nend\nA even sum`, { validation: true });
    expect(doc.diagnostics).toEqual([]);
});

it('does not apply the builtin reduction hint to a user function', async () => {
    const doc = await parse('fun Flags mean = Flags count\nuse sequences\nMask = array true false\nMask mean', { validation: true });
    expect(doc.diagnostics).toEqual([]);
});
