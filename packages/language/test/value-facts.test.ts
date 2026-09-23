import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { expressionFacts, incompatibleShapes, type ValueFacts } from '../src/analysis/value-facts.js';
import { typeOf } from '../src/analysis/types.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });

function facts(source: string, bindings = new Map<string, ValueFacts>()): ValueFacts {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(`A = ${source}\n`);
    expect(parsed.parserErrors).toEqual([]);
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    return expressionFacts(statement.value, name => bindings.get(name));
}

it('separates scalar type, array elements, rank and dimensions', () => {
    expect(facts('42')).toEqual({ types: ['integer'], rank: 0, shape: [], integer: '42' });
    expect(facts('array 1 2 3')).toEqual({ types: ['array'], elements: ['integer'], rank: 1, shape: [3],
        integers: [1, 2, 3], eagerScalarCells: true });
    expect(facts('array shape 2 3 fill 0')).toEqual({ types: ['array'], elements: ['integer'], rank: 2, shape: [2, 3] });
    expect(facts('array 1 2 3 4 shape 2 2')).toEqual({ types: ['array'], elements: ['integer'], rank: 2, shape: [2, 2] });
});

it('proves eager cells only for scalar array literals', () => {
    expect(facts('array true false').eagerScalarCells).toBe(true);
    expect(facts('array X').eagerScalarCells).toBeUndefined();
    expect(facts('array shape 2 fill 0').eagerScalarCells).toBeUndefined();
    expect(facts('(1 to 3) array').eagerScalarCells).toBeUndefined();
});

it('retains rank when a dimension is unknown', () => {
    expect(facts('array shape N 3 fill 0').shape).toEqual([null, 3]);
    expect(facts('array shape N 3 fill 0').rank).toBe(2);
    expect(facts('Unknown')).toEqual({ types: [] });
});

it('uses supplied facts without evaluating bindings', () => {
    expect(facts('array shape N fill 0', new Map([['N', {
        types: ['integer'], rank: 0, shape: [], integer: '5',
    }]])).shape).toEqual([5]);
});

it('keeps proven numeric builtins and arithmetic scalar', () => {
    const bindings = new Map<string, ValueFacts>([['A', {
        types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true,
    }], ['I', { types: ['integer'], rank: 0, shape: [] }]]);
    expect(facts('A len', bindings)).toMatchObject({ types: ['integer'], rank: 0 });
    expect(facts('A I', bindings)).toMatchObject({ types: ['integer'], rank: 0 });
    expect(facts('(A I) + 1', bindings)).toMatchObject({ rank: 0 });
    expect(facts('(A I) max 1', bindings)).toMatchObject({ rank: 0 });
    expect(facts('1 max 2', new Map([['max', { types: ['function'] }]]))).not.toMatchObject({ rank: 0 });
});

it('keeps collection kinds through mapped numeric operations and ranked modifiers', () => {
    const bindings = new Map<string, ValueFacts>([
        ['M', { types: ['array'], rank: 2, shape: [3, 2], elements: ['integer'] }],
        ['V', { types: ['array'], rank: 1, shape: [3], elements: ['integer'] }],
        ['W', { types: ['array'], rank: 1, shape: [3], elements: ['integer'] }],
    ]);
    expect(facts('M sum axis 1', bindings)).toMatchObject({ types: ['array'], rank: 1, shape: [3] });
    expect(facts('V W + outer', bindings)).toMatchObject({ types: ['array'], rank: 2, shape: [3, 3] });
    expect(facts('(M 0 max) sqrt', bindings).types).toEqual(['array']);
    expect(facts('M round 2', bindings).types).toEqual(['array']);
    expect(facts('-M', bindings).types).toEqual(['array']);
    expect(facts('V W matmul', bindings)).toMatchObject({ types: ['integer'], rank: 0 });
    const parsed = services.Rank.parser.LangiumParser.parse<Program>('A = M sqrt\n');
    const statement = parsed.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    expect(typeOf(statement.value, name => bindings.get(name)?.types)).toEqual(['array']);
});

it('does not mistake a plain lookup function for a call resolver', () => {
    expect(facts('1 helper', new Map([['helper', { types: ['function'] }]]))).toEqual({ types: [] });
});

it('propagates finite range lengths through materialization', () => {
    expect(facts('(1 to 5) array')).toEqual({ types: ['array'], elements: ['integer'], rank: 1, shape: [5] });
    expect(facts('(1 until 5) array').shape).toEqual([4]);
    expect(facts('(1 to 9 by 2) array').shape).toEqual([5]);
    expect(facts('(9 until 1 by -2) array').shape).toEqual([4]);
    expect(facts('(5 to 1) array').shape).toEqual([0]);
});

it('only proves incompatible known non-singleton axes', () => {
    const shape = (...dimensions: (number | null)[]): ValueFacts => ({ types: ['array'], shape: dimensions });
    expect(incompatibleShapes(shape(2, 3), shape(2, 4))).toBe(true);
    expect(incompatibleShapes(shape(2, 3), shape(3))).toBe(false);
    expect(incompatibleShapes(shape(2, 3), shape(2, 1))).toBe(false);
    expect(incompatibleShapes(shape(2, null), shape(2, 4))).toBe(false);
});

it('propagates reshape and scalar addressing', () => {
    expect(facts('(1 to 6) (array 2 3) reshape').shape).toEqual([2, 3]);
    const bindings = new Map<string, ValueFacts>([['M', {
        types: ['array'], elements: ['integer'], rank: 2, shape: [2, 3],
    }]]);
    expect(facts('M # 0', bindings).shape).toEqual([2]);
    expect(facts('M 0 0', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
});

it('keeps text rank separate from its role as an array element', () => {
    expect(facts('"a😀"')).toEqual({ types: ['text'], rank: 1, shape: [2] });
    expect(facts('array "a" "long"').shape).toEqual([2]);
    expect(facts('array -2 3').integers).toEqual([-2, 3]);
});

it('infers finite windows including an empty frame', () => {
    expect(facts('(1 to 5) 3 window').shape).toEqual([3, 3]);
    expect(facts('(1 to 5) 7 window').shape).toEqual([0, 7]);
    expect(facts('"abcd" 2 window')).toEqual({ types: ['sequence'], elements: ['text'], rank: 1, shape: [3] });
});
