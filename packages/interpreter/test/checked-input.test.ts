import { expect, it } from 'vitest';
import { inferRequirements, type ValueRequirement } from '@arrrank/language';
import { Interpreter } from '../src/interpreter.js';
import { parse } from '../src/parser.js';
import { MemoryIo } from './support.js';
import { checkExternalInput } from '../src/checked-input.js';
import { RankError } from '../src/errors.js';

const unconstrained = (): ValueRequirement => ({ rank: { min: 0, max: Infinity }, dimensions: new Map() });
const field = (name: string, requirement: ValueRequirement): ValueRequirement =>
    ({ ...unconstrained(), fields: new Map([[name, requirement]]) });
const numericColumn = (): ValueRequirement => ({ rank: { min: 1, max: 1 }, dimensions: new Map(),
    domains: ['integer', 'real', 'missing'] });

it('checks an inferred CSV requirement through an alias against actual column types', () => {
    const program = parse('use tables\nRows = "data.csv" csv\nAlias = Rows\nAlias .price sum');
    const requirement = inferRequirements(program).bindings.find(item => item.name === 'Rows')!;
    for (const [csv, accepted] of [['price,name\n3,Ada\n', true], ['price,name\nwrong,Ada\n', false]] as const) {
        const runtime = new Interpreter(() => {}, { io: new MemoryIo({ 'data.csv': csv }) });
        const rows = runtime.execute('use tables\n"data.csv" csv')!;
        const check = () => checkExternalInput(rows, requirement, 'data.csv');
        if (accepted) expect(check).not.toThrow();
        else expect(check).toThrow(/data.csv.price\[0\].*received text/);
    }
});

it('requires CSV headers even when there are no rows and permits extra columns', () => {
    const requirement = field('price', numericColumn());
    for (const [csv, accepted] of [['price,extra\n', true], ['other\n', false], ['price,extra\n1,unused\n', true]] as const) {
        const runtime = new Interpreter(() => {}, { io: new MemoryIo({ 'data.csv': csv }) });
        const rows = runtime.execute('use tables\n"data.csv" csv')!;
        const check = () => checkExternalInput(rows, requirement, 'data.csv');
        if (accepted) expect(check).not.toThrow();
        else expect(check).toThrow('data.csv.price: required field is missing');
    }
});

it('uses consumer missing-cell requirements without silently converting CSV columns', () => {
    const runtime = new Interpreter(() => {}, { io: new MemoryIo({ 'data.csv': 'price,id\n1,a\n,b\n' }) });
    const rows = runtime.execute('use tables\n"data.csv" csv')!;
    expect(() => checkExternalInput(rows, field('price', numericColumn()), 'data.csv')).not.toThrow();
    expect(() => checkExternalInput(rows, field('price', { ...numericColumn(), domains: ['integer', 'real'] }), 'data.csv'))
        .toThrow(/data.csv.price\[1\].*received missing/);
});

it('checks nested JSON fields and reports the complete path', () => {
    const runtime = new Interpreter(() => {});
    const data = runtime.execute(`use json\n${JSON.stringify('{"payload":{"items":[1,2,3]}}')} json`)!;
    const requirement = field('payload', field('items', { ...numericColumn(), dimensions: new Map([[0, { min: 3, max: 3 }]]) }));
    expect(() => checkExternalInput(data, requirement, 'response.json')).not.toThrow();
    expect(() => checkExternalInput(data, field('payload', field('absent', numericColumn())), 'response.json'))
        .toThrow('response.json.payload.absent: required field is missing');
    expect(() => checkExternalInput(data, field('payload', field('items', { ...numericColumn(),
        dimensions: new Map([[0, { min: 2, max: 2 }]]) })), 'response.json'))
        .toThrow('response.json.payload.items: expected axis 0 length 2, received 3');
});

it('checks XML attribute presence while retaining its textual value type', () => {
    const runtime = new Interpreter(() => {});
    const xml = runtime.execute(`use xml\n${JSON.stringify('<item id="12"/>')} xml`)!;
    const text: ValueRequirement = { rank: { min: 1, max: 1 }, dimensions: new Map(), domains: ['text'] };
    expect(() => checkExternalInput(xml, field('attributes', field('id', text)), 'data.xml')).not.toThrow();
    expect(() => checkExternalInput(xml, field('attributes', field('missing', text)), 'data.xml'))
        .toThrow('data.xml.attributes.missing: required field is missing');
});

it('does not confuse tuples with homogeneous numeric arrays', () => {
    const runtime = new Interpreter(() => {});
    const tuple = runtime.execute(`use json\n${JSON.stringify('[1,"two"]')} json`)!;
    expect(() => checkExternalInput(tuple, numericColumn(), 'data.json'))
        .toThrow('data.json: expected rank 1, received rank 0');
});

it('reports contract errors without including external cell contents', () => {
    const runtime = new Interpreter(() => {});
    const data = runtime.execute(`use json\n${JSON.stringify('{"price":"private value"}')} json`)!;
    try {
        checkExternalInput(data, field('price', { ...unconstrained(), domains: ['integer', 'real'] }), 'data.json');
        throw new Error('expected validation failure');
    } catch (error) {
        expect(error).toBeInstanceOf(RankError);
        expect((error as RankError).rankKind).toBe('InputContract');
        expect((error as Error).message).toBe('data.json.price: expected integer or real, received text');
    }
});
