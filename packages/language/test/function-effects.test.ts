import { AstUtils, EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
import { functionEffects } from '../src/analysis/function-effects.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function analyze(source: string, name = 'helper') {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definitions = new Map([...AstUtils.streamAllContents(parsed.value)]
        .filter(isFunctionStatement).map(node => [node.name, node]));
    return functionEffects(name => definitions.get(name), name => definitions.has(name))(name);
}

it('distinguishes reads, parameter writes and captured object writes', () => {
    expect(analyze('fun helper X Y\n return X + Y\nend'))
        .toEqual({ unknown: false, parameters: new Set(), captures: new Set(), returns: [{ kind: 'unknown' }] });
    expect(analyze('fun helper X Y\n X 0 = Y\n Shared 0 = 1\n return 0\nend'))
        .toEqual({ unknown: false, parameters: new Set([0]), captures: new Set(['Shared']), returns: [{ kind: 'fresh' }] });
});

it('maps helper writes to the enclosing parameters', () => {
    expect(analyze('fun write X\n X 0 = 1\n return 0\nend\nfun helper A B\n B write\n return A\nend'))
        .toEqual({ unknown: false, parameters: new Set([1]), captures: new Set(),
            returns: [{ kind: 'parameter', index: 0 }] });
});

it('records direct result origins without guessing through locals or expressions', () => {
    expect(analyze('fun helper X\n return X\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
    expect(analyze('fun helper\n return Shared\nend').returns)
        .toEqual([{ kind: 'capture', name: 'Shared' }]);
    expect(analyze('fun helper X\n return array 1 2\nend').returns)
        .toEqual([{ kind: 'fresh' }]);
    expect(analyze('fun helper X\n Y = X\n return Y\nend').returns)
        .toEqual([{ kind: 'unknown' }]);
    expect(analyze('fun helper X\n X = array 1 2\n return X\nend').returns)
        .toEqual([{ kind: 'unknown' }]);
    expect(analyze('fun helper X\n if Flag\n  return X\n end\n return array 1 2\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }, { kind: 'fresh' }]);
    expect(analyze('fun helper X\n if Flag\n  return X\n end\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }, { kind: 'unknown' }]);
});

it('unions possible branch effects', () => {
    expect(analyze('fun helper A B\n if Flag\n A 0 = 1\n else\n B 0 = 2\n end\n return 0\nend').parameters)
        .toEqual(new Set([0, 1]));
});

it('keeps aliases, recursion, dynamic calls, I/O and compound assignments unknown', () => {
    for (const body of ['Y = X\n Y 0 = 1', 'X = Other\n X 0 = 1', 'X helper',
        'X external', 'Y = stdin .integer', 'X += 1', 'X 0 += 1', 'X .field = 1',
        'Module.X = 1', 'for\n break\nend']) {
        expect(analyze(`fun helper X\n ${body}\n return 0\nend`).unknown, body).toBe(true);
    }
    expect(analyze('fun helper X callback\n X callback\n return 0\nend').unknown).toBe(true);
    expect(analyze('fun outer\n A = array 1 2\n fun helper\n  A = array 3 4\n  return 0\n end\n return helper\nend').unknown).toBe(true);
});

it('does not confuse a helper capture with an equally named caller local', () => {
    expect(analyze('fun write Y\n X 0 = Y\n return 0\nend\nfun helper X\n 0 write\n return X\nend').unknown)
        .toBe(true);
});
