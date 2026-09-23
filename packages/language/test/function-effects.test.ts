import { AstUtils, EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
import { functionEffects } from '../src/analysis/function-effects.js';
import { flatArrayBorrowCandidates } from '../src/analysis/flat-array-borrow.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function analyze(source: string, name = 'helper') {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definitions = new Map([...AstUtils.streamAllContents(parsed.value)]
        .filter(isFunctionStatement).map(node => [node.name, node]));
    return functionEffects(name => definitions.get(name), name => definitions.has(name))(name);
}
function borrowCandidates(source: string, name = 'helper', resolveHelpers = true) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definitions = new Map([...AstUtils.streamAllContents(parsed.value)]
        .filter(isFunctionStatement).map(node => [node.name, node]));
    return flatArrayBorrowCandidates(definitions.get(name)!, helper => resolveHelpers ? definitions.get(helper) : undefined);
}

it('distinguishes reads, parameter writes and captured object writes', () => {
    expect(analyze('fun helper X Y\n return X + Y\nend'))
        .toEqual({ unknown: false, parameters: new Set(), captures: new Set(),
            readParameters: new Set(), readCaptures: new Set(), returns: [{ kind: 'unknown' }] });
    expect(analyze('fun helper X Y\n X 0 = Y\n Shared 0 = 1\n return 0\nend'))
        .toEqual({ unknown: false, parameters: new Set([0]), captures: new Set(['Shared']),
            readParameters: new Set(), readCaptures: new Set(), returns: [{ kind: 'fresh' }] });
});

it('maps helper writes to the enclosing parameters', () => {
    expect(analyze('fun write X\n X 0 = 1\n return 0\nend\nfun helper A B\n B write\n return A\nend'))
        .toEqual({ unknown: false, parameters: new Set([1]), captures: new Set(),
            readParameters: new Set(), readCaptures: new Set(),
            returns: [{ kind: 'parameter', index: 0 }] });
});

it('records indexed reads through resolved helpers', () => {
    expect(analyze('fun helper X\n return X 0\nend')).toMatchObject({
        unknown: false, readParameters: new Set([0]), readCaptures: new Set(),
    });
    expect(analyze('fun read X\n return X 0\nend\nfun helper A\n return A read\nend')).toMatchObject({
        unknown: false, readParameters: new Set([0]), readCaptures: new Set(),
    });
    expect(analyze('fun helper\n return Shared 0\nend')).toMatchObject({
        unknown: false, readParameters: new Set(), readCaptures: new Set(['Shared']),
    });
    expect(analyze('fun read X\n return Shared 0\nend\nfun helper Shared\n return 1 read\nend').unknown).toBe(true);
});

it('proves reads of a private eager literal array, including through a helper', () => {
    expect(analyze('fun helper\n Temp = array 1 2\n return Temp 0\nend')).toMatchObject({
        unknown: false, readParameters: new Set(), readCaptures: new Set(),
    });
    expect(analyze('fun read X\n return X 0\nend\nfun helper\n Temp = array 1 2\n return Temp read\nend'))
        .toMatchObject({ unknown: false, readParameters: new Set(), readCaptures: new Set() });
    for (const body of ['Temp = Source\n return Temp 0', 'Temp = array 1 2\n Temp 0 = Source\n return Temp 0',
        'Temp = array 1 2\n Temp = Source\n return Temp 0', 'return Temp 0\n Temp = array 1 2']) {
        expect(analyze(`fun helper\n ${body}\nend`).unknown, body).toBe(true);
    }
});

it('proves a flat-array reader does not escape through a resolved helper', () => {
    expect(borrowCandidates('fun helper X\n return X 0\nend')).toEqual(new Set([0]));
    expect(borrowCandidates('fun read X\n return X 0\nend\nfun helper A\n return A read\nend'))
        .toEqual(new Set([0]));
    expect(borrowCandidates('fun helper X\n if true\n  return X 0\n else\n  return X 1\n end\nend'))
        .toEqual(new Set([0]));
});

it('keeps aliases, returns, writes and unknown calls outside the borrow proof', () => {
    for (const body of ['return X', 'Y = X\n return Y 0', 'X 0 = 1\n return X 0',
        'Shared 0 = 1\n return X 0', 'return X external', 'return X helper',
        'return X * 2', 'return (X + 1) 0']) {
        expect(borrowCandidates(`fun helper X\n ${body}\nend`), body).toEqual(new Set());
    }
    expect(borrowCandidates('fun helper X\n return (X 0) * 2\nend')).toEqual(new Set([0]));
    expect(borrowCandidates('fun helper X callback\n callback\n return X 0\nend'))
        .toEqual(new Set());
    expect(borrowCandidates('fun read X\n return X\nend\nfun helper A\n return A read\nend'))
        .toEqual(new Set());
    expect(borrowCandidates('fun read X\n return X 0\nend\nfun helper A\n return A read\nend', 'helper', false))
        .toEqual(new Set());
});

it('records direct result origins and follows straight-line local names', () => {
    expect(analyze('fun helper X\n return X\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
    expect(analyze('fun helper\n return Shared\nend').returns)
        .toEqual([{ kind: 'capture', name: 'Shared' }]);
    expect(analyze('fun helper X\n return array 1 2\nend').returns)
        .toEqual([{ kind: 'fresh' }]);
    expect(analyze('fun helper X\n Y = X\n return Y\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
    expect(analyze('fun helper X\n X = array 1 2\n return X\nend').returns)
        .toEqual([{ kind: 'fresh' }]);
    expect(analyze('fun helper X\n Y = X\n Y = array 1 2\n return Y\nend').returns)
        .toEqual([{ kind: 'fresh' }]);
    expect(analyze('fun helper X\n if Flag\n  return X\n end\n return array 1 2\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }, { kind: 'fresh' }]);
    expect(analyze('fun helper X\n Y = array 1 2\n if Flag\n  return X\n end\n return Y\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }, { kind: 'fresh' }]);
    expect(analyze('fun helper X\n if Flag\n  return X\n end\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }, { kind: 'unknown' }]);
    expect(analyze('fun helper X\n return X\n return array 1 2\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
});

it('joins returned origins through branches and resolved helpers', () => {
    expect(analyze('fun helper X Y\n if Flag\n  Result = X\n else\n  Result = Y\n end\n return Result\nend').returns)
        .toEqual([{ kind: 'unknown' }]);
    expect(analyze('fun helper X\n if Flag\n  Result = X\n else\n  Result = X\n end\n return Result\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
    expect(analyze('fun identity X\n return X\nend\nfun helper X\n Y = X identity\n return Y\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
    expect(analyze('fun choose X\n if Flag\n  return X\n end\n return array 1 2\nend\nfun helper Y\n return Y choose\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }, { kind: 'fresh' }]);
    expect(analyze('fun source\n return Shared\nend\nfun helper\n return source\nend').returns)
        .toEqual([{ kind: 'unknown' }]);
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
