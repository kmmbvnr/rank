import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isAssignmentStatement, type Program } from '../src/generated/ast.js';
import { expressionFacts } from '../src/analysis/value-facts.js';
import { incompatibleShapes, joinValueFacts, type ValueFacts } from '../src/analysis/value-domain.js';
import { typeOf } from '../src/analysis/types.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';

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
        shape: [2, 3], eagerScalarCells: true, declaredArrayContract: { type: 'array', rank: 2, elements: [{ type: 'integer' }] } });
    expect(facts('array 1 2 3 4 shape 2 2')).toEqual({ types: ['array'], elements: ['integer'], rank: 2,
        shape: [2, 2], eagerScalarCells: true });
});

it('infers the shape and cells of a prefix stack through transpose', () => {
    const vector: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'],
        eagerScalarCells: true };
    const bindings = new Map([['X', vector], ['Y', vector]]);
    expect(facts('stack X Y', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [2, 3], elements: ['integer'] });
    expect(facts('stack X Y transpose', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [3, 2], elements: ['integer'] });
    expect(facts('stack unpack Items', new Map([['Items', { types: ['array'], rank: 1,
        shape: [2], elements: ['array'] }]]))).toMatchObject({ types: ['array'] });
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
    expect(facts('"<root/>" xml')).toMatchObject({ types: ['object'], fields: {
        kind: { types: ['text'], rank: 1 }, name: { types: ['text'], rank: 1 },
        value: { types: ['text'], rank: 1 }, attributes: { types: ['object'] },
        children: { types: ['array'], rank: 1, elements: ['object'] },
    } });
    const node = facts('"<root/>" xml');
    expect(facts('Doc .kind', new Map([['Doc', node]]))).toMatchObject({ types: ['text'], rank: 1 });
    expect(facts('Doc .children', new Map([['Doc', node]]))).toMatchObject({ types: ['array'], rank: 1,
        elements: ['object'] });
    expect(facts('Doc .attributes .id', new Map([['Doc', node]]))).toEqual({ types: [] });
    const changed = services.Rank.parser.LangiumParser.parse<Program>(
        'use xml\nDoc = "<root/>" xml\nAlias = Doc\nDoc .kind = 42\nAfter = Alias .kind',
    );
    expect(analyzeValues(changed.value).bindings.get('After')?.types).toEqual([]);
    for (const document of ['"<root/>" xml .flat', '"{}" json .flat']) {
        expect(facts(document)).toEqual({ types: ['array'], rank: 1, shape: [null], elements: ['object'] });
    }
    expect(facts('"<root/>" xml .flat', new Map([['xml', { types: ['function'] }]])))
        .toEqual({ types: [] });
});

it('publishes validated CSV column facts with one shared row length', () => {
    const source = 'use tables\nRows = "data.csv" csv check\nPrice = Rows .price\nQuantity = Rows .quantity\nTotal = Price sum\nOther = Quantity sum';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    const analysis = analyzeValues(parsed.value);
    const rows = analysis.bindings.get('Rows')!;
    const price = analysis.bindings.get('Price')!;
    const quantity = analysis.bindings.get('Quantity')!;
    expect(analysis.diagnostics).toEqual([]);
    expect(price).toMatchObject({ types: ['array'], rank: 1, elements: ['integer', 'real', 'missing'] });
    expect(quantity).toMatchObject({ types: ['array'], rank: 1, elements: ['integer', 'real', 'missing'] });
    expect(price.dims?.[0]).toEqual(rows.dims?.[0]);
    expect(quantity.dims?.[0]).toEqual(rows.dims?.[0]);
    const unchecked = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source.replace(' csv check', ' csv')).value);
    expect(unchecked.bindings.get('Price')?.types).toEqual([]);
});

it('keeps checked column types through a filter with a fresh shared row length', () => {
    const source = 'use tables\nRows = "data.csv" csv check\nPrice = Rows .price\nTotal = Price sum\nFound = Rows filter .price greater 0\nNext = Found .price';
    const analysis = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    const rows = analysis.bindings.get('Rows')!;
    const found = analysis.bindings.get('Found')!;
    const next = analysis.bindings.get('Next')!;
    expect(next.elements).toEqual(['integer', 'real', 'missing']);
    expect(next.dims?.[0]).toEqual(found.dims?.[0]);
    expect(found.dims?.[0]).not.toEqual(rows.dims?.[0]);
});

it('forgets checked CSV columns after mutating a row through an alias', () => {
    const source = 'use tables\nRows = "data.csv" csv check\nBefore = Rows .price\nTotal = Before sum\nAlias = Rows\nRow = Alias 0\nRow .price = "bad"\nAfter = Rows .price';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    const before = parsed.value.statements.find(item => isAssignmentStatement(item) && item.name === 'Before');
    if (!before || !isAssignmentStatement(before)) throw new Error('expected Before assignment');
    expect(analysis.expressions.get(before.value)?.elements).toEqual(['integer', 'real', 'missing']);
    expect(analysis.bindings.get('After')?.types).toEqual([]);
});

it('carries checked JSON field facts through nested selections', () => {
    const document = JSON.stringify('{"payload":{"items":[1,2]}}');
    const source = `use json\nDoc = ${document} json check\nItems = Doc .payload .items\nTotal = Items sum`;
    const analysis = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    expect(analysis.bindings.get('Doc')?.checkedFields?.payload?.checkedFields?.items).toBeDefined();
    expect(analysis.bindings.get('Items')?.types).toEqual(['integer', 'real', 'missing', 'array']);
    expect(analysis.bindings.get('Items')?.elements).toEqual(['integer', 'real', 'missing']);
    const unchecked = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source.replace(' json check', ' json')).value);
    expect(unchecked.bindings.get('Items')?.types).toEqual([]);
});

it('types validated XML attributes as text without guessing unchecked keys', () => {
    const xml = JSON.stringify('<item id="12"/>');
    const source = `use xml\nDoc = ${xml} xml check\nId = Doc .attributes .id`;
    const analysis = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    expect(analysis.bindings.get('Id')).toMatchObject({ types: ['text'], rank: 1 });
    const unchecked = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source.replace(' xml check', ' xml')).value);
    expect(unchecked.bindings.get('Id')?.types).toEqual([]);
});

it('forgets a checked XML attribute after mutating its object alias', () => {
    const xml = JSON.stringify('<item id="12"/>');
    const source = `use xml\nDoc = ${xml} xml check\nId = Doc .attributes .id\nAttrs = Doc .attributes\nAttrs .id = 12\nAfter = Doc .attributes .id`;
    const analysis = analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    expect(analysis.bindings.get('After')?.types).toEqual([]);
});

it('forgets checked document fields after mutation through a nested alias', () => {
    const document = JSON.stringify('{"payload":{"items":[1,2]}}');
    const source = `use json\nDoc = ${document} json check\nItems = Doc .payload .items\nTotal = Items sum\nPart = Doc .payload\nPart .items = "bad"\nAfter = Doc .payload .items`;
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    const before = parsed.value.statements.find(item => isAssignmentStatement(item) && item.name === 'Items');
    if (!before || !isAssignmentStatement(before)) throw new Error('expected Items assignment');
    expect(analysis.expressions.get(before.value)?.types).toContain('array');
    expect(analysis.bindings.get('After')?.types).toEqual([]);
});

it('infers outer facts from literal JSON without assuming external schemas', () => {
    expect(facts('"[{\\"x\\":1},{\\"x\\":2}]" json')).toEqual({
        types: ['array'], rank: 1, shape: [2], elements: ['object'], eagerScalarCells: true,
    });
    expect(facts('"[1, true, null]" json')).toEqual({
        types: ['tuple'], rank: 0, shape: [], tupleItems: [
            { types: ['integer', 'real'], rank: 0, shape: [] },
            { types: ['boolean'], rank: 0, shape: [] }, { types: ['symbol'], rank: 0, shape: [] },
        ],
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
        types: ['tuple'], rank: 0, shape: [],
        tupleItems: [
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
        .toEqual({ types: ['integer'], rank: 0, shape: [], dim: expect.objectContaining({ constant: 0 }) });
    expect(facts('(1 to 5) len')).toEqual({ types: ['integer'], rank: 0, shape: [], integer: '5' });
    expect(facts('Values len', new Map([['Values', { types: ['sequence'], rank: 1, shape: [5] }]])))
        .toEqual({ types: ['integer'], rank: 0, shape: [] });
});

it('keeps known record field facts and builtin record contracts', () => {
    expect(facts('(record\n  .count = 3\n  .name = "a"\nend) .count'))
        .toMatchObject({ types: ['integer'], rank: 0 });
    expect(facts('(record\n  .items = array 1 2\nend) .items'))
        .toEqual({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
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
        types: ['integer'], rank: 0, shape: [], dim: expect.objectContaining({ constant: 0 }),
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
        new Map([['Graph', graph]]))).toEqual({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
});

it('distinguishes dsu components from graph components and tracks closed dsu values', () => {
    const dsu = facts('new dsu (1 to 4)');
    expect(dsu).toEqual({ types: ['dsu'], elements: ['integer'] });
    const bindings = new Map<string, ValueFacts>([['Union', dsu]]);
    expect(facts('Union components', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Union findroot 2', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('new dsu components')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    const words = facts('new dsu (array "a" "b")');
    expect(facts('Words findroot "a"', new Map([['Words', words]])))
        .toEqual({ types: ['text'], rank: 1, shape: [null] });
    const mixed = facts('new dsu (array 1 "x")');
    expect(facts('Mixed findroot 1', new Map([['Mixed', mixed]])))
        .toEqual({ types: ['integer', 'text'] });
    expect(facts('Union findroot 2', new Map([['Union', { types: ['dsu'] }]])))
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
    expect(facts('(array 1 2 3) drop 1')).toEqual({ types: ['array'], rank: 1,
        shape: [2], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array shape 2 3 fill 0) take 1')).toEqual({ types: ['array'], rank: 2,
        shape: [1, 3], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(1 to 5) take 2')).toEqual({ types: ['sequence'], rank: 1,
        shape: [2], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('"abcd" drop 2')).toEqual({ types: ['text'], rank: 1, shape: [2] });
    expect(facts('Lazy drop 1', new Map([['Lazy', { types: ['array'], rank: 1,
        shape: [3], elements: ['integer'] }]]))).toEqual({
        types: ['array'], rank: 1, shape: [2], elements: ['integer'],
    });
    expect(facts('(array 1 2) take 1.5')).toEqual({ types: [] });
});

it('infers numeric scans without treating unsafe cell readers as callback-free', () => {
    expect(facts('(array 1 2 3) scan + with 0')).toEqual({ types: ['array'], rank: 1,
        shape: [4], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(1 to 3) scan * with 1')).toEqual({ types: ['sequence'], rank: 1,
        shape: [4], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2 3) scan +')).toEqual({ types: ['array'], rank: 1,
        shape: [3], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2) scan + with 0.5')).toEqual({ types: ['array'], rank: 1,
        shape: [3], elements: ['integer', 'real'], callbackFreeScalarCells: true });
    // An axis scan keeps the shape of any rank, so it claims no rank-1 facts.
    expect(facts('(array 1 2 3) scan + axis 0')).toEqual({ types: [] });
    expect(facts('Unsafe scan + with 0', new Map([['Unsafe', { types: ['array'], rank: 1,
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
    expect(facts('(1 to 4) (1 to 2)')).toEqual({ types: ['array'], rank: 1,
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
    expect(facts('Values till Mask', bindings)).toEqual({ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('Values till greater 3', bindings)).toEqual({ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('Values from 3', bindings)).toEqual({ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('Values till Unsafe', new Map([...bindings, ['Unsafe', { types: [] }]])))
        .toEqual({ types: ['array'], rank: 1, shape: [null] });
    expect(facts('Q till Mask', new Map([...bindings, ['Q', { types: ['queue'] }]])))
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
        ['Values first index where Mask', 'integer'], ['Values till Mask', 'array'],
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
    for (const [source, operation] of [['(array 1 2) segment +', '+'],
        ['(array 1 2) segment min', 'min'], ['(array 1 2) segment max', 'max']]) {
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

it('infers the built-in segment maxsum profile without assuming a shadowed combine', () => {
    const tree = facts('(array 1 2) segment maxsum');
    expect(tree).toEqual({ types: ['segment'], elements: ['integer'], segmentOperation: 'maxsum' });
    const bindings = new Map([['Tree', tree]]);
    expect(facts('Tree 0', bindings)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('Tree 0 1 query', bindings)).toEqual({ types: ['record'], fields: {
        sum: { types: ['integer'], rank: 0, shape: [] },
        prefix: { types: ['integer'], rank: 0, shape: [] },
        suffix: { types: ['integer'], rank: 0, shape: [] },
        best: { types: ['integer'], rank: 0, shape: [] },
    } });
    const mixed = facts('(array 1 2.5) segment maxsum');
    expect(facts('Tree 0 1 query', new Map([['Tree', mixed]]))?.fields?.best?.types)
        .toEqual(['integer', 'real']);
    expect(facts('Values segment maxsum', new Map([['Values', {
        types: ['array'], rank: 1, shape: [null], elements: ['integer'],
    }]]))).not.toHaveProperty('segmentOperation');
    expect(facts('(array 1 2) segment maxsum', new Map([['maxsum', { types: ['function'] }]])))
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
    expect(facts('(array 1 2) / 2')).toMatchObject({ types: ['array'], elements: ['real'] });
    expect(facts('(array 1.5 2.5) * 2')).toMatchObject({ types: ['array'], elements: ['real'] });
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
    expect(facts('(1 to 4) reduce *')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(array 1 2 3) reduce +')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(array 1.5 2.5) reduce +')).toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('Lazy reduce +', new Map([['Lazy', { types: ['sequence'], rank: 1,
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
        .toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
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
        .toEqual({ types: ['array'], rank: 1, shape: [3] });
});

it('infers scalar cells and combined shape for a safe named outer operation', () => {
    expect(facts('(0 till 3) (0 till 4) outer bxor')).toEqual({ types: ['array'], rank: 2,
        shape: [3, 4], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2) (array 3 4) outer bor')).toEqual({ types: ['array'], rank: 2,
        shape: [2, 2], elements: ['integer'], callbackFreeScalarCells: true });
    expect(facts('(array 1 2 3 4 shape 2 2) (array 5 6) outer band')).toEqual({
        types: ['array'], rank: 3, shape: [2, 2, 2], elements: ['integer'], callbackFreeScalarCells: true,
    });
    expect(facts('(array 1 2) (array 3 4) outer bxor', new Map([['bxor', { types: ['function'] }]])))
        .not.toMatchObject({ callbackFreeScalarCells: true });
    expect(facts('(array 1 2.5) (array 3 4) outer bxor'))
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
        types: ['tuple'], rank: 0, shape: [], tupleItems: [{ types: ['integer'] }, { types: ['text'] }],
    });
    expect(facts('"x" "/invalid" parse').positions).toBeUndefined();
});

it('retains rank when a dimension is unknown', () => {
    expect(facts('array shape N 3 fill 0').shape).toEqual([null, 3]);
    expect(facts('array shape N 3 fill 0').rank).toBe(2);
    expect(facts('Unknown')).toEqual({ types: [] });
});

it('types a collection only by the structure it was created with', () => {
    for (const name of ['queue', 'set', 'counter', 'index']) {
        // A bare structure word is no longer a value; `new` creates the one a name holds.
        expect(facts(name)).toEqual({ types: [] });
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(`A = new ${name}\n`);
        const statement = parsed.value.statements[0];
        if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
        expect(typeOf(statement.value, () => undefined)).toEqual([name]);
    }
    expect(facts('Unknown')).toEqual({ types: [] });
});

it('retains result types when a collection selects an axis', () => {
    expect(facts('"abcd" 2')).toEqual({ types: ['text'], rank: 1, shape: [1] });
    const selected = services.Rank.parser.LangiumParser.parse<Program>('A = "abcd" 2\n');
    const statement = selected.value.statements[0];
    if (!isAssignmentStatement(statement)) throw new Error('expected assignment');
    expect(typeOf(statement.value, () => undefined)).toEqual(['text']);
    expect(facts('Source Indices', new Map([
        ['Source', { types: ['array'], rank: 2, shape: [3, 4], elements: ['integer'], eagerScalarCells: true }],
        ['Indices', { types: ['array'], rank: 1, shape: [2], elements: ['integer'], eagerScalarCells: true }],
    ]))).toMatchObject({ types: ['array'], rank: 2, shape: [2, 4], elements: ['integer'],
        callbackFreeScalarCells: true });
    expect(facts('Source Picks', new Map([
        ['Source', { types: ['sequence'], rank: 1, shape: [5], elements: ['integer'] }],
        ['Picks', { types: ['queue'], elements: ['integer'] }],
    ]))).toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
    expect(facts('Unknown Picks', new Map([['Picks', { types: ['queue'], elements: ['integer'] }]]))).toEqual({ types: [] });
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
    expect(facts('infinity')).toEqual({ types: ['real'], rank: 0, shape: [], infinite: true });
    expect(facts('-infinity')).toEqual({ types: ['real'], rank: 0, shape: [], infinite: true });
    expect(facts('nan')).toEqual({ types: ['real'], rank: 0, shape: [] });
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
    expect(facts('Source (1 till 3)', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [2, 4], elements: ['integer'] });
    expect(facts('Source # (1 to 2)', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [5, 2], elements: ['integer'] });
    expect(facts('Source (Start till End)', bindings)).toMatchObject({ types: ['array'], rank: 2,
        shape: [null, 4] });
    expect(facts('Unknown (0 till End)')).toEqual({ types: [] });
    expect(facts('1 till 3')).toMatchObject({ types: ['sequence'], shape: [2] });
    expect(facts('"A😀БC" (1 till 3)')).toMatchObject({ types: ['text'], rank: 1, shape: [2] });
    expect(facts('(1 to 5) (1 till 3)')).toMatchObject({ types: ['array'], rank: 1,
        shape: [2], elements: ['integer'] });
    expect(facts('Queue (1 to 2)', new Map([['Queue', { types: ['queue'] }]])))
        .toMatchObject({ types: ['array'], rank: 1, shape: [null] });
    const parsed = services.Rank.parser.LangiumParser.parse<Program>('Result = Source (1 till 3)\n');
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
    for (const source of ['X lcm', 'X Y Z powmod',
        'X Y Z binomialmod', 'X len', 'X count',
        'X position', 'X size', 'X seed', 'X codepoint']) {
        expect(facts(source)).toEqual({ types: ['integer'], rank: 0, shape: [] });
    }
    for (const source of ['X Y Z connected', 'X Y Z merge',
        'X eof']) {
        expect(facts(source)).toEqual({ types: ['boolean'], rank: 0, shape: [] });
    }
    expect(facts('(array 1 2) 1 binomial').types).toEqual(['array']);
    for (const source of ['X Y gcd', 'X Y lcm', 'X Y bit', 'X Y firstatleast']) expect(facts(source).rank).toBeUndefined();
    expect(facts('12 18 gcd')).toMatchObject({ types: ['integer'], rank: 0, shape: [] });
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
        .toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(facts('Input 0 max', bindings).callbackFreeScalarCells).toBe(true);
    expect(facts('Input 0 min', bindings).callbackFreeScalarCells).toBe(true);
    expect(facts('Input 0 max', new Map([['Input', { ...input, eagerScalarCells: undefined }]])).callbackFreeScalarCells)
        .toBeUndefined();
    expect(facts('Input all', bindings)).toEqual({ types: ['boolean'], rank: 0, shape: [] });
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
    expect(facts('V W outer +', bindings)).toMatchObject({ types: ['array'], rank: 2, shape: [3, 3] });
    expect(facts('V W outer +', bindings).callbackFreeScalarCells).toBeUndefined();
    const eager = new Map([...bindings].map(([name, value]) => [name, { ...value, eagerScalarCells: true as const }]));
    expect(facts('V W outer +', eager)).toMatchObject({ types: ['array'], rank: 2, shape: [3, 3],
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
    expect(facts('(1 till 5) array').shape).toEqual([4]);
    expect(facts('(1 to 9 by 2) array').shape).toEqual([5]);
    expect(facts('(9 till 1 by -2) array').shape).toEqual([4]);
    expect(facts('(5 to 1) array').shape).toEqual([0]);
});

it('infers shape and integer elements for range array declarations', () => {
    expect(facts('array 1 to 5')).toMatchObject({ types: ['array'], elements: ['integer'], rank: 1, shape: [5], eagerScalarCells: true });
    expect(facts('array 1 to 4 shape 2 2')).toMatchObject({ types: ['array'], elements: ['integer'], rank: 2, shape: [2, 2], eagerScalarCells: true });
    expect(facts('array 1 to 9 by 2 shape 5 1')).toMatchObject({ types: ['array'], elements: ['integer'], rank: 2, shape: [5, 1], eagerScalarCells: true });
    expect(facts('array 0 till 16 shape 4 4')).toMatchObject({ types: ['array'], elements: ['integer'], rank: 2, shape: [4, 4], eagerScalarCells: true });
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

it('instantiates builtin cell signatures and combines intrinsic frames', () => {
    const bindings = new Map<string, ValueFacts>([
        ['Rows', { types: ['array'], rank: 2, shape: [2, 3] }],
        ['Matrices', { types: ['array'], rank: 3, shape: [4, 3, 3] }],
        ['Other', { types: ['array'], rank: 2, shape: [2, 1] }],
    ]);
    for (const name of ['sort', 'argsort']) {
        expect(facts(`Rows ${name}`, bindings)).toEqual({ types: ['array'], rank: 2, shape: [2, 3] });
    }
    expect(facts('Rows unique', bindings)).toEqual({ types: ['array'], rank: 2, shape: [2, null] });
    expect(facts('Matrices inverse', bindings)).toEqual({ types: ['array'], rank: 3, shape: [4, 3, 3] });
    expect(facts('Matrices det', bindings)).toEqual({ types: ['array'], rank: 1, shape: [4] });
    expect(facts('Rows Other atan2', bindings)).toMatchObject({ types: ['array'], rank: 2, shape: [2, 3] });
    expect(facts('Rows sort', new Map([...bindings, ['sort', { types: ['function'] }]]))).toEqual({ types: [] });
    expect(facts('Rows Sort', new Map([...bindings,
        ['Sort', { types: ['function'], builtinOperation: 'sort' }]])))
        .toEqual({ types: ['array'], rank: 2, shape: [2, 3] });
});

it('uses cell signatures for explicit ranks and reordered frame axes', () => {
    const bindings = new Map<string, ValueFacts>([
        ['A', { types: ['array'], rank: 3, shape: [2, 0, 4] }],
        ['B', { types: ['array'], rank: 2, shape: [2, 3] }],
    ]);
    expect(facts('A sort axis 1 0 rank 1', bindings))
        .toEqual({ types: ['array'], rank: 3, shape: [0, 2, 4] });
    expect(facts('B sum rank 1', bindings)).toEqual({ types: ['array'], rank: 1, shape: [2] });
    expect(facts('B unique rank 1', bindings)).toEqual({ types: ['array'], rank: 2, shape: [2, null] });
    expect(facts('B B atan2 rank 0 0', bindings)).toEqual({ types: ['array'], rank: 2, shape: [2, 3] });
    expect(facts('B inverse', bindings).shape).toBeUndefined();
    expect(facts('A B atan2', bindings).shape).toBeUndefined();
});

it('keeps collection kinds without inventing dimensions or callback proofs', () => {
    expect(facts('Values 2 round', new Map([['Values', { types: ['array'], elements: ['real'] }]])))
        .toEqual({ types: ['array'], elements: ['real'] });
    expect(facts('Values sort', new Map([['Values', { types: ['array'] }]]))).toEqual({ types: ['array'] });
    expect(facts('A B Minimum', new Map([
        ['Minimum', { types: ['function'], builtinOperation: 'min' }],
        ['A', { types: ['integer'], rank: 0, shape: [] }],
        ['B', { types: ['integer'], rank: 0, shape: [] }],
    ]))).toEqual({ types: ['integer'], rank: 0, shape: [] });
});

it('keeps collection search and DSU findroot contracts separate', () => {
    // The targets may be an array, which finds each of them.
    expect(facts('X Y find').rank).toBeUndefined();
    expect(facts('(array 1 2) 1 find')).toEqual({ types: ['integer'], rank: 0, shape: [] });
    expect(facts('(array 1 2) (array 2 1) find')).toMatchObject({ types: ['array'], rank: 1, shape: [2] });
    const bindings = new Map<string, ValueFacts>([['D', { types: ['dsu'], elements: ['text'] }]]);
    expect(facts('D "a" findroot', bindings)).toEqual({ types: ['text'], rank: 1, shape: [null] });
    bindings.set('Op', { types: [], builtinOperation: 'findroot' });
    expect(facts('D "a" Op', bindings)).toEqual({ types: ['text'], rank: 1, shape: [null] });
});

it('broadcasts the binary scalar built-ins with intrinsic 0 0 ranks', () => {
    const bindings = new Map<string, ValueFacts>([
        ['R', { types: ['array'], elements: ['integer'], rank: 2, shape: [2, 3] }],
        ['V', { types: ['array'], elements: ['integer'], rank: 1, shape: [3] }],
    ]);
    for (const call of ['R R gcd', 'V R lcm', 'R 1 round']) {
        expect(facts(call, bindings)).toMatchObject({ types: ['array'], rank: 2, shape: [2, 3] });
    }
    expect(facts('V V bit', bindings)).toMatchObject({ types: ['array'], rank: 1, shape: [3], elements: ['boolean'] });
});

it('resolves a negative explicit rank against the operand rank', () => {
    const bindings = new Map<string, ValueFacts>([
        ['A', { types: ['array'], rank: 3, shape: [2, 3, 4] }],
        ['B', { types: ['array'], rank: 2, shape: [3, 4] }],
    ]);
    expect(facts('A sum rank -1', bindings)).toEqual(facts('A sum rank 2', bindings));
    expect(facts('A sum rank -2', bindings)).toEqual(facts('A sum rank 1', bindings));
    expect(facts('A B atan2 rank -3 -2', bindings)).toEqual(facts('A B atan2 rank 0 0', bindings));
});

it('leaves a call of a function with declared ranks unknown', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'fun inc X rank 0\n  return X + 1\nend\nA = (array 1 2) inc\n');
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    expect(analysis.bindings.get('A')?.rank).toBeUndefined();
});

function ragged(source: string) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value).diagnostics.filter(item => item.code === 'RaggedLift')
        .map(({ node: _node, ...item }) => item);
}

it('warns when rank lifts a function with a data-dependent result length', () => {
    const [warning] = ragged('M = array 1 1 2 3 shape 2 2\n(M unique rank 1) print\n');
    expect(warning.severity).toBe('warning');
    expect(warning.message).toContain('`unique` returns a data-dependent length');
    expect(ragged('M = array 1 1 2 3 shape 2 2\n(M distinct rank 1) print\n')).toEqual([]);
    expect(ragged('M = array 1 2 3 shape 3\n(M unique rank 1) print\n')).toEqual([]);
    expect(ragged('M = array 3 1 2 shape 2 3\n(M sort rank 1) print\n')).toEqual([]);
    const fn = 'fun distinct Row\n  return Row unique sum\nend\nfun uniq Row\n  return Row unique\nend\n';
    expect(ragged(fn + 'M = array 1 1 2 3 shape 2 2\n(M uniq rank 1) print\n')[0].message)
        .toContain('`uniq` returns a data-dependent length (from `unique`)');
    expect(ragged(fn + 'M = array 1 1 2 3 shape 2 2\n(M distinct rank 1) print\n')).toEqual([]);
    expect(ragged('use text\nM = array 1 1 2 3 shape 2 2\n(M words rank 1) print\n')).toHaveLength(1);
    const mask = 'fun positive Row\n  return Row (Row greater 0)\nend\n';
    expect(ragged(mask + 'M = array 1 1 2 3 shape 2 2\n(M positive rank 1) print\n')[0].message)
        .toContain('(from `a mask selection`)');
});

it('warns when explicit frame axes lift a data-dependent result', () => {
    const source = 'use sequences\nM = array 1 1 2 3 shape 2 2\n(M unique axis 0 rank 1) print\n';
    expect(ragged(source)).toMatchObject([{ severity: 'warning', message: expect.stringContaining('`unique`') }]);
});

it('warns when a lifted function selects with a named boolean mask', () => {
    const fn = 'fun positives Row\n  Mask = Row greater 0\n  return Row Mask\nend\n';
    const matrix = 'M = array -1 1 2 3 shape 2 2\n(M positives rank 1) print\n';
    expect(ragged(fn + matrix)[0].message).toContain('(from `a mask selection`)');
    const fixed = 'fun picks Row\n  Indices = array 0 1\n  return Row Indices\nend\n';
    expect(ragged(fixed + matrix.replace('positives', 'picks'))).toEqual([]);
    const reassigned = 'fun changed Row\n  Mask = Row greater 0\n  Mask = array true false\n  return Row Mask\nend\n';
    expect(ragged(reassigned + matrix.replace('positives', 'changed'))).toEqual([]);
});

function bound(source: string, initial: Record<string, ValueFacts> = {}) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value, new Map(Object.entries(initial))).bindings;
}

it('keeps one symbolic length for arrays built from the same bound length', async () => {
    const { provenSameShape } = await import('../src/analysis/value-domain.js');
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [null], elements: ['integer'] };
    const names = bound('N = Input len\nA = array shape N fill 0\nB = array shape N fill 1\nC = A + B\nD = array shape 4 fill 0\nE = array shape (Input len) fill 0\n', { Input: input });
    const [a, b, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map(name => names.get(name)!);
    expect(a.shape).toEqual([null]);
    expect(provenSameShape(a, b)).toBe(true);
    expect(provenSameShape(a, c)).toBe(true);
    expect(provenSameShape(a, d)).toBe(false);
    // Two separate `Input len` reads are not proven equal: no shared symbol.
    expect(provenSameShape(a, e)).toBe(false);
});

it('drops a symbolic length when the bound length changes', () => {
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [null], elements: ['integer'] };
    const names = bound('N = Input len\nA = array shape N fill 0\nN = N + 1\nB = array shape N fill 0\n', { Input: input });
    expect(names.get('A')!.dims).toBeDefined();
    expect(names.get('B')!.dims).toBeUndefined();
});

it('keeps only dimensions proven equal across a join', async () => {
    const { joinValueFacts } = await import('../src/analysis/value-domain.js');
    const { variableDim } = await import('../src/analysis/shape-index.js');
    const x = variableDim('x');
    const same = joinValueFacts([{ types: ['array'], rank: 1, shape: [null], dims: [x] },
        { types: ['array'], rank: 1, shape: [null], dims: [x] }]);
    expect(same.dims).toEqual([x]);
    const differ = joinValueFacts([{ types: ['array'], rank: 1, shape: [null], dims: [x] },
        { types: ['array'], rank: 1, shape: [null], dims: [variableDim('y')] }]);
    expect(differ.dims).toBeUndefined();
});

it('keeps missing cells apart from the numeric type and drops them at default', () => {
    const cells = facts('array 1.0 .NA 3.0');
    expect(cells).toMatchObject({ types: ['array'], rank: 1, shape: [3], elements: ['real', 'missing'] });
    const env = new Map<string, ValueFacts>([['P', cells], ['N', facts('.NA')], ['R', facts('1.5')]]);
    expect(facts('P default 0.0', env)).toEqual({ types: ['array'], rank: 1, shape: [3], elements: ['real'] });
    expect(facts('P default false', env)).toMatchObject({ elements: ['real', 'boolean'] });
    expect(facts('P 1 default 0.0', env).types).toEqual(['real']);
    expect(facts('N + 1', env)).toEqual({ types: ['missing'], rank: 0, shape: [] });
    expect(facts('R less N', env)).toEqual({ types: ['missing'], rank: 0, shape: [] });
    expect(facts('R and N', env).types).toEqual(['boolean', 'missing']);
    // The numeric kernels' proof does not cover cells that may have no value.
    expect(facts('P + 1.0', env).callbackFreeScalarCells).toBeUndefined();
});

it('lets a name hold .NA before its first value and refuses other changes of type', () => {
    const diagnose = (source: string) => {
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        return analyzeValues(program.value, new Map(), new Map(), []).diagnostics.map(item => item.message);
    };
    expect(diagnose('X = .NA\nX = 1.0\n')).toEqual([]);
    expect(diagnose('Y = 2.0\nY = .NA\nY = 3.5\n')).toEqual([]);
    expect(diagnose('X = .NA\nX = 1.0\nX = "a"\n')).toEqual(['X has type real and cannot receive text']);
    expect(diagnose('Y = 2.0\nY = .NA\nY = "a"\n')).toEqual(['Y has type real and cannot receive text']);
});

it('gives a path-dependent length one variable of its own after a branch merge', async () => {
    const { provenSameShape } = await import('../src/analysis/value-domain.js');
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [null], elements: ['integer'] };
    const names = bound([
        'A = array 1 2 3',
        'if Flag',
        '  A = array 1 2',
        'end',
        'B = A + A',
    ].join('\n') + '\n', { Flag: { types: ['boolean'], rank: 0, shape: [] }, Input: input });
    const a = names.get('A')!;
    expect(a.shape).toEqual([null]);
    expect(a.dims?.[0]).toBeDefined();
    expect(provenSameShape(a, names.get('B')!)).toBe(true);
    const fixed = bound('A = array 1 2 3\nif Flag\n  A = array 4 5 6\nend\n', { Flag: { types: ['boolean'], rank: 0, shape: [] } });
    expect(fixed.get('A')!.shape).toEqual([3]);
});

it('carries symbolic lengths through user functions', () => {
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [null], elements: ['integer'] };
    const names = bound([
        'fun addone X',
        '  return X + 1',
        'end',
        'fun pickone X',
        '  if X len less 1',
        '    return X',
        '  end',
        '  return array 1 2',
        'end',
        'N = Input len',
        'A = array shape N fill 0',
        'B = A addone',
        'C = A pickone',
        'D = C + C',
    ].join('\n') + '\n', { Input: input });
    return import('../src/analysis/value-domain.js').then(({ provenSameShape }) => {
        expect(provenSameShape(names.get('A')!, names.get('B')!)).toBe(true);
        expect(provenSameShape(names.get('A')!, names.get('C')!)).toBe(false);
        expect(provenSameShape(names.get('C')!, names.get('D')!)).toBe(true);
    });
});

it('does not keep a length across a loop that rebinds the array', async () => {
    const { provenSameShape } = await import('../src/analysis/value-domain.js');
    const input: ValueFacts = { types: ['array'], rank: 1, shape: [null], elements: ['integer'] };
    const other: ValueFacts = { types: ['array'], rank: 1, shape: [null], elements: ['integer'] };
    const names = bound([
        'N = Input len',
        'A = array shape N fill 0',
        'Same = array shape N fill 1',
        'for I in 1 to 3',
        '  M = Other len',
        '  A = array shape M fill 2',
        'end',
    ].join('\n') + '\n', { Input: input, Other: other });
    expect(provenSameShape(names.get('A')!, names.get('Same')!)).toBe(false);
});

it('gives each `many` command-line value one symbolic length', async () => {
    const { provenSameShape } = await import('../src/analysis/value-domain.js');
    const names = bound([
        'option Xs integer many',
        'option Ys integer many',
        'N = Xs len',
        'A = array shape N fill 0',
        'Sum = Xs + A',
        'Other = Xs + Ys',
    ].join('\n') + '\n');
    expect(names.get('Xs')!.elements).toEqual(['integer']);
    expect(provenSameShape(names.get('Xs')!, names.get('A')!)).toBe(true);
    expect(provenSameShape(names.get('Xs')!, names.get('Sum')!)).toBe(true);
    expect(provenSameShape(names.get('Xs')!, names.get('Ys')!)).toBe(false);
});

it('keeps declared stdin lengths across later reads', async () => {
    const { provenSameShape } = await import('../src/analysis/value-domain.js');
    const names = bound([
        'use io',
        'N = stdin .integer',
        'A = stdin .integer N array',
        'B = stdin .integer N array',
        'S = stdin .integer N',
        'Total = A + B',
        'Fixed = stdin .integer 3 array',
    ].join('\n') + '\n');
    expect(names.get('N')!.dim).toBeDefined();
    expect(provenSameShape(names.get('A')!, names.get('B')!)).toBe(true);
    expect(provenSameShape(names.get('A')!, names.get('Total')!)).toBe(true);
    expect(names.get('S')!.dims).toEqual(names.get('A')!.dims);
    expect(names.get('Fixed')!.shape).toEqual([3]);
    expect(provenSameShape(names.get('A')!, names.get('Fixed')!)).toBe(false);
});

it('types a named scan as a rank-1 array and keeps the seed in its length', () => {
    const values = new Map<string, ValueFacts>([['V', facts('array 7 7 9')],
        ['R', { types: ['array'], rank: 1, shape: [3], elements: ['real'], eagerScalarCells: true }],
        ['U', { types: ['array'], rank: 1, shape: [3] }]]);
    expect(facts('V scan bxor with 0', values)).toMatchObject({ types: ['array'], rank: 1, shape: [4],
        elements: ['integer'] });
    expect(facts('V scan bxor', values)).toMatchObject({ types: ['array'], rank: 1, shape: [3] });
    expect(facts('V scan max with 0', values)).toMatchObject({ types: ['array'], rank: 1, shape: [4] });
    // Real cells, unproved cells, an array seed and a shadowed operation claim nothing.
    expect(facts('R scan bxor with 0', values).types).toEqual([]);
    expect(facts('U scan bxor with 0', values).types).toEqual([]);
    expect(facts('V scan bxor with V', values).types).toEqual([]);
    expect(facts('V scan bxor with 0', new Map([...values, ['bxor', { types: ['function'] }]])).types).toEqual([]);
});

it('does not call the xor of unproved operands a scalar', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'use bits\nuse sequences\nfun f Values Queries\n Prefix = Values scan bxor with 0\n'
        + ' Left = Queries # 0\n Right = Queries # 1\n Before = Prefix (Left - 1)\n After = Prefix Right\n'
        + ' return After Before bxor\nend\n');
    expect(parsed.parserErrors).toEqual([]);
    const values: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true };
    const queries: ValueFacts = { types: ['array'], rank: 2, shape: [3, 2], elements: ['integer'],
        eagerScalarCells: true };
    const result = analyzeValues(parsed.value, new Map(), new Map(), [{ name: 'f', arguments: [values, queries] }])
        .functionResults[0];
    expect(result.rank).not.toBe(0);
});

it('does not give ordered extrema a numeric result before the operand domain is known', () => {
    const analyze = (source: string) => analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(source).value);
    const result = analyze('fun small X\n return X min\nend\nA = "b" small\nA = "a"');
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('A')).toMatchObject({ types: ['text'], rank: 1 });
    expect(analyze('fun small X\n return X min\nend\nA = Unknown small').bindings.get('A')?.rank).toBeUndefined();
});


it('infers integer matrices from outer arithmetic on sequences', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(`
Target = 1000
ALast = (Target - 1) // 3
BLast = (Target - 1) // 2
A = 1 to ALast
B = 1 to BLast
C = Target - (A B outer +)
`);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.bindings.get('C')).toMatchObject({ types: ['array'], elements: ['integer'],
        rank: 2, shape: [null, null], callbackFreeScalarCells: true });
    expect(facts('(1 to 3) (1 to 5) outer +')).toMatchObject({ types: ['array'],
        elements: ['integer'], rank: 2, shape: [3, 5], callbackFreeScalarCells: true });
    expect(facts('(array 1 2) (1 to 5) outer *')).toMatchObject({ types: ['array'],
        elements: ['integer'], rank: 2, shape: [2, 5], callbackFreeScalarCells: true });
});

it('does not prove callback-free outer cells from sequence element types alone', () => {
    const bindings = new Map<string, ValueFacts>([['Values', {
        types: ['sequence'], rank: 1, shape: [null], elements: ['integer'],
    }]]);
    expect(facts('Values (1 to 5) outer +', bindings)).toEqual({
        types: ['array'], rank: 2, shape: [null, 5],
    });
    expect(facts('(1 to 3) (1 to 5) outer +', new Map([
        ['outer', { types: ['function'] }],
    ]))).not.toHaveProperty('elements');
});

it('retains array rank when a numeric scalar fact has no explicit rank field', () => {
    const bindings = new Map<string, ValueFacts>([
        ['Values', { types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'] }],
        ['Average', { types: ['real'] }],
    ]);
    const result = facts('Values - Average', bindings);
    expect(result).toMatchObject({ types: ['array'], rank: 2, shape: [2, 3] });
    expect(result.callbackFreeScalarCells).toBeUndefined();
});
