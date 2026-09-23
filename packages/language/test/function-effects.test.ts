import { AstUtils, EmptyFileSystem } from 'langium';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
import { functionEffects } from '../src/analysis/function-effects.js';
import { flatArrayBorrowCandidates, flatArrayBorrowProofs } from '../src/analysis/flat-array-borrow.js';
import type { ValueFacts } from '../src/analysis/value-facts.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function analyze(source: string, name = 'helper', boundNames: readonly string[] = [], inputs?: readonly ValueFacts[]) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definitions = new Map([...AstUtils.streamAllContents(parsed.value)]
        .filter(isFunctionStatement).map(node => [node.name, node]));
    return functionEffects(name => definitions.get(name), name => definitions.has(name),
        name => boundNames.includes(name))(name, inputs);
}
function borrowCandidates(source: string, name = 'helper', resolveHelpers = true) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definitions = new Map([...AstUtils.streamAllContents(parsed.value)]
        .filter(isFunctionStatement).map(node => [node.name, node]));
    return flatArrayBorrowCandidates(definitions.get(name)!, helper => resolveHelpers ? definitions.get(helper) : undefined);
}
function borrowProofs(source: string, name = 'helper', builtins: readonly ('len' | 'min' | 'max')[] = []) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definitions = new Map([...AstUtils.streamAllContents(parsed.value)]
        .filter(isFunctionStatement).map(node => [node.name, node]));
    return flatArrayBorrowProofs(definitions.get(name)!, helper => definitions.get(helper),
        builtin => builtins.includes(builtin));
}

it('distinguishes reads, parameter writes and captured object writes', () => {
    expect(analyze('fun helper X Y\n return X + Y\nend'))
        .toEqual({ unknown: false, parameters: new Set(), reboundParameters: new Set(),
            captures: new Set(), bindingCaptures: new Set(), globalWriteCaptures: new Set(),
            readParameters: new Set(), readCaptures: new Set(), globalReadCaptures: new Set(),
            valueCaptures: new Set(), globalValueCaptures: new Set(), io: false,
            returns: [{ kind: 'unknown' }] });
    expect(analyze('fun helper X Y\n X 0 = Y\n Shared 0 = 1\n return 0\nend'))
        .toEqual({ unknown: false, parameters: new Set([0]), reboundParameters: new Set(),
            captures: new Set(['Shared']), bindingCaptures: new Set(),
            globalWriteCaptures: new Set(['Shared']),
            readParameters: new Set(), readCaptures: new Set(), globalReadCaptures: new Set(),
            valueCaptures: new Set(), globalValueCaptures: new Set(), io: false,
            returns: [{ kind: 'fresh' }] });
});

it('summarizes a counted numeric reader loop only with proven call inputs', () => {
    const source = readFileSync(new URL('../../../demos/cses/sortnsrch/008_maxsubarray.ra', import.meta.url), 'utf8');
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true };
    expect(analyze(source, 'max_subarray').unknown).toBe(true);
    expect(analyze(source, 'max_subarray', [], [input])).toMatchObject({ unknown: false,
        readParameters: new Set([0]), parameters: new Set(), io: false });
    const definition = source.slice(source.indexOf('fun max_subarray'));
    expect(analyze(definition.replace('1 until N', 'Items'), 'max_subarray', [], [input]).unknown)
        .toBe(true);
    expect(analyze(definition, 'max_subarray', ['i'], [input]).unknown).toBe(false);
    expect(analyze(definition.replace('Best = Best max Current', 'if Current\n      Best = Current\n    end'),
        'max_subarray', [], [input]).unknown).toBe(false);
    expect(analyze(`fun max X Y\n Shared 0 = 1\n return X\nend\n${definition}`,
        'max_subarray', [], [input]).captures).toEqual(new Set(['Shared']));
});

it('summarizes the unchanged bracket-count demo with proven scalar input', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/017_brackets1.ra', import.meta.url), 'utf8');
    expect(analyze(source, 'bracket_count', [], [{ types: ['integer'], rank: 0, shape: [] }]))
        .toMatchObject({ unknown: false, parameters: new Set(), captures: new Set(), io: false });
    expect(analyze(source, 'bracket_count').unknown).toBe(true);
    expect(analyze(source, 'bracket_count', [], [{ types: ['array'], rank: 1, shape: [2],
        elements: ['integer'], eagerScalarCells: true }]).unknown).toBe(true);
    expect(analyze(source, 'bracket_count', ['odd'], [{ types: ['integer'], rank: 0, shape: [] }]).unknown)
        .toBe(true);
});

it('summarizes the unchanged palindrome demo with proven integer input', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/009_palnum.ra', import.meta.url), 'utf8');
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    expect(analyze(source, 'palindrome', [], [integer])).toMatchObject({ unknown: false,
        parameters: new Set(), captures: new Set(), io: false });
    expect(analyze(source, 'palindrome').unknown).toBe(true);
});

it('summarizes the unchanged reverse-integer demo with an early loop return', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/007_revint.ra', import.meta.url), 'utf8');
    expect(analyze(source, 'reverse', [], [{ types: ['integer'], rank: 0, shape: [] }]))
        .toMatchObject({ unknown: false, parameters: new Set(), captures: new Set(), io: false });
});

it('summarizes the unchanged bill-count demo with a return from a counted loop', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/beginners/010_otoshidama.ra', import.meta.url), 'utf8');
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    expect(analyze(source, 'otoshidama', [], [integer, integer])).toMatchObject({ unknown: false,
        parameters: new Set(), captures: new Set(), io: false });
});

it('summarizes the unchanged marble-count demo while iterating text', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/beginners/003_marbles.ra', import.meta.url), 'utf8');
    expect(analyze(source, 'marbles', [], [{ types: ['text'], rank: 1, shape: [3] }]))
        .toMatchObject({ unknown: false, readParameters: new Set([0]), parameters: new Set(), io: false });
    expect(analyze(source, 'marbles').unknown).toBe(true);
    expect(analyze(source, 'marbles', [], [{ types: ['array'], rank: 1, shape: [3],
        elements: ['text'], eagerScalarCells: true }]).unknown).toBe(true);
});

it('accepts only proven scalar integer compound assignments', () => {
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    expect(analyze('fun helper N\n Count = 0\n for I in 0 until N\n  Count += I\n end\n return Count\nend',
        'helper', [], [integer]).unknown).toBe(false);
    expect(analyze('fun helper X\n X += 1\n return X\nend', 'helper', [], [integer]).unknown).toBe(false);
    expect(analyze('fun helper X\n X += 1\n return X\nend', 'helper').unknown).toBe(true);
    expect(analyze('fun helper X\n X **= 2\n return X\nend', 'helper', [], [integer]).unknown).toBe(true);
    expect(analyze('fun helper X\n X += array 1 2\n return X\nend', 'helper', [], [integer]).unknown)
        .toBe(true);
});

it('records returned values inside loops without trusting aliases changed by prior iterations', () => {
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    expect(analyze('fun helper X\n for X greater 0\n  if X greater 1\n   return X\n  end\n  X = X // 10\n end\n return 0\nend',
        'helper', [], [integer]).returns).toEqual([{ kind: 'unknown' }, { kind: 'fresh' }]);
    expect(analyze('fun helper X\n for X greater 0\n  Y = X\n  return Y\n end\n return 0\nend',
        'helper', [], [integer]).returns).toEqual([{ kind: 'parameter', index: 0 }, { kind: 'fresh' }]);
});

it('does not summarize unsupported exits or callbacks inside a condition loop', () => {
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    for (const body of ['break', 'continue', 'yield X', 'Unknown external']) {
        expect(analyze(`fun helper X\n for X greater 0\n  ${body}\n end\n return X\nend`,
            'helper', [], [integer]).unknown, body).toBe(true);
    }
});

it('joins scalar facts from conditional assignments before proving builtin calls', () => {
    const source = 'fun helper N Flag\n X = N\n if Flag\n  X = array 1 2\n end\n return X odd\nend';
    expect(analyze(source, 'helper', [], [{ types: ['integer'], rank: 0, shape: [] },
        { types: ['boolean'], rank: 0, shape: [] }]).unknown).toBe(true);
    expect(analyze('fun helper N\n if N odd\n  Unknown external\n end\n return 0\nend',
        'helper', [], [{ types: ['integer'], rank: 0, shape: [] }]).unknown).toBe(true);
    expect(analyze('fun helper N\n fun replace\n  N = array 1 2\n  return 0\n end\n replace\n return N odd\nend',
        'helper', [], [{ types: ['integer'], rank: 0, shape: [] }]).unknown).toBe(true);
});

it('summarizes the unchanged AtCoder vacation loop for eager integer inputs', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/edpc/03_vacation.ra', import.meta.url), 'utf8');
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true };
    expect(analyze(source, 'best_score', [], [input, input, input])).toMatchObject({ unknown: false,
        readParameters: new Set([0, 1, 2]), parameters: new Set(), io: false });
});

it('proves non-escape in unchanged numeric reader demos only with exact builtin contracts', () => {
    const max = readFileSync(new URL('../../../demos/cses/sortnsrch/008_maxsubarray.ra', import.meta.url), 'utf8');
    const vacation = readFileSync(new URL('../../../demos/atcoder/edpc/03_vacation.ra', import.meta.url), 'utf8');
    expect(borrowProofs(max, 'max_subarray')).toEqual(new Map());
    expect(borrowProofs(max, 'max_subarray', ['len', 'max'])).toEqual(new Map([[0, new Map()]]));
    expect(borrowProofs(vacation, 'best_score', ['len', 'max']))
        .toEqual(new Map([[0, new Map([[1, 'flat-array'], [2, 'flat-array']])],
            [1, new Map([[0, 'flat-array'], [2, 'flat-array']])],
            [2, new Map([[0, 'flat-array'], [1, 'flat-array']])]]));
    expect(borrowProofs(max, 'max_subarray', ['len'])).toEqual(new Map());
    expect(borrowProofs(max, 'max_subarray', ['max'])).toEqual(new Map());
});

it('does not keep a fresh return origin after a loop can replace the local', () => {
    const source = 'fun helper X N\n Y = array 1\n for I in 0 until N\n  Y = X\n end\n return Y\nend';
    const array: ValueFacts = { types: ['array'], rank: 1, shape: [1], elements: ['integer'], eagerScalarCells: true };
    const result = analyze(source, 'helper', [], [array, { types: ['integer'], rank: 0, shape: [] }]);
    expect(result).toMatchObject({ unknown: false, returns: [{ kind: 'unknown' }] });
});

it('does not treat a throwing fallthrough as a returned value', () => {
    expect(analyze('fun helper X Flag\n if Flag\n  return X\n end\nend')).toMatchObject({
        unknown: false, returns: [{ kind: 'parameter', index: 0 }],
    });
    expect(analyze('fun helper X\n X 0 = 1\nend').unknown).toBe(true);
});

it('maps helper writes to the enclosing parameters', () => {
    expect(analyze('fun write X\n X 0 = 1\n return 0\nend\nfun helper A B\n B write\n return A\nend'))
        .toEqual({ unknown: false, parameters: new Set([1]), reboundParameters: new Set(),
            captures: new Set(), bindingCaptures: new Set(), globalWriteCaptures: new Set(),
            readParameters: new Set(), readCaptures: new Set(), globalReadCaptures: new Set(),
            valueCaptures: new Set(), globalValueCaptures: new Set(), io: false,
            returns: [{ kind: 'parameter', index: 0 }] });
});

it('maps direct nested helper captures to the enclosing parameter', () => {
    expect(analyze('fun outer X\n fun read\n  return X 0\n end\n return read\nend', 'outer'))
        .toMatchObject({ unknown: false, readParameters: new Set([0]), readCaptures: new Set() });
    expect(analyze('fun outer X\n fun change\n  X 0 = 9\n  return 0\n end\n change\n return 0\nend', 'outer'))
        .toMatchObject({ unknown: false, parameters: new Set([0]), captures: new Set() });
    expect(analyze('fun outer X\n X = Source\n fun read\n  return X 0\n end\n return read\nend', 'outer').unknown)
        .toBe(true);
    expect(analyze('fun outer X\n fun identity\n  return X\n end\n return identity\nend', 'outer').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
});

it('separates a nested parameter rebinding from an indexed write', () => {
    const source = 'fun outer X\n fun replace\n  X = array 1 2 3\n  return 0\n end\n replace\n return X\nend';
    expect(analyze(source, 'replace')).toMatchObject({ unknown: false,
        parameters: new Set(), captures: new Set(), bindingCaptures: new Set(['X']) });
    expect(analyze(source, 'outer')).toMatchObject({ unknown: false,
        parameters: new Set(), reboundParameters: new Set([0]), returns: [{ kind: 'unknown' }] });
});

it('tracks a nested replacement of a guaranteed parent local', () => {
    const source = 'fun outer X\n Y = array 1 2\n fun replace\n  Y = array 3 4 5\n  return 0\n end\n replace\n return Y\nend';
    expect(analyze(source, 'replace')).toMatchObject({ unknown: false,
        bindingCaptures: new Set(['Y']) });
    expect(analyze(source, 'outer')).toMatchObject({ unknown: false,
        bindingCaptures: new Set(), returns: [{ kind: 'unknown' }] });
    const conditional = source.replace('Y = array 1 2', 'if X\n  Y = array 1 2\n end');
    expect(analyze(conditional, 'replace').unknown).toBe(true);
    const second = 'fun outer X\n Y = array 1 2\n Z = array 3 4\n fun replace\n  Z = array 5 6 7\n  return 0\n end\n replace\n return Z\nend';
    expect(analyze(second, 'replace')).toMatchObject({ unknown: false,
        bindingCaptures: new Set(['Z']) });
    expect(analyze(second, 'outer')).toMatchObject({ unknown: false,
        returns: [{ kind: 'unknown' }] });
    expect(analyze(second.replace('Z = array 3 4', 'if X\n  Z = array 3 4\n end'), 'replace').unknown)
        .toBe(true);
    expect(analyze(second.replace('Z = array 3 4\n fun replace', 'fun replace')
        .replace('replace\n return Z', 'Z = array 3 4\n replace\n return Z'), 'replace').unknown)
        .toBe(true);
});

it('propagates a grandchild replacement of an unshadowed outer local', () => {
    const source = 'fun outer\n Z = array 1 2\n Y = array 3 4\n fun middle\n  fun replace\n   Z = array 5 6 7\n   return 0\n  end\n  replace\n  return 0\n end\n middle\n return Z\nend';
    expect(analyze(source, 'replace')).toMatchObject({ unknown: false,
        bindingCaptures: new Set(['Z']) });
    expect(analyze(source, 'middle')).toMatchObject({ unknown: false,
        bindingCaptures: new Set(['Z']) });
    expect(analyze(source, 'outer')).toMatchObject({ unknown: false,
        returns: [{ kind: 'unknown' }] });
    expect(analyze(source.replace('fun replace', 'Z = array 8 9\n  fun replace'), 'replace').unknown).toBe(true);
    expect(analyze(source.replace('fun replace', 'if true\n   Z = array 8 9\n  end\n  fun replace'), 'replace').unknown)
        .toBe(true);
    expect(analyze(source.replace('Z = array 1 2', 'if true\n  Z = array 1 2\n end'), 'replace').unknown)
        .toBe(true);
});

it('does not map effects or borrow guards through repeated parameter names', () => {
    expect(analyze('fun helper X X\n return X 0\nend').unknown).toBe(true);
    expect(borrowProofs('fun helper X X\n return X 0\nend')).toEqual(new Map());
    expect(borrowProofs('fun read X X\n return X 0\nend\nfun helper A\n return A 0 read\nend', 'helper'))
        .toEqual(new Map());
});

it('separates captured value reads and stdin from unknown effects', () => {
    expect(analyze('fun helper X\n return X + Offset\nend')).toMatchObject({
        unknown: false, valueCaptures: new Set(['Offset']), io: false,
    });
    expect(analyze('fun input\n return stdin .integer\nend\nfun helper\n return input\nend')).toMatchObject({
        unknown: false, valueCaptures: new Set(), io: true,
    });
    expect(analyze('fun helper Path\n return Path read\nend')).toMatchObject({
        unknown: false, io: true,
    });
    expect(analyze('fun file Path\n return Path read\nend\nfun helper Path\n return Path file\nend'))
        .toMatchObject({ unknown: false, io: true });
    expect(analyze('fun helper Path\n return Path read\nend', 'helper', ['read']).unknown).toBe(true);
    expect(analyze('fun read X\n return Offset + X\nend\nfun helper Offset\n return 1 read\nend'))
        .toMatchObject({ unknown: false, valueCaptures: new Set(['Offset']),
            globalValueCaptures: new Set(['Offset']) });
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
    expect(analyze('fun read X\n return Shared 0\nend\nfun helper Shared\n return 1 read\nend'))
        .toMatchObject({ unknown: false, readCaptures: new Set(['Shared']),
            globalReadCaptures: new Set(['Shared']) });
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

it('keeps writes to a private literal array local without claiming embedded arguments are fresh', () => {
    expect(analyze('fun helper\n Temp = array 1 2\n Temp 0 = 9\n return Temp\nend'))
        .toMatchObject({ unknown: false, parameters: new Set(), captures: new Set(),
            returns: [{ kind: 'fresh' }] });
    expect(analyze('fun helper Value\n Temp = array 1 2\n Temp 0 = Value\n return Temp\nend'))
        .toMatchObject({ unknown: false, parameters: new Set(), captures: new Set(),
            returns: [{ kind: 'unknown' }] });
    expect(analyze('fun helper Value\n Temp = array Value 2\n Temp 0 = 9\n return Temp\nend').unknown)
        .toBe(true);
    expect(analyze('fun helper\n Temp = array 1 2\n Temp 0 = 9\n return Temp 0\nend'))
        .toMatchObject({ unknown: false, readParameters: new Set(), readCaptures: new Set() });
    expect(analyze('fun helper Value\n Temp = array 1 2\n Temp 0 = Value\n return Temp 0\nend').unknown)
        .toBe(true);
});

it('keeps a helper write local only for a proven private array argument', () => {
    const write = 'fun write V\n V 0 = 9\n return 0\nend\n';
    expect(analyze(`${write}fun outer\n Temp = array 1 2\n Temp write\n return 0\nend`, 'outer'))
        .toMatchObject({ unknown: false, parameters: new Set(), captures: new Set(),
            returns: [{ kind: 'fresh' }] });
    expect(analyze(`${write}fun outer Source\n Temp = Source\n Temp write\n return 0\nend`, 'outer').unknown)
        .toBe(true);
    const readAfterWrite = 'fun write V\n V 0 = 9\n return V 0\nend\n';
    expect(analyze(`${readAfterWrite}fun outer\n Temp = array 1 2\n Temp write\n return 0\nend`, 'outer').unknown)
        .toBe(true);
});

it('proves a nested reader of its parent private eager array', () => {
    const direct = 'fun outer N\n Temp = array 1 2\n fun read\n  return Temp 0\n end\n return read\nend';
    expect(analyze(direct, 'outer')).toMatchObject({ unknown: false, readCaptures: new Set() });
    const chained = 'fun outer N\n Temp = array 1 2\n fun middle\n  fun read\n   return Temp 0\n  end\n  return read\n end\n return middle\nend';
    expect(analyze(chained, 'outer')).toMatchObject({ unknown: false, readCaptures: new Set() });
    expect(analyze(direct.replace('fun read', 'Temp = Source\n fun read'), 'outer').unknown).toBe(true);
    expect(analyze(direct.replace('fun read', 'Temp 0 = 9\n fun read'), 'outer').unknown).toBe(true);
    const second = direct.replace('Temp = array 1 2', 'Other = array 3 4\n Temp = array 1 2');
    expect(analyze(second, 'outer')).toMatchObject({ unknown: false, readCaptures: new Set() });
    expect(analyze(second.replace('fun read', 'Temp 0 = 9\n fun read'), 'outer').unknown).toBe(true);
});

it('proves a flat-array reader does not escape through a resolved helper', () => {
    expect(borrowCandidates('fun helper X\n return X 0\nend')).toEqual(new Set([0]));
    expect(borrowCandidates('fun helper X\n X 0\n return X 1\nend')).toEqual(new Set([0]));
    expect(borrowCandidates('fun read X\n return X 0\nend\nfun helper A\n return A read\nend'))
        .toEqual(new Set([0]));
    expect(borrowCandidates('fun helper X\n if true\n  return X 0\n else\n  return X 1\n end\nend'))
        .toEqual(new Set([0]));
    expect(borrowProofs('fun helper X Flag\n if Flag\n  return X 0\n else\n  return X 1\n end\nend'))
        .toEqual(new Map([[0, new Map([[1, 'boolean']])]]));
    expect(borrowProofs('fun branch X Flag\n if Flag\n  return X 0\n else\n  return X 1\n end\nend\n'
        + 'fun helper A Choice\n return A Choice branch\nend'))
        .toEqual(new Map([[0, new Map([[1, 'boolean']])]]));
    expect(borrowProofs('fun helper X Flag\n if Flag\n  return X\n end\n return X 0\nend'))
        .toEqual(new Map());
    expect(borrowProofs('fun helper X Flag\n if Flag\n  X 0 = 9\n end\n return X 0\nend'))
        .toEqual(new Map());
    expect(borrowProofs('fun helper X Selector\n if Selector\n  return X Selector\n end\n return X 0\nend'))
        .toEqual(new Map());
    expect(borrowProofs('fun helper X Flag\n if Flag\n  Cell = X 0\n else\n  Cell = X 1\n end\n return Cell\nend'))
        .toEqual(new Map([[0, new Map([[1, 'boolean']])]]));
    expect(borrowProofs('fun helper X Flag\n if Flag\n  Cell = X 0\n end\n return Cell\nend'))
        .toEqual(new Map());
    expect(borrowProofs('fun helper X Flag\n if Flag\n  Cell = X 0\n else\n  Cell = X\n end\n return Cell\nend'))
        .toEqual(new Map());
    expect(borrowProofs('fun helper X Flag I J\n if Flag\n  Pos = I\n else\n  Pos = J\n end\n return X Pos\nend'))
        .toEqual(new Map([[0, new Map([[1, 'boolean'], [2, 'bigint'], [3, 'bigint']])]]));
});

it('tracks integer selector guards through reader helpers', () => {
    const integer = (...indices: number[]) => new Map(indices.map(index => [index, 'bigint']));
    expect(borrowProofs('fun helper X I\n return X I\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun helper X I\n return X (I + 1)\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun helper X I J\n return X (I * 2 - J)\nend'))
        .toEqual(new Map([[0, integer(1, 2)]]));
    expect(borrowProofs('fun helper X I J\n return X (I // J)\nend'))
        .toEqual(new Map([[0, integer(1, 2)]]));
    expect(borrowProofs('fun helper X I J\n return X (I % J)\nend'))
        .toEqual(new Map([[0, integer(1, 2)]]));
    expect(borrowCandidates('fun helper X I\n return X I\nend')).toEqual(new Set());
    expect(borrowProofs('fun readat X I\n return X I\nend\nfun helper A J\n return A J readat\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun readat X I\n return X I\nend\nfun helper A J\n return A (J + 1) readat\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun readat X I\n return X I\nend\nfun helper A\n return A 0 readat\nend'))
        .toEqual(new Map([[0, integer()]]));
    expect(borrowProofs('fun helper X I\n J = I + 1\n return X J\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun helper X I\n J = (I + 1) // 1\n return X J\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun helper X I\n Cell = X I\n return Cell\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun helper X I\n Cell = X I\n return Cell + 1\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun readat X I\n return X I\nend\nfun helper A J\n Cell = A J readat\n return Cell\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun readat X I\n return X I\nend\nfun helper A J\n Cell = (A J readat) + 1\n return Cell\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun readat X I\n return X I\nend\nfun helper A J\n K = J + 1\n return A K readat\nend'))
        .toEqual(new Map([[0, integer(1)]]));
    expect(borrowProofs('fun helper X I\n X 0 = 1\n return X I\nend')).toEqual(new Map());
    expect(borrowProofs('fun helper X I\n return X\nend')).toEqual(new Map());
    for (const selector of ['I / 2', 'I + External', 'X + 1', 'I + 1.5']) {
        expect(borrowProofs(`fun helper X I\n return X (${selector})\nend`).has(0), selector).toBe(false);
    }
    for (const body of ['J = X\n return X J', 'J = I / 1\n return X J',
        'if I\n  J = I + 1\n end\n return X J', 'J = I + 1\n J = Source\n return X J']) {
        expect(borrowProofs(`fun helper X I\n ${body}\nend`).has(0), body).toBe(false);
    }
    for (const body of ['Cell = X I\n return X', 'Cell = X I\n Cell = X\n return Cell',
        'if I\n  Cell = X I\n end\n return Cell']) {
        expect(borrowProofs(`fun helper X I\n ${body}\nend`).has(0), body).toBe(false);
    }
    expect(borrowProofs('fun readat X I\n return X\nend\nfun helper A J\n Cell = A J readat\n return Cell\nend'))
        .toEqual(new Map());
});

it('borrows through a counted read-only loop, but not dynamic iteration or escape', () => {
    expect(borrowProofs('fun helper X N\n for I in 0 until N\n  X I\n end\n return X 0\nend'))
        .toEqual(new Map([[0, new Map([[1, 'bigint']])]]));
    expect(borrowProofs('fun helper X N\n Total = 0\n for I in 0 until N\n  Total += X I\n end\n return Total\nend'))
        .toEqual(new Map([[0, new Map([[1, 'bigint']])]]));
    expect(borrowProofs('fun helper X\n for I in X\n  I\n end\n return X 0\nend')).toEqual(new Map());
    expect(borrowProofs('fun helper X N\n for X in 0 until N\n  X 0\n end\n return X 0\nend')).toEqual(new Map());
    expect(borrowProofs('fun helper X N\n for I in 0 until N\n  Saved = X\n end\n return X 0\nend')).toEqual(new Map());
    expect(borrowProofs('fun helper X N\n for I in 0 until N\n  X I = 9\n end\n return X 0\nend')).toEqual(new Map());
    expect(borrowProofs('fun helper X N\n for I in 0 until N\n  return X\n end\n return X 0\nend')).toEqual(new Map());
    expect(borrowProofs('fun helper X N\n Total = 0\n for I in 0 until N\n  Total += X\n end\n return Total\nend')).toEqual(new Map());
    expect(borrowProofs('fun helper X N\n Total = 0\n for I in 0 until N\n  Total += X I\n end\n return X Total\nend')).toEqual(new Map());
});

it('keeps aliases, returns, writes and unknown calls outside the borrow proof', () => {
    for (const body of ['return X', 'Y = X\n return Y 0', 'X 0 = 1\n return X 0',
        'X\n return X 0',
        'Shared 0 = 1\n return X 0', 'return X external', 'return X helper',
        'return X * 2', 'return (X + 1) 0', 'Saved = array X\n return X 0',
        'fun escaped\n return X\nend\n return X 0', 'yield X\n return X 0']) {
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
        .toEqual([{ kind: 'parameter', index: 0 }]);
    expect(analyze('fun helper X\n return X\n return array 1 2\nend').returns)
        .toEqual([{ kind: 'parameter', index: 0 }]);
    expect(analyze('fun helper X\n X 0 = 9\n return X\nend').returns)
        .toEqual([{ kind: 'unknown' }]);
    expect(analyze('fun helper\n Shared 0 = 9\n return Shared\nend').returns)
        .toEqual([{ kind: 'unknown' }]);
    expect(analyze('fun outer X\n fun change\n  X 0 = 9\n  return 0\n end\n change\n return X\nend', 'outer').returns)
        .toEqual([{ kind: 'unknown' }]);
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

it('keeps aliases, recursion, dynamic calls and compound assignments unknown', () => {
    for (const body of ['Y = X\n Y 0 = 1', 'X = Other\n X 0 = 1', 'X helper',
        'X external', 'X += 1', 'X 0 += 1', 'X .field = 1',
        'Module.X = 1', 'for\n break\nend']) {
        expect(analyze(`fun helper X\n ${body}\n return 0\nend`).unknown, body).toBe(true);
    }
    expect(analyze('fun helper X callback\n X callback\n return 0\nend').unknown).toBe(true);
    expect(analyze('fun outer\n A = array 1 2\n fun helper\n  A = array 3 4\n  return 0\n end\n return helper\nend', 'helper'))
        .toMatchObject({ unknown: false, bindingCaptures: new Set(['A']) });
});

it('does not confuse a helper capture with an equally named caller local', () => {
    expect(analyze('fun write Y\n X 0 = Y\n return 0\nend\nfun helper X\n 0 write\n return X\nend'))
        .toMatchObject({ unknown: false, captures: new Set(['X']), globalWriteCaptures: new Set(['X']) });
    expect(analyze('fun parent X\n fun write Y\n  X 0 = Y\n  return 0\n end\n return 0\nend\n'
        + 'fun helper X\n 0 write\n return X\nend').unknown).toBe(true);
    expect(analyze('fun parent Shared\n fun read\n  return Shared 0\n end\n return read\nend\n'
        + 'fun helper Shared\n return read\nend').unknown).toBe(true);
});

it('does not reuse a helper summary across a local redefinition', () => {
    const source = 'fun outer A\n fun reader X\n  X 0 = 9\n  return 0\n end\n A reader\n fun reader X\n  return X 0\n end\n return 0\nend';
    expect(analyze(source, 'outer').unknown).toBe(true);
});
