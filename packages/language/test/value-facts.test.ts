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

it('keeps only shared exact boolean facts across paths', () => {
    expect(facts('true')).toEqual({ types: ['boolean'], rank: 0, shape: [], boolean: true });
    expect(facts('not false')).toEqual({ types: ['boolean'], rank: 0, shape: [], boolean: true });
    const yes = facts('true');
    const no = facts('false');
    expect(joinValueFacts([yes, yes]).boolean).toBe(true);
    expect(joinValueFacts([yes, no]).boolean).toBeUndefined();
});

it('uses proven indexed scalar facts for comparisons and boolean combinations', () => {
    const bindings = new Map<string, ValueFacts>([['Values', {
        types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true,
    }], ['Index', { types: ['integer'], rank: 0, shape: [] }]]);
    expect(facts('Values Index less 3', bindings)).toMatchObject({ types: ['boolean'], rank: 0 });
    expect(facts('(Values Index less 3) and (Values Index equal 1)', bindings))
        .toMatchObject({ types: ['boolean'], rank: 0 });
    expect(facts('Values Index less 3', new Map([['Index', bindings.get('Index')!]])))
        .toEqual({ types: [] });
});

it('infers the stable outer shape of flat XML and JSON documents', () => {
    expect(facts('"<root/>" xml')).toEqual({ types: ['object'] });
    for (const document of ['"<root/>" xml .flat', '"{}" json .flat']) {
        expect(facts(document)).toEqual({ types: ['array'], rank: 1, shape: [null], elements: ['object'] });
    }
    expect(facts('"<root/>" xml .flat', new Map([['xml', { types: ['function'] }]])))
        .toEqual({ types: [] });
});

it('infers outer facts from literal JSON without assuming external schemas', () => {
    expect(facts('"[{\\"x\\":1},{\\"x\\":2}]" json')).toEqual({
        types: ['array'], rank: 1, shape: [2], elements: ['object'],
    });
    expect(facts('"[1, true, null]" json')).toEqual({
        types: ['array'], rank: 1, shape: [3], elements: ['integer', 'real', 'boolean', 'symbol'],
        eagerScalarCells: true,
    });
    expect(facts('"{\\"x\\":1}" json')).toEqual({ types: ['object'] });
    expect(facts('"[1, 2]" json', new Map([['json', { types: ['function'] }]]))).toEqual({ types: [] });
    expect(facts('"not JSON" json')).toEqual({ types: [] });
    expect(facts('Input json', new Map([['Input', { types: ['text'], rank: 1, shape: [null] }]])))
        .toEqual({ types: [] });
});

it('keeps the row and column axes when selecting named table fields', () => {
    const rows = facts('"[{\\"a\\":1,\\"b\\":2},{\\"a\\":3,\\"b\\":4}]" json');
    const bindings = new Map<string, ValueFacts>([['Rows', rows]]);
    expect(facts('array .a .b')).toEqual({ types: ['array'], rank: 1, shape: [2],
        elements: ['symbol'], eagerScalarCells: true });
    expect(facts('Rows (array .a .b)', bindings)).toEqual({
        types: ['array'], rank: 2, shape: [2, 2],
    });
    expect(facts('Rows (array 0 1)', bindings)).toMatchObject({ types: ['array'], rank: 1 });
    expect(facts('Rows Keys', new Map([...bindings, ['Keys', { types: ['array'], rank: 1,
        shape: [null], elements: ['symbol'], eagerScalarCells: true }]]))).not.toMatchObject({ rank: 2 });
});

it('keeps the outer rank but not row facts across a table filter', () => {
    const rows = facts('"[{\\"name\\":\\"x\\"},{\\"name\\":\\"y\\"}]" json');
    expect(facts('Rows filter .name equal "x"', new Map([['Rows', rows]]))).toEqual({
        types: ['array'], rank: 1, shape: [null],
    });
});

it('infers the integer length of a known array axis', () => {
    const bindings = new Map<string, ValueFacts>([['Matrix', {
        types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'], eagerScalarCells: true,
    }]]);
    expect(facts('Matrix len axis 1', bindings)).toEqual({ types: ['integer'], rank: 0,
        shape: [], integer: '3' });
    expect(facts('Matrix len axis 2', bindings)).toEqual({ types: [] });
});

it('infers numeric statistic cells after reducing known array axes', () => {
    const matrix = facts('array shape 2 3 fill 2');
    const bindings = new Map<string, ValueFacts>([['Matrix', matrix]]);
    for (const operation of ['mean', 'std', 'median', 'variance', 'var', 'skewness', 'skew']) {
        expect(facts(`Matrix ${operation} axis 0`, bindings)).toEqual({
            types: ['array'], rank: 1, shape: [3], elements: ['real'], callbackFreeScalarCells: true,
        });
    }
    expect(facts('Matrix mean axis 0 1', bindings)).toEqual({ types: ['real'], rank: 0, shape: [] });
    expect(facts('Matrix mean axis 0', new Map([['Matrix', {
        types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'],
    }]]))).toEqual({ types: [] });
    expect(facts('Matrix mean axis 0', new Map([...bindings, ['mean', { types: ['function'] }]])))
        .toEqual({ types: [] });
});

it('infers covariance and correlation matrix shapes from feature axes', () => {
    const matrix = facts('array shape 2 3 fill 2');
    const bindings = new Map<string, ValueFacts>([['Matrix', matrix]]);
    for (const operation of ['covariance', 'correlation', 'corr']) {
        expect(facts(`Matrix ${operation} axis 1 0`, bindings)).toEqual({
            types: ['array'], rank: 2, shape: [3, 3], elements: ['real'], callbackFreeScalarCells: true,
        });
    }
    expect(facts('Matrix covariance', bindings)).toEqual({
        types: ['array'], rank: 2, shape: [2, 2], elements: ['real'], callbackFreeScalarCells: true,
    });
    const tensor = facts('array shape 2 2 3 fill 1');
    expect(facts('Tensor covariance axis 0 2', new Map([['Tensor', tensor]]))).toEqual({
        types: ['array'], rank: 3, shape: [2, 2, 2], elements: ['real'], callbackFreeScalarCells: true,
    });
    expect(facts('Matrix covariance axis 1 1', bindings)).toEqual({ types: [] });
});

it('keeps distinct array ranks in the two eager results of eigh', () => {
    const matrix = facts('array shape 2 2 fill 1.0');
    expect(facts('Matrix eigh', new Map([['Matrix', matrix]]))).toEqual({
        types: ['array'], rank: 1, shape: [2], elements: ['array'], eagerScalarCells: true,
        positionFacts: [
            { types: ['array'], rank: 1, shape: [2], elements: ['real'], eagerScalarCells: true },
            { types: ['array'], rank: 2, shape: [2, 2], elements: ['real'], eagerScalarCells: true },
        ],
    });
});

it('gives finite collection lengths scalar rank', () => {
    expect(facts('"abc" len')).toEqual({ types: ['integer'], rank: 0, shape: [], integer: '3' });
    const bindings = new Map<string, ValueFacts>([['Items', { types: ['queue'], elements: ['integer'] }]]);
    expect(facts('Items len', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Values len', new Map([['Values', facts('array shape 2 3 fill 0')]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [], integer: '2' });
    expect(facts('Values len', new Map([['Values', { types: ['array'], rank: 1, shape: [null] }]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(1 to 5) len')).toEqual({ types: ['integer'], rank: 0, shape: [], integer: '5' });
    expect(facts('Values len', new Map([['Values', { types: ['sequence'], rank: 1, shape: [5] }]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
});

it('keeps known record field facts and builtin record contracts', () => {
    expect(facts('(record\n  .count = 3\n  .name = "a"\nend) .count'))
        .toMatchObject({ types: ['integer'], rank: 0 });
    expect(facts('(record\n  .items = array 1 2\nend) .items')).toEqual({ types: ['array'] });
    expect(facts('((record\n  .count = 3\nend) with\n  .count += 2\nend) .count'))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(record\n  .count = 3\nend) .missing')).toEqual({ types: [] });
    const bindings = new Map<string, ValueFacts>([['Graph', { types: ['graph'] }]]);
    expect(facts('(Graph 1 2 maxflow) .value', bindings)).toEqual({
        types: ['integer', 'real'], rank: 0, shape: [],
    });
    expect(facts('(Graph topological) .possible', bindings)).toEqual({
        types: ['boolean'], rank: 0, shape: [],
    });
    expect(facts('(Graph scc) .count', bindings)).toEqual({
        types: ['integer'], rank: 0, shape: [],
    });
    expect(facts('(Graph mst) .weight', bindings)).toEqual({
        types: ['integer', 'real'], rank: 0, shape: [],
    });
});

it('keeps closed graph vertex types through neighbor lookup', () => {
    const graph = facts('new graph (1 to 4) .directed');
    expect(graph).toMatchObject({ types: ['graph'], elements: ['integer'] });
    expect(facts('Graph 1', new Map([['Graph', graph]]))).toEqual({
        types: ['sequence'], rank: 1, shape: [null], elements: ['integer'], callbackFreeScalarCells: true,
    });
    expect(facts('new graph .directed')).toEqual({ types: ['graph'] });
    expect(facts('(Graph topological) .order', new Map([['Graph', graph]]))).toEqual({
        types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true,
    });
    const sorted = facts('Graph topological', new Map([['Graph', graph]]));
    expect(facts('Sorted .order 0', new Map([['Sorted', sorted]]))).toEqual({
        types: ['integer'], rank: 0, shape: [],
    });
    expect(facts('Sorted .order len', new Map([['Sorted', sorted]]))).toEqual({
        types: ['integer'], rank: 0, shape: [],
    });
    expect(facts('(Graph 1 bfs) .distance 1', new Map([['Graph', graph]]))).toEqual({
        types: ['integer'], rank: 0, shape: [],
    });
    expect(facts('(Graph 1 bfs) .parent 2', new Map([['Graph', graph]]))).toEqual({
        types: ['integer'], rank: 0, shape: [],
    });
    expect(facts('(Graph 1 root) .order', new Map([['Graph', graph]]))).toEqual({
        types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true,
    });
    expect(facts('(Graph 1 root) .parent 2', new Map([['Graph', graph]]))).toEqual({
        types: ['integer'], rank: 0, shape: [],
    });
    expect(facts('(Graph 1 root) .size 2', new Map([['Graph', graph]]))).toEqual({
        types: ['integer'], rank: 0, shape: [],
    });
    const rooted = facts('Graph 1 root', new Map([['Graph', graph]]));
    expect(rooted.elements).toEqual(['integer']);
    expect(facts('Rooted 2 3 lca', new Map([['Rooted', rooted]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Rooted 3 1 ancestor', new Map([['Rooted', rooted]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Rooted 2 3 lca', new Map([['Rooted', { types: ['record'] }]])))
        .toEqual({ types: [] });
    expect(facts('((Graph topological) with\n  .order = array "x"\nend) .order',
        new Map([['Graph', graph]]))).toEqual({ types: ['array'] });
});

it('distinguishes dsu components from graph components and tracks closed dsu values', () => {
    const dsu = facts('new dsu (1 to 4)');
    expect(dsu).toEqual({ types: ['dsu'], elements: ['integer'] });
    const bindings = new Map<string, ValueFacts>([['Union', dsu]]);
    expect(facts('Union components', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Union find 2', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('new dsu components')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    const words = facts('new dsu (array "a" "b")');
    expect(facts('Words find "a"', new Map([['Words', words]])))
        .toEqual({ types: ['text'], rank: 1, shape: [null] });
    const mixed = facts('new dsu (array 1 "x")');
    expect(facts('Mixed find 1', new Map([['Mixed', mixed]])))
        .toEqual({ types: ['integer', 'text'] });
    expect(facts('Union find 2', new Map([['Union', { types: ['dsu'] }]])))
        .toEqual({ types: [] });
});

it('distinguishes weighted and unweighted functional graph results', () => {
    const plain = facts('(array 2 2) functional');
    const weighted = facts('(array 2 2) (array 3 4) weighted');
    expect(plain).toEqual({ types: ['functional'], functionalWeighted: false });
    expect(weighted).toEqual({ types: ['functional'], functionalWeighted: true });
    expect(facts('Path 1 2 upto', new Map([['Path', plain]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Path 1 2 upto', new Map([['Path', weighted]]))).toMatchObject({
        types: ['record'], fields: { count: { types: ['integer'] },
            sum: { types: ['integer', 'real'] }, last: { types: ['integer'] } },
    });
    expect(facts('Path 1 2 upto', new Map([['Path', { types: ['functional'] }]])))
        .toEqual({ types: [] });
    expect(joinValueFacts([plain, weighted])).toEqual({ types: ['functional'] });
    expect(joinValueFacts([plain, plain])).toEqual(plain);
    expect(facts('Path 1 2 jump', new Map([['Path', plain]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Path lengths', new Map([['Path', plain]]))).toEqual({
        types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true,
    });
});

it('tracks the kind, cells and leading dimension of take and drop', () => {
    expect(facts('(array 1 2 3) 1 drop')).toEqual({ types: ['array'], rank: 1,
        shape: [2], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array shape 2 3 fill 0) 1 take')).toEqual({ types: ['array'], rank: 2,
        shape: [1, 3], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(1 to 5) 2 take')).toEqual({ types: ['sequence'], rank: 1,
        shape: [2], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('"abcd" 2 drop')).toEqual({ types: ['text'], rank: 1, shape: [2] });
    expect(facts('Lazy 1 drop', new Map([['Lazy', { types: ['array'], rank: 1,
        shape: [3], elements: ['integer'] }]]))).toEqual({
        types: ['array'], rank: 1, shape: [2], elements: ['integer'],
    });
    expect(facts('(array 1 2) 1.5 take')).toEqual({ types: [] });
});

it('infers numeric scans without treating unsafe cell readers as callback-free', () => {
    expect(facts('(array 1 2 3) + scan with 0')).toEqual({ types: ['array'], rank: 1,
        shape: [4], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(1 to 3) * scan with 1')).toEqual({ types: ['sequence'], rank: 1,
        shape: [4], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2 3) + scan')).toEqual({ types: ['array'], rank: 1,
        shape: [3], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2) + scan with 0.5')).toEqual({ types: ['array'], rank: 1,
        shape: [3], elements: ['integer', 'real'], callbackFreeScalarCells: true });
    expect(facts('Unsafe + scan with 0', new Map([['Unsafe', { types: ['array'], rank: 1,
        shape: [3], elements: ['integer'] }]]))).toEqual({ types: [] });
});

it('keeps numeric cells through callback-free sequence arithmetic', () => {
    const codes: ValueFacts = { types: ['sequence'], rank: 1, shape: [4],
        elements: ['integer'], callbackFreeScalarCells: true };
    const bindings = new Map<string, ValueFacts>([['Codes', codes]]);
    expect(facts('46 - Codes', bindings)).toEqual({ types: ['sequence'], rank: 1, shape: [4],
        elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(46 - Codes) // 4', bindings)).toEqual({ types: ['sequence'], rank: 1, shape: [4],
        elements: ['integer'], callbackFreeScalarCells: true });
    bindings.set('Codes', { ...codes, callbackFreeScalarCells: undefined });
    expect(facts('46 - Codes', bindings).callbackFreeScalarCells).toBeUndefined();
});

it('keeps numeric result types for mixed integer-real division and remainder', () => {
    const bindings = new Map<string, ValueFacts>([['Total', {
        types: ['integer', 'real'], rank: 0, shape: [],
    }]]);
    expect(facts('Total % 10', bindings)).toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('Total // 10', bindings)).toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('3.5 % 2')).toEqual({ types: ['real'], rank: 0, shape: [] });
    expect(facts('7 % 2')).toMatchObject({ types: ['integer'], rank: 0 });
});

it('types safe integer-vector selection and sequence slicing', () => {
    const matrix: ValueFacts = { types: ['array'], rank: 2, shape: [3, 4],
        elements: ['integer'], eagerScalarCells: true };
    const indices: ValueFacts = { types: ['sequence'], rank: 1, shape: [2],
        elements: ['integer'], callbackFreeScalarCells: true };
    const bindings = new Map<string, ValueFacts>([['A', matrix], ['I', indices]]);
    expect(facts('A 0 I', bindings)).toEqual({ types: ['array'], rank: 1, shape: [2],
        elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('A I', bindings)).toEqual({ types: ['array'], rank: 2, shape: [2, 4],
        elements: ['integer'], callbackFreeScalarCells: true });
    bindings.set('I', { ...indices, callbackFreeScalarCells: undefined });
    expect(facts('A 0 I', bindings).elements).toBeUndefined();
    expect(facts('(1 to 4) from 1 to 2')).toEqual({ types: ['array'], rank: 1,
        shape: [2], elements: ['integer'], callbackFreeScalarCells: true });
});

it('retains declared stdin cell types after materialization', () => {
    expect(facts('stdin .integer 3 array')).toEqual({ types: ['array'], rank: 1,
        shape: [3], elements: ['integer'], eagerScalarCells: true });
    expect(facts('stdin .word N array', new Map([['N', { types: ['integer'], rank: 0, shape: [] }]])))
        .toEqual({ types: ['array'], rank: 1, shape: [null], elements: ['text'], eagerScalarCells: true });
    expect(facts('stdin .integer 3')).toEqual({ types: ['sequence'], rank: 1,
        shape: [3], elements: ['integer'] });
});

it('tracks callback-free membership masks and short-circuit selectors', () => {
    const values: ValueFacts = { types: ['array'], rank: 1, shape: [4], elements: ['integer'],
        eagerScalarCells: true };
    const bindings = new Map<string, ValueFacts>([['Values', values]]);
    const mask = facts('Values in (array 2 4)', bindings);
    expect(mask).toEqual({ types: ['array'], rank: 1, shape: [4], elements: ['boolean'],
        callbackFreeScalarCells: true });
    bindings.set('Mask', mask);
    expect(facts('Values first where Mask', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Values first index where Mask', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Values take while Mask', bindings)).toEqual({ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('Q take while Mask', new Map([...bindings, ['Q', { types: ['queue'] }]])))
        .toEqual({ types: ['array'], rank: 1, shape: [null] });
    expect(facts('Values first where Unsafe', new Map([...bindings, ['Unsafe', { types: [] }]])))
        .toEqual({ types: [] });
    expect(facts('"abcd" permutations')).toEqual({ types: ['sequence'], rank: 1, shape: [null],
        elements: ['text'], callbackFreeScalarCells: true });
    expect(facts('Mask indices', bindings)).toEqual({ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], eagerScalarCells: true });
    expect(facts('Unsafe indices', new Map([...bindings, ['Unsafe', { types: ['array'], rank: 1,
        shape: [null], elements: ['boolean'] }]]))).toEqual({ types: ['array'] });
    expect(facts('"ababa" "a" findall')).toEqual({ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], eagerScalarCells: true });
    expect(facts('Values 2 findall', bindings)).toEqual({ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], eagerScalarCells: true });
    expect(facts('Unsafe 2 findall', new Map([...bindings, ['Unsafe', { types: ['array'], rank: 1,
        shape: [null], elements: ['integer'] }]]))).toEqual({ types: ['array'] });
    for (const [source, expected] of [
        ['Values first index where Mask', 'integer'], ['Values take while Mask', 'array'],
    ]) {
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(`A = ${source}\n`);
        const statement = parsed.value.statements[0];
        if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
        expect(typeOf(statement.value, name => bindings.get(name)?.types)).toEqual([expected]);
    }
});

it('types Fenwick construction, indexed reads and inclusive prefix sums', () => {
    expect(facts('5 fenwick')).toEqual({ types: ['fenwick'] });
    const tree: ValueFacts = { types: ['fenwick'] };
    expect(facts('F 2', new Map([['F', tree]]))).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('F sum 2', new Map([['F', tree]]))).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('F sum 2', new Map([['F', tree], ['sum', { types: ['function'] }]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
});

it('keeps numeric payloads only for known built-in segment combines', () => {
    for (const [source, operation] of [['(array 1 2) + segment', '+'],
        ['(array 1 2) min segment', 'min'], ['(array 1 2) max segment', 'max']]) {
        const tree = facts(source);
        expect(tree).toEqual({ types: ['segment'], elements: ['integer'], segmentOperation: operation });
        expect(facts('Tree 0 1 query', new Map([['Tree', tree]])))
            .toEqual({ types: ['integer'], rank: 0, shape: [] });
        expect(facts('Tree 0', new Map([['Tree', tree]])))
            .toEqual({ types: ['integer'], rank: 0, shape: [] });
    }
    const tree: ValueFacts = { types: ['segment'] };
    expect(facts('Tree 0 0 query', new Map([['Tree', tree]]))).toEqual({ types: [] });
});

it('infers the built-in maxsum segment profile without assuming a shadowed combine', () => {
    const tree = facts('(array 1 2) maxsum segment');
    expect(tree).toEqual({ types: ['segment'], elements: ['integer'], segmentOperation: 'maxsum' });
    const bindings = new Map([['Tree', tree]]);
    expect(facts('Tree 0', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Tree 0 1 query', bindings)).toEqual({ types: ['record'], fields: {
        sum: { types: ['integer'], rank: 0, shape: [] },
        prefix: { types: ['integer'], rank: 0, shape: [] },
        suffix: { types: ['integer'], rank: 0, shape: [] },
        best: { types: ['integer'], rank: 0, shape: [] },
    } });
    const mixed = facts('(array 1 2.5) maxsum segment');
    expect(facts('Tree 0 1 query', new Map([['Tree', mixed]]))?.fields?.best?.types)
        .toEqual(['integer', 'real']);
    expect(facts('Values maxsum segment', new Map([['Values', {
        types: ['array'], rank: 1, shape: [null], elements: ['integer'],
    }]]))).not.toHaveProperty('segmentOperation');
    expect(facts('(array 1 2) maxsum segment', new Map([['maxsum', { types: ['function'] }]])))
        .not.toHaveProperty('segmentOperation');
});

it('infers integer bitwise segment combines only for built-in operations', () => {
    for (const operation of ['band', 'bor', 'bxor']) {
        const tree = facts(`(array 7 3) ${operation} segment`);
        expect(tree).toEqual({ types: ['segment'], elements: ['integer'], segmentOperation: operation });
        expect(facts('Tree 0 1 query', new Map([['Tree', tree]])))
            .toEqual({ types: ['integer'], rank: 0, shape: [] });
        expect(facts(`(array 1.5 2.5) ${operation} segment`)).not.toHaveProperty('segmentOperation');
        expect(facts(`(array 7 3) ${operation} segment`, new Map([[operation, { types: ['function'] }]])))
            .not.toHaveProperty('segmentOperation');
    }
});

it('starts each explicit index with a known empty value set', () => {
    expect(facts('new index')).toEqual({ types: ['index'], elements: [] });
});

it('keeps integer cells through integer-only array arithmetic', () => {
    expect(facts('(array 1 2) - 1')).toMatchObject({ types: ['array'], elements: ['integer'],
        callbackFreeScalarCells: true });
    expect(facts('(array 1 2) + (array 3 4)')).toMatchObject({ types: ['array'], elements: ['integer'] });
    expect(facts('(array 1 2) / 2')).toMatchObject({ types: ['array'], elements: ['integer', 'real'] });
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    const bindings = new Map<string, ValueFacts>([['A', { types: ['array'], rank: 1,
        shape: [null], elements: ['integer'], eagerScalarCells: true }], ['I', integer]]);
    expect(facts('(A I) % 7', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(A I) // 7', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('A % 7', bindings)).toMatchObject({ types: ['array'], elements: ['integer'] });
});

it('keeps scalar rank through boolean comparisons and negation', () => {
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    const bindings = new Map([['N', integer]]);
    expect(facts('N multiple by 4', bindings)).toEqual({ types: ['boolean'], rank: 0, shape: [] });
    expect(facts('not N equal 4', bindings)).toEqual({ types: ['boolean'], rank: 0, shape: [] });
    expect(facts('N less 4 or N greater 8', bindings)).toEqual({ types: ['boolean'], rank: 0, shape: [] });
    expect(facts('N equal 4', new Map([['N', { types: [] }]])).rank).toBeUndefined();
    expect(facts('(array 1 2) equal 1')).toMatchObject({ types: ['array'], rank: 1,
        elements: ['boolean'] });
});

it('infers numeric full reductions only from callback-free scalar cells', () => {
    expect(facts('(1 to 4) * reduce')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(array 1 2 3) + reduce')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(array 1.5 2.5) + reduce')).toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('Lazy + reduce', new Map([['Lazy', { types: ['sequence'], rank: 1,
        shape: [null], elements: ['integer'] }]]))).toEqual({ types: [] });
});

it('tracks scalar conversions explicitly mapped over collection cells', () => {
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    expect(facts('N text', new Map([['N', integer]]))).toEqual({ types: ['text'], rank: 1,
        shape: [null] });
    expect(facts('N text integer rank 0', new Map([['N', integer]]))).toMatchObject({
        types: ['sequence'], elements: ['integer'], rank: 1, callbackFreeScalarCells: true,
    });
    expect(facts('(array 1.2 2.3) integer rank 0')).toMatchObject({ types: ['array'],
        elements: ['integer'], rank: 1, shape: [2], callbackFreeScalarCells: true });
    expect(facts('Lazy integer rank 0', new Map([['Lazy', { types: ['sequence'],
        elements: ['real'], rank: 1, shape: [null] }]]))).toEqual({ types: [] });
});

it('tracks fixed-decimal text formatting for proven numeric values', () => {
    const scalar: ValueFacts = { types: ['real'], rank: 0, shape: [] };
    expect(facts('N text ".6f"', new Map([['N', scalar]]))).toEqual({ types: ['text'],
        rank: 1, shape: [null] });
    expect(facts('(array 1 2) text ".2f"')).toMatchObject({ types: ['array'],
        rank: 1, shape: [2], elements: ['text'], eagerScalarCells: true });
    expect(facts('Unknown text ".6f"')).toEqual({ types: [] });
});

it('tracks callback-free integer factor sequences and distinct values', () => {
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    const bindings = new Map([['N', integer]]);
    for (const operation of ['factors', 'divisors']) {
        expect(facts(`N ${operation}`, bindings)).toEqual({ types: ['sequence'],
            elements: ['integer'], rank: 1, shape: [null], callbackFreeScalarCells: true });
    }
    expect(facts('N factors unique', bindings)).toEqual({ types: ['sequence'],
        elements: ['integer'], rank: 1, shape: [null], callbackFreeScalarCells: true });
    expect(facts('Unknown factors')).toEqual({ types: ['sequence'] });
});

it('keeps the shape and scalar cells of a dense array copy', () => {
    const source: ValueFacts = { types: ['array'], rank: 2, shape: [2, 3],
        elements: ['integer'], callbackFreeScalarCells: true };
    expect(facts('M copy', new Map([['M', source]]))).toEqual({ types: ['array'],
        rank: 2, shape: [2, 3], elements: ['integer'], eagerScalarCells: true });
    expect(facts('M copy', new Map([['M', { ...source, callbackFreeScalarCells: undefined }]])))
        .toEqual({ types: ['array'] });
});

it('materializes proven scalar cells when reshaping an array or sequence', () => {
    const source: ValueFacts = { types: ['array'], rank: 1, shape: [4],
        elements: ['integer'], eagerScalarCells: true };
    expect(facts('Values (array 2 2) reshape', new Map([['Values', source]])))
        .toEqual({ types: ['array'], rank: 2, shape: [2, 2], elements: ['integer'], eagerScalarCells: true });
    expect(facts('Values (array 2 2) reshape', new Map([['Values', {
        ...source, eagerScalarCells: undefined,
    }]]))).toEqual({ types: ['array'], rank: 2, shape: [2, 2], elements: ['integer'] });
    expect(facts('(1 to 4) (array 2 2) reshape')).toEqual({ types: ['array'], rank: 2, shape: [2, 2],
        elements: ['integer'], eagerScalarCells: true });
});

it('keeps integer sums of proven scalar cells exact', () => {
    expect(facts('(array 1 2 3) sum')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(1 to 3) sum')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(array 1 2.5) sum')).toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    for (const type of ['queue', 'stack', 'deque', 'set']) {
        expect(facts('Items sum', new Map([['Items', { types: [type], elements: ['integer'] }]])))
            .toEqual({ types: ['integer'], rank: 0, shape: [] });
    }
    expect(facts('Items sum', new Map([['Items', { types: ['queue'], elements: ['integer', 'real'] }]])))
        .toEqual({ types: ['integer', 'real'] });
    expect(facts('Items sum', new Map([
        ['Items', { types: ['queue'], elements: ['integer'] }],
        ['sum', { types: ['function'] }],
    ]))).toEqual({ types: [] });
});

it('selects numeric cell types from native collections', () => {
    for (const type of ['queue', 'stack', 'deque', 'set']) {
        const source: ValueFacts = { types: [type], elements: ['integer'] };
        expect(facts('Items min', new Map([['Items', source]])))
            .toEqual({ types: ['integer'], rank: 0, shape: [] });
        expect(facts('Items max', new Map([['Items', source]])))
            .toEqual({ types: ['integer'], rank: 0, shape: [] });
    }
    expect(facts('Items min', new Map([['Items', { types: ['set'], elements: ['integer', 'real'] }]])))
        .toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('Items min', new Map([['Items', { types: ['set'], elements: ['integer'] }],
        ['min', { types: ['function'] }]]))).toEqual({ types: [] });
});

it('keeps scalar cells through a stable numeric sort', () => {
    const values: ValueFacts = { types: ['array'], rank: 1, shape: [3],
        elements: ['integer'], callbackFreeScalarCells: true };
    const bindings = new Map([['A', values]]);
    expect(facts('A sort', bindings)).toEqual({ types: ['array'], rank: 1,
        shape: [3], elements: ['integer'], eagerScalarCells: true });
    expect(facts('A sort .descending', bindings)).toEqual({ types: ['array'], rank: 1,
        shape: [3], elements: ['integer'], eagerScalarCells: true });
    expect(facts('A sort', new Map([['A', { ...values, callbackFreeScalarCells: undefined }]])))
        .toEqual({ types: ['array'] });
});

it('infers scalar cells and combined shape for a safe named outer operation', () => {
    expect(facts('(0 until 3) (0 until 4) bxor outer')).toEqual({ types: ['array'], rank: 2,
        shape: [3, 4], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2) (array 3 4) bor outer')).toEqual({ types: ['array'], rank: 2,
        shape: [2, 2], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2 3 4 shape 2 2) (array 5 6) band outer')).toEqual({
        types: ['array'], rank: 3, shape: [2, 2, 2], elements: ['integer'], callbackFreeScalarCells: true,
    });
    expect(facts('(array 1 2) (array 3 4) bxor outer', new Map([['bxor', { types: ['function'] }]])))
        .not.toMatchObject({ callbackFreeScalarCells: true });
    expect(facts('(array 1 2.5) (array 3 4) bxor outer'))
        .not.toMatchObject({ callbackFreeScalarCells: true });
});

it('uses declared dense result shapes for native collection operations', () => {
    expect(facts('(array 1 2 3 4 shape 2 2) 0 0 .eight neighbors')).toEqual({
        types: ['array'], rank: 2, shape: [null, 2], elements: ['integer'], eagerScalarCells: true,
    });
    expect(facts('(array 1 2 3 4 shape 2 2) 0 0 neighbors')).toEqual({
        types: ['array'], rank: 2, shape: [null, 2], elements: ['integer'], eagerScalarCells: true,
    });
    expect(facts('(array 1 2 3 4 shape 2 2) 0 0 neighbors',
        new Map([['neighbors', { types: ['function'] }]]))).not.toMatchObject({ eagerScalarCells: true });
});

it('keeps text cells in the dense result of split', () => {
    expect(facts('"a,b" "," split')).toEqual({ types: ['array'], rank: 1,
        shape: [null], elements: ['text'], eagerScalarCells: true });
    expect(facts('"a,b" "," split', new Map([['split', { types: ['function'] }]])))
        .not.toMatchObject({ eagerScalarCells: true });
});

it('reads a counter entry as an integer when the key is known', () => {
    const counter: ValueFacts = { types: ['counter'] };
    const bindings = new Map<string, ValueFacts>([['Counts', counter], ['Letter', {
        types: ['text'], rank: 1, shape: [1],
    }]]);
    expect(facts('Counts Letter', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Counts 7', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Counts Unknown', bindings)).toEqual({ types: [] });
    expect(facts('Counts type', bindings)).not.toMatchObject({ types: ['integer'] });
});

it('proves eager cells for known atom array literals', () => {
    expect(facts('array true false').eagerScalarCells).toBe(true);
    expect(facts('array shape 2 2\n 1 2\n 3 4\nend').eagerScalarCells).toBe(true);
    expect(facts('array X').eagerScalarCells).toBeUndefined();
    expect(facts('array shape 2 fill 0').eagerScalarCells).toBe(true);
    expect(facts('array shape 2 fill Unknown').eagerScalarCells).toBeUndefined();
    expect(facts('(1 to 3) array').eagerScalarCells).toBeUndefined();
    expect(facts('array 1 "two"')).toMatchObject({ types: ['array'], rank: 1,
        shape: [2], elements: ['integer', 'text'], positions: [['integer'], ['text']], eagerScalarCells: true });
});

it('reads only valid parse directives when inferring captured positions', () => {
    expect(facts('"/42:x" "///integer:/word" parse')).toMatchObject({
        types: ['array'], rank: 1, shape: [2], elements: ['integer', 'text'],
        positions: [['integer'], ['text']], eagerScalarCells: true,
    });
    expect(facts('"x" "/invalid" parse').positions).toBeUndefined();
});

it('retains rank when a dimension is unknown', () => {
    expect(facts('array shape N 3 fill 0').shape).toEqual([null, 3]);
    expect(facts('array shape N 3 fill 0').rank).toBe(2);
    expect(facts('Unknown')).toEqual({ types: [] });
});

it('recognizes implicit local collections without treating other names as values', () => {
    for (const name of ['queue', 'set', 'counter', 'index']) {
        expect(facts(name)).toEqual({ types: [name] });
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(`A = ${name}\n`);
        const statement = parsed.value.statements[0];
        if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
        expect(typeOf(statement.value, () => undefined)).toEqual([name]);
    }
    expect(facts('Unknown')).toEqual({ types: [] });
});

it('retains result types when a collection selects an axis', () => {
    expect(facts('"abcd" queue')).toEqual({ types: ['text'], rank: 1, shape: [null] });
    expect(facts('"abcd" 2')).toEqual({ types: ['text'], rank: 1, shape: [1] });
    const selected = services.Rank.parser.LangiumParser.parse<Program>('A = "abcd" 2\n');
    const statement = selected.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    expect(typeOf(statement.value, () => undefined)).toEqual(['text']);
    const textSelection = services.Rank.parser.LangiumParser.parse<Program>('A = "abcd" queue\n').value.statements[0];
    if (!isAssignmentStatement(textSelection)) throw new Error('expected assignment');
    expect(typeOf(textSelection.value, () => undefined)).toEqual(['text']);
    expect(facts('Source Indices', new Map([
        ['Source', { types: ['array'], rank: 2, shape: [3, 4], elements: ['integer'], eagerScalarCells: true }],
        ['Indices', { types: ['array'], rank: 1, shape: [2], elements: ['integer'], eagerScalarCells: true }],
    ]))).toMatchObject({ types: ['array'], rank: 2, shape: [2, 4], elements: ['integer'],
        callbackFreeScalarCells: true });
    expect(facts('Source queue', new Map([
        ['Source', { types: ['sequence'], rank: 1, shape: [5], elements: ['integer'] }],
    ]))).toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
    expect(facts('Unknown queue')).toEqual({ types: [] });
});

it('reads the declared type and element type of builtin values', () => {
    for (const name of ['fibonacci', 'primes']) {
        expect(facts(name)).toEqual({ types: ['sequence'], elements: ['integer'], rank: 1, shape: [null],
            callbackFreeScalarCells: true });
        expect(facts(`${name} from 5`)).toMatchObject({ types: ['sequence'], elements: ['integer'],
            rank: 1, callbackFreeScalarCells: true });
        expect(facts(`(${name} from 5) 0`)).toEqual({ types: ['integer'], rank: 0, shape: [] });
        const lowerBound = services.Rank.parser.LangiumParser.parse<Program>(`A = ${name} from 5\n`);
        const statement = lowerBound.value.statements[0];
        if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
        expect(typeOf(statement.value, () => undefined)).toEqual(['sequence']);
    }
    for (const name of ['infinity', 'nan']) {
        expect(facts(name)).toEqual({ types: ['real'], rank: 0, shape: [] });
    }
    for (const [name, expected] of [['fibonacci', 'sequence'], ['primes', 'sequence'],
        ['infinity', 'real'], ['nan', 'real']]) {
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(`A = ${name}\n`);
        const statement = parsed.value.statements[0];
        if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
        expect(typeOf(statement.value, () => undefined)).toEqual([expected]);
    }
    expect(facts('primes', new Map([['primes', { types: ['text'] }]]))).toEqual({ types: ['text'] });
    expect(facts('Unknown 0', new Map([['Unknown', {
        types: ['sequence'], rank: 1, shape: [null], elements: ['integer'],
    }]]))).toEqual({ types: [] });
});

it('recognizes positional slices as arrays rather than integer ranges', () => {
    const source: ValueFacts = { types: ['array'], rank: 2, shape: [5, 4], elements: ['integer'],
        eagerScalarCells: true };
    const bindings = new Map([['Source', source]]);
    expect(facts('Source from 1 until 3', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [2, 4], elements: ['integer'] });
    expect(facts('Source axis 1 from 1 to 2', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [5, 2], elements: ['integer'] });
    expect(facts('Source from Start until End', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [null, 4] });
    expect(facts('Unknown from 0 until End')).toEqual({ types: [] });
    expect(facts('1 until 3')).toMatchObject({ types: ['sequence'], shape: [2] });
    expect(facts('"A😀БC" from 1 until 3')).toMatchObject({ types: ['text'], rank: 1, shape: [2] });
    expect(facts('(1 to 5) from 1 until 3')).toMatchObject({ types: ['array'], rank: 1,
        shape: [2], elements: ['integer'] });
    expect(facts('Queue from 1 to 2', new Map([['Queue', { types: ['queue'] }]])))
        .toMatchObject({ types: ['array'], rank: 1, shape: [null] });
    const parsed = services.Rank.parser.LangiumParser.parse<Program>('Result = Source from 1 until 3\n');
    const assignment = parsed.value.statements[0];
    if (!isAssignmentStatement(assignment)) throw new Error('expected assignment');
    expect(typeOf(assignment.value, name => name === 'Source' ? ['array'] : undefined)).toEqual(['array']);
    expect(typeOf(assignment.value, () => undefined)).toEqual([]);
    expect(typeOf(assignment.value, name => name === 'Source' ? ['sequence'] : undefined)).toEqual(['array']);
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

it('keeps the rank of builtins that always return one scalar', () => {
    for (const source of ['X Y gcd', 'X lcm', 'X Y lcm', 'X Y Z powmod',
        'X Y Z binomialmod', 'X len', 'X count', 'X Y find', 'X Y firstatleast',
        'X position', 'X size', 'X seed', 'X codepoint']) {
        expect(facts(source)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    }
    for (const source of ['X Y bit', 'X Y Z connected', 'X Y Z merge',
        'X eof']) {
        expect(facts(source)).toEqual({ types: ['boolean'], rank: 0, shape: [] });
    }
    expect(facts('(array 1 2) 1 binomial').types).toEqual(['array']);
    expect(facts('"abc" "a" startswith')).toEqual({ types: ['boolean'], rank: 0, shape: [] });
    expect(facts('("abc" bytes) ("a" bytes) startswith'))
        .toEqual({ types: ['boolean'], rank: 0, shape: [] });
    expect(facts('(array "a" "b") "a" startswith')).toMatchObject({
        types: ['array'], rank: 1, shape: [2],
    });
    expect(facts('"ab" (array "a" "b") startswith')).toMatchObject({
        types: ['array'], rank: 1, shape: [2],
    });
    expect(facts('(array "ab" "bc" shape 2 1) (array "a" "b") startswith'))
        .toMatchObject({ types: ['array'], rank: 2, shape: [2, 2] });
    expect(facts('(array "a" "b") Unknown startswith')).toEqual({ types: ['array'] });
    expect(facts('"abc" "a" startswith',
        new Map([['startswith', { types: ['function'] }]]))).toEqual({ types: [] });
    expect(facts('X len', new Map([['len', { types: ['function'] }]]))).not.toHaveProperty('rank');
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

it('does not call a shape-preserving numeric operation scalar when its input is unknown', () => {
    expect(facts('Unknown 4 round').types).toEqual([]);
    expect(facts('Unknown sin').types).toEqual([]);
    const mixed = new Map<string, ValueFacts>([['Value', { types: ['array', 'integer'] }]]);
    expect(facts('Value 4 round', mixed).types).toEqual([]);
    expect(facts('Value sin', mixed).types).toEqual([]);
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
    expect(facts('Input max', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Input min', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Input max', new Map([['Input', { ...input, elements: ['real'] }]])))
        .toEqual({ types: ['real'], rank: 0, shape: [] });
    expect(facts('Input min', new Map([['Input', { ...input, eagerScalarCells: undefined }]])))
        .toEqual({ types: ['integer', 'real'] });
    expect(facts('Input 0 max', bindings).callbackFreeScalarCells).toBe(true);
    expect(facts('Input 0 min', bindings).callbackFreeScalarCells).toBe(true);
    expect(facts('Input 0 max', new Map([['Input', { ...input, eagerScalarCells: undefined }]])).callbackFreeScalarCells)
        .toBeUndefined();
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

it('uses the prior unary result when the next builtin also accepts two operands', () => {
    const values = facts('array 3 1 3');
    expect(facts('Values unique sort', new Map([['Values', values]]))).toEqual({
        types: ['array'], rank: 1, shape: [null], elements: ['integer'], eagerScalarCells: true,
    });
    expect(facts('Values 0 sort', new Map([['Values', values]]))).toEqual({ types: ['array'] });
    expect(facts('Values unique sort', new Map([['Values', values],
        ['unique', { types: ['function'] }]]))).not.toHaveProperty('elements');
});

it('infers integer positions returned by built-in argsort', () => {
    const values = facts('array 3 1 2');
    expect(facts('Values argsort', new Map([['Values', values]]))).toEqual({
        types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true,
    });
    expect(facts('"bca" argsort')).toEqual({
        types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true,
    });
    expect(facts('Values argsort', new Map([['Values', values],
        ['argsort', { types: ['function'] }]]))).not.toHaveProperty('elements');
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
    expect(facts('V W + outer', bindings).callbackFreeScalarCells).toBeUndefined();
    const eager = new Map([...bindings].map(([name, value]) => [name, { ...value, eagerScalarCells: true as const }]));
    expect(facts('V W + outer', eager)).toMatchObject({ types: ['array'], rank: 2, shape: [3, 3],
        elements: ['integer'], callbackFreeScalarCells: true });
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
    expect(facts('(1 to 5) array')).toEqual({ types: ['array'], elements: ['integer'], rank: 1, shape: [5],
        callbackFreeScalarCells: true });
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
    expect(facts('M # 0', bindings).callbackFreeScalarCells).toBeUndefined();
    expect(facts('M # 0', new Map([['M', { ...bindings.get('M')!, eagerScalarCells: true }]])))
        .toMatchObject({ types: ['array'], rank: 1, shape: [2], callbackFreeScalarCells: true });
    expect(facts('M 0 0', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
});

it('keeps text rank separate from its role as an array element', () => {
    expect(facts('"a😀"')).toEqual({ types: ['text'], rank: 1, shape: [2], textLiteral: 'a😀' });
    expect(facts('array "a" "long"').shape).toEqual([2]);
    expect(facts('array -2 3').integers).toEqual([-2, 3]);
});

it('infers finite windows including an empty frame', () => {
    expect(facts('(1 to 5) 3 window').shape).toEqual([3, 3]);
    expect(facts('(1 to 5) 7 window').shape).toEqual([0, 7]);
    expect(facts('"abcd" 2 window')).toEqual({ types: ['sequence'], elements: ['text'], rank: 1, shape: [3],
        callbackFreeScalarCells: true });
});
