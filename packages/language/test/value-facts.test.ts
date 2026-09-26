import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { expressionFacts, incompatibleShapes, joinValueFacts, type ValueFacts } from '../src/analysis/value-facts.js';
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
    expect(facts('array shape 2 3 fill 0')).toEqual({ types: ['array'], elements: ['integer'], rank: 2,
        shape: [2, 3], eagerScalarCells: true });
    expect(facts('array 1 2 3 4 shape 2 2')).toEqual({ types: ['array'], elements: ['integer'], rank: 2,
        shape: [2, 2], eagerScalarCells: true });
});

it('proves eager cells only for scalar array literals', () => {
    expect(facts('array true false').eagerScalarCells).toBe(true);
    expect(facts('array shape 2 2\n 1 2\n 3 4\nend').eagerScalarCells).toBe(true);
    expect(facts('array X').eagerScalarCells).toBeUndefined();
    expect(facts('array shape 2 fill 0').eagerScalarCells).toBe(true);
    expect(facts('array shape 2 fill Unknown').eagerScalarCells).toBeUndefined();
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
    expect(facts('(A I) 1 max', bindings)).toMatchObject({ rank: 0 });
    expect(facts('1 2 max', new Map([['max', { types: ['function'] }]]))).not.toMatchObject({ rank: 0 });
});

it('keeps scalar rank through unary signs and guarded numeric builtins', () => {
    const scalar: ValueFacts = { types: ['real'], rank: 0, shape: [] };
    const vector: ValueFacts = { types: ['array'], rank: 1, shape: [2], elements: ['real'] };
    expect(facts('-Z', new Map([['Z', scalar]]))).toEqual(scalar);
    expect(facts('(-Z) exp', new Map([['Z', scalar]]))).toEqual({ types: ['real'], rank: 0, shape: [] });
    expect(facts('Z 4 round', new Map([['Z', scalar]]))).toMatchObject({ rank: 0 });
    expect(facts('2 4 gcd exp')).toEqual({ types: ['real'], rank: 0, shape: [] });
    expect(facts('Z exp', new Map([['Z', vector]])).rank).toBe(1);
    expect(facts('Z exp', new Map([['Z', { ...vector, eagerScalarCells: true }]])).callbackFreeScalarCells)
        .toBe(true);
    expect(facts('Z exp', new Map([['Z', scalar], ['exp', { types: ['function'] }]])).rank)
        .toBeUndefined();
});

it('distinguishes callback-free derived masks from eager arrays', () => {
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'],
        eagerScalarCells: true };
    const bindings = new Map([['Input', input]]);
    expect(facts('Input equal 1', bindings)).toMatchObject({ types: ['array'], rank: 1,
        shape: [3], elements: ['boolean'], callbackFreeScalarCells: true });
    expect(facts('(Input equal 1) and (Input equal 0)', bindings).callbackFreeScalarCells).toBe(true);
    expect(facts('(Input equal 1) count', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Input equal 1', new Map([['Input', { ...input, eagerScalarCells: undefined }]])).callbackFreeScalarCells)
        .toBeUndefined();
});

it('keeps callback-free numeric cells through arithmetic and scalar folds', () => {
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'],
        eagerScalarCells: true };
    const bindings = new Map([['Input', input]]);
    expect(facts('Input ** 2', bindings)).toMatchObject({ types: ['array'], rank: 1,
        shape: [3], callbackFreeScalarCells: true });
    expect(facts('(Input ** 2) sum', bindings)).toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('Input max', bindings)).toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('Input all', bindings).rank).toBeUndefined();
    expect(facts('Input ** 2', new Map([['Input', { ...input, eagerScalarCells: undefined }]])).callbackFreeScalarCells)
        .toBeUndefined();
});

it('carries callback-free numeric cells through the normal-equation builtins', () => {
    const X: ValueFacts = { types: ['array'], rank: 2, shape: [3, 2], elements: ['integer'],
        eagerScalarCells: true };
    const Y: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'],
        eagerScalarCells: true };
    const Xt = facts('X transpose', new Map([['X', X]]));
    expect(Xt).toMatchObject({ types: ['array'], shape: [2, 3], callbackFreeScalarCells: true });
    const A = facts('Xt X matmul', new Map([['Xt', Xt], ['X', X]]));
    expect(A).toMatchObject({ types: ['array'], shape: [2, 2], callbackFreeScalarCells: true });
    const B = facts('Xt Y matmul', new Map([['Xt', Xt], ['Y', Y]]));
    expect(B).toMatchObject({ types: ['array'], shape: [2], callbackFreeScalarCells: true });
    const Theta = facts('A B solve', new Map([['A', A], ['B', B]]));
    expect(Theta).toMatchObject({ types: ['array'], rank: 1, shape: [2], callbackFreeScalarCells: true });
    expect(facts('Theta 4 round', new Map([['Theta', Theta]]))).toMatchObject({
        types: ['array'], rank: 1, shape: [2], callbackFreeScalarCells: true,
    });
});

it('records a numeric array shape as eager integer cells', () => {
    const input: ValueFacts = { types: ['array'], rank: 2, shape: [3, 2], elements: ['real'],
        eagerScalarCells: true };
    expect(facts('X shape', new Map([['X', input]]))).toMatchObject({
        types: ['array'], rank: 1, shape: [2], elements: ['integer'], integers: [3, 2],
        eagerScalarCells: true,
    });
});

it('keeps a unary builtin result as the left operand of a dyadic builtin', () => {
    const X: ValueFacts = { types: ['array'], rank: 2, shape: [3, 2], elements: ['integer'],
        eagerScalarCells: true };
    const Error: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['real'],
        callbackFreeScalarCells: true };
    expect(facts('X transpose Error matmul', new Map([['X', X], ['Error', Error]]))).toMatchObject({
        types: ['array'], rank: 1, shape: [2], callbackFreeScalarCells: true,
    });
    expect(facts('X transpose Error matmul', new Map([['X', X], ['Error', Error],
        ['transpose', { types: ['function'] }]]))).not.toMatchObject({
        rank: 1, callbackFreeScalarCells: true,
    });
});

it('joins eager and derived numeric readers without losing the no-callback fact', () => {
    const eager: ValueFacts = { types: ['array'], rank: 1, shape: [2], elements: ['integer'],
        eagerScalarCells: true };
    const derived: ValueFacts = { types: ['array'], rank: 1, shape: [2], elements: ['real'],
        callbackFreeScalarCells: true };
    expect(joinValueFacts([eager, derived])).toMatchObject({ types: ['array'], rank: 1,
        shape: [2], elements: ['integer', 'real'], callbackFreeScalarCells: true });
    expect(joinValueFacts([eager, { ...derived, callbackFreeScalarCells: undefined }]).callbackFreeScalarCells)
        .toBeUndefined();
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
