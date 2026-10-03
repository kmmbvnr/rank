import { createCallAnalysis } from '../src/analysis/function-calls.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
import { functionRelationship, instantiateRelationship, type FunctionRelationship, type TypeRelationship } from '../src/analysis/function-relationships.js';
import { expressionFacts } from '../src/analysis/value-facts.js';
import { type ValueFacts } from '../src/analysis/value-domain.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function definition(source: string) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = parsed.value.statements[0];
    if (!isFunctionStatement(result)) throw new Error('expected function');
    return result;
}

it('retains identity without choosing a type for an unknown parameter', () => {
    const summary = functionRelationship(definition('fun identity Value\n return Value\nend'))!;
    expect(summary.result).toEqual({ kind: 'parameter', index: 0 });
    expect(instantiateRelationship(summary, [{ types: [] }])).toEqual({ types: [] });
    for (const value of [
        { types: ['integer'], rank: 0, shape: [], integer: '42' },
        { types: ['text'], rank: 1, shape: [3] },
        { types: ['array'], rank: 2, shape: [null, 4], elements: ['real'] },
        { types: ['sequence'], rank: 1, shape: [null], elements: ['integer'] },
    ] satisfies ValueFacts[]) expect(instantiateRelationship(summary, [value])).toBe(value);
});

it('keeps tuple positions and distinct parameter relationships', () => {
    const summary = functionRelationship(definition('fun pair Left Right\n return tuple Left (tuple Right "label")\nend'))!;
    expect(summary.result).toMatchObject({ kind: 'tuple', items: [
        { kind: 'parameter', index: 0 },
        { kind: 'tuple', items: [{ kind: 'parameter', index: 1 }, { kind: 'constant' }] },
    ] });
    const result = instantiateRelationship(summary, [{ types: [] }, { types: ['integer'], rank: 0, shape: [] }]);
    expect(result?.tupleItems?.[0].types).toEqual([]);
    expect(result?.tupleItems?.[1].tupleItems?.map(item => item.types)).toEqual([['integer'], ['text']]);
});

it('projects only established record fields and declines other receiver domains', () => {
    const summary = functionRelationship(definition('fun items State\n return State .items\nend'))!;
    expect(summary.result).toEqual({ kind: 'field', source: { kind: 'parameter', index: 0 }, name: 'items' });
    const items: ValueFacts = { types: ['array'], elements: ['integer'], rank: 1, shape: [null] };
    expect(instantiateRelationship(summary, [{ types: ['record'], fields: { items } }])).toBe(items);
    expect(instantiateRelationship(summary, [{ types: ['record'], fields: {} }])).toEqual({ types: [] });
    expect(instantiateRelationship(summary, [{ types: [] }])).toEqual({ types: [] });
    expect(instantiateRelationship(summary, [{ types: ['object'] }])).toBeUndefined();
});

it('preserves expression facts and does not grant cell-reader safety', () => {
    const fn = definition('fun pair Value\n return tuple (Value) "label"\nend');
    const summary = functionRelationship(fn)!;
    const argument: ValueFacts = { types: ['array'], rank: 1, shape: [2], elements: ['integer'] };
    const expressions = new Map();
    instantiateRelationship(summary, [argument], expressions);
    for (const [node, fact] of expressions) {
        expect(fact).toEqual(expressionFacts(node, name => name === 'Value' ? argument : undefined));
    }
    expect(instantiateRelationship(summary, [argument])?.tupleItems?.[0].callbackFreeScalarCells).toBeUndefined();
});

it('declines captures, calls, mutations and guarded returns', () => {
    for (const body of ['return Captured', 'return Value helper', 'Value = 1\n return Value',
        'if Value\n return 1\nelse\n return 2\nend']) {
        expect(functionRelationship(definition(`fun sample Value\n ${body}\nend`))).toBeUndefined();
    }
});


it('reuses relationships beyond the ordinary call-body budget', () => {
    const source = 'fun identity Value\n return Value\nend\n'
        + Array.from({ length: 120 }, (_, i) => `Result${i} = ${i} identity`).join('\n');
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value);
    expect(result.diagnostics).toEqual([]);
    expect(result.relationships.size).toBe(1);
    for (let i = 0; i < 120; i++) expect(result.bindings.get(`Result${i}`)?.types).toEqual(['integer']);
});


it('instantiates one cached relationship without revisiting the return body', () => {
    const fn = definition('fun identity Value\n return Value\nend');
    const binding: ValueFacts = { types: ['function'] };
    const env = new Map([['identity', binding]]);
    let bodyVisits = 0;
    const calls = createCallAnalysis(env, new Map([['identity', fn]]), [], new Map(),
        () => { bodyVisits++; return [{ types: [] }]; },
        () => { throw new Error('unexpected import'); });
    const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    calls.call('identity', [integer], env);
    const summary = calls.relationships.get(fn);
    for (let i = 0; i < 120; i++) {
        expect(calls.call('identity', [integer], env).types).toEqual(['integer']);
        expect(calls.relationships.get(fn)).toBe(summary);
    }
    expect(summary).toBeDefined();
    expect(bodyVisits).toBe(0);
    expect(calls.call('identity', [integer], new Map([['identity', { types: ['function'] }]])).types).toEqual([]);
});


it('does not turn an unobserved recursive return into a returning tuple', () => {
    for (const body of ['Value', 'tuple Value 1', 'Value .items']) {
        const summary = functionRelationship(definition(`fun sample Value\n return ${body}\nend`))!;
        expect(instantiateRelationship(summary, [{ types: [], bottom: true }])).toEqual({ types: [], bottom: true });
    }
});

it('composes structural relationships through nested calls beyond the body budget', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(`
fun pair Value
 return tuple Value "label"
end
fun wrap Value
 return Value pair
end
fun outer Value
 return Value wrap
end
${Array.from({ length: 120 }, (_, i) => `Result${i} = ${i} outer`).join('\n')}
`);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value);
    expect(result.diagnostics).toEqual([]);
    expect(result.relationships.size).toBe(3);
    for (let i = 0; i < 120; i++) {
        expect(result.bindings.get(`Result${i}`)?.tupleItems?.map(item => item.types)).toEqual([['integer'], ['text']]);
    }
    const pair = parsed.value.statements[0];
    if (!isFunctionStatement(pair)) throw new Error('expected pair');
    const parameterNode = [...result.relationships.get(pair)!.expressions.keys()]
        .find(node => node.$type === 'NameExpression');
    expect(result.expressions.get(parameterNode!)?.types).toEqual(['integer']);
});

it('drops a composed relationship when its callee binding changes', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'fun helper Value\n return Value\nend\nfun wrap Value\n return Value helper\nend');
    expect(parsed.parserErrors).toEqual([]);
    const functions = new Map(parsed.value.statements.filter(isFunctionStatement).map(fn => [fn.name, fn]));
    const env = new Map<string, ValueFacts>([['helper', { types: ['function'] }], ['wrap', { types: ['function'] }]]);
    let bodyVisits = 0;
    const calls = createCallAnalysis(env, functions, [], new Map(),
        () => { bodyVisits++; return [{ types: [] }]; },
        () => { throw new Error('unexpected import'); });
    const input: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
    expect(calls.call('wrap', [input], env).types).toEqual(['integer']);
    expect(bodyVisits).toBe(0);
    env.set('helper', { types: ['function'] });
    expect(calls.validRelationships(env).has(functions.get('wrap')!)).toBe(false);
    expect(calls.call('wrap', [input], env).types).toEqual([]);
    expect(bodyVisits).toBeGreaterThan(0);
    expect(calls.relationships.has(functions.get('wrap')!)).toBe(false);
});

it('keeps recursive and stateful callees on ordinary analysis', () => {
    for (const source of [
        'fun first Value\n return Value second\nend\nfun second Value\n return Value first\nend',
        'fun helper Value\n Captured += 1\n return Value\nend\nfun wrap Value\n return Value helper\nend',
    ]) {
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
        expect(parsed.parserErrors).toEqual([]);
        const result = analyzeValues(parsed.value);
        expect(result.relationships.size).toBe(0);
    }
});


it('bounds expansion of a branching relationship graph', () => {
    const input: TypeRelationship = { kind: 'parameter', index: 0 };
    let summary: FunctionRelationship = { result: input, expressions: new Map(), dependencies: [] };
    for (let i = 0; i < 30; i++) {
        summary = { result: { kind: 'tuple', items: [
            { kind: 'call', callee: summary, arguments: [input] },
            { kind: 'call', callee: summary, arguments: [input] },
        ] }, expressions: new Map(), dependencies: [] };
    }
    expect(instantiateRelationship(summary, [{ types: ['integer'], rank: 0, shape: [] }])).toBeUndefined();
});
