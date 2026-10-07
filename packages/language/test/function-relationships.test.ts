import { createCallAnalysis } from '../src/analysis/function-calls.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, isReturnStatement, type Program } from '../src/generated/ast.js';
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


it('derives numeric result relationships from shared operator signatures', () => {
    const summary = functionRelationship(definition('fun twice Values\n return Values + Values\nend'))!;
    expect(summary.result).toMatchObject({ kind: 'binary', operation: { name: '+' }, left: { kind: 'parameter', index: 0 } });
    for (const value of [
        { types: ['integer'], rank: 0, shape: [] },
        { types: ['real'], rank: 0, shape: [] },
        { types: ['array'], rank: 2, shape: [null, 3], elements: ['integer'], eagerScalarCells: true },
        { types: ['array'], rank: 1, shape: [null], elements: ['real'], callbackFreeScalarCells: true },
        { types: ['sequence'], rank: 1, shape: [null], elements: ['integer'], callbackFreeScalarCells: true },
    ] satisfies ValueFacts[]) {
        const result = instantiateRelationship(summary, [value]);
        expect(result?.types).toEqual(value.types);
        expect(result?.rank).toEqual(value.rank);
        expect(result?.shape).toEqual(value.shape);
        if (value.elements) expect(result?.elements).toEqual(value.elements);
    }
    expect(instantiateRelationship(summary, [{ types: [] }])).toBeUndefined();
    expect(instantiateRelationship(summary, [{ types: ['array'], rank: 1, shape: [3], elements: ['integer'] }])).toBeUndefined();
});

it('keeps operation errors on the ordinary diagnostic path', () => {
    for (const [source, message] of [
        ['fun twice Value\n return Value * 2\nend\nResult = "wrong" twice', 'operator * does not accept text and integer'],
        ['fun plus A B\n return A + B\nend\nResult = (array 1 2) (array 1 2 3) plus', 'shape mismatch'],
    ]) {
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
        expect(parsed.parserErrors).toEqual([]);
        expect(analyzeValues(parsed.value).diagnostics.some(item => item.message.includes(message))).toBe(true);
    }
});


it('reuses arithmetic relationships without turning lazy arrays eager', () => {
    const source = 'fun twice Values\n return Values + Values\nend\n'
        + Array.from({ length: 120 }, (_, i) => `Result${i} = ${i}.5 twice`).join('\n');
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value);
    expect(result.diagnostics).toEqual([]);
    for (let i = 0; i < 120; i++) expect(result.bindings.get(`Result${i}`)?.types).toEqual(['real']);
    const summary = functionRelationship(definition('fun twice Values\n return Values + Values\nend'))!;
    const value = instantiateRelationship(summary, [{ types: ['array'], rank: 1, shape: [null],
        elements: ['integer'], callbackFreeScalarCells: true }]);
    expect(value).toMatchObject({ types: ['array'], rank: 1, elements: ['integer'], callbackFreeScalarCells: true });
    expect(value?.eagerScalarCells).toBeUndefined();
});


it('does not treat a scalar boolean guard as an array mask operation', () => {
    const summary = functionRelationship(definition('fun guard Flag Mask\n return Flag and Mask\nend'))!;
    expect(instantiateRelationship(summary, [
        { types: ['boolean'], rank: 0, shape: [] },
        { types: ['array'], rank: 1, shape: [3], elements: ['boolean'], eagerScalarCells: true },
    ])).toBeUndefined();
});


it('reuses an imported relationship while its qualified binding remains unchanged', () => {
    const fn = definition('fun identity Value\n return Value\nend');
    const program = fn.$container as Program;
    const binding: ValueFacts = { types: ['function'] };
    const env = new Map([['M.identity', binding]]);
    const external = { program, name: 'identity', binding, functions: new Map([['identity', fn]]) };
    let moduleAnalyses = 0;
    const calls = createCallAnalysis(env, new Map(), [], new Map(), () => { throw new Error('unexpected local body'); },
        () => { moduleAnalyses++; return { result: { types: [] }, diagnostics: [], relationship: functionRelationship(fn) }; },
        new Map([['M.identity', external]]));
    for (let i = 0; i < 120; i++) expect(calls.call('M.identity', [{ types: ['integer'], rank: 0, shape: [] }], env).types)
        .toEqual(['integer']);
    expect(moduleAnalyses).toBe(1);
    expect(calls.validRelationships(env).has(fn)).toBe(true);
    env.set('M.identity', { types: ['function'] });
    expect(calls.call('M.identity', [{ types: ['integer'] }], env).types).toEqual([]);
    expect(calls.validRelationships(env).has(fn)).toBe(false);
});

it('composes imported helpers and qualifies their transitive dependencies', () => {
    const parse = (source: string) => {
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
        expect(parsed.parserErrors).toEqual([]);
        return parsed.value;
    };
    const module = parse('fun helper Value\n return tuple Value "label"\nend\nfun pair Value\n return Value helper\nend');
    const source = 'use "helper" as M\nfun wrap Value\n return Value M.pair\nend\n'
        + Array.from({ length: 120 }, (_, i) => `Result${i} = ${i} wrap`).join('\n');
    const result = analyzeValues(parse(source), new Map(), new Map(), [], () => module);
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('Result119')?.tupleItems?.map(item => item.types)).toEqual([['integer'], ['text']]);
    const wrapper = result.relationships.get(result.functions.get('wrap')!)!;
    expect(wrapper.dependencies.map(item => item.name).sort()).toEqual(['M.helper', 'M.pair']);
    const changed = analyzeValues(parse(source + '\nM.helper = 0\nAfter = 1 wrap'), new Map(), new Map(), [], () => module);
    expect(changed.bindings.get('After')?.types).toEqual([]);
    expect(changed.relationships.has(changed.functions.get('wrap')!)).toBe(false);
});

it('does not reuse imported summaries at the expense of module diagnostics', () => {
    const fn = definition('fun identity Value\n return Value\nend');
    const binding: ValueFacts = { types: ['function'] };
    const env = new Map([['M.identity', binding]]);
    const external = { program: fn.$container as Program, name: 'identity', binding, functions: new Map([['identity', fn]]) };
    const diagnostics: Parameters<typeof createCallAnalysis>[2] = [];
    const calls = createCallAnalysis(env, new Map(), diagnostics, new Map(), () => [], () => ({
        result: { types: [] }, diagnostics: [{ node: fn, message: 'other returns incompatible types', kind: 'TypeError' }],
        relationship: functionRelationship(fn),
    }), new Map([['M.identity', external]]));
    const statement = fn.statements[0];
    if (!isReturnStatement(statement) || !statement.value) throw new Error('expected return expression');
    calls.call('M.identity', [{ types: ['integer'] }], env, statement.value);
    expect(diagnostics.map(item => item.message)).toEqual(['other returns incompatible types']);
    expect(calls.validRelationships(env).has(fn)).toBe(false);
});

it('reuses a callback relationship over ranked array cells without granting purity', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(`
fun twice Value
 return Value * 2
end
Values = array 1 2 3
${Array.from({ length: 120 }, (_, i) => `Result${i} = Values twice rank 0`).join('\n')}
`);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.relationships.size).toBe(1);
    for (let i = 0; i < 120; i++) {
        const result = analysis.bindings.get(`Result${i}`);
        expect(result).toMatchObject({ types: ['array'], elements: ['integer'], rank: 1, shape: [3] });
        expect(result?.eagerScalarCells).toBeUndefined();
        expect(result?.callbackFreeScalarCells).toBeUndefined();
    }
});

it('infers stateful ranked callback results from captured contracts', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(`
fun solve Values
 Count = 0
 fun next Value
  Count += 1
  return Value + Count
 end
 return Values next rank 0
end
Result = (array 1 2 3) solve
`);
    expect(parsed.parserErrors).toEqual([]);
    const analysis = analyzeValues(parsed.value);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.bindings.get('Result')).toMatchObject({ types: ['array'], elements: ['integer'], rank: 1 });
    expect(analysis.bindings.get('Result')?.callbackFreeScalarCells).toBeUndefined();
});

it('keeps semantic results independent of call order and array materialization evidence', () => {
    const inputs: ValueFacts[] = [
        { types: ['integer'], rank: 0, shape: [] },
        { types: ['real'], rank: 0, shape: [] },
        { types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'], eagerScalarCells: true },
        { types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'], callbackFreeScalarCells: true },
    ];
    const run = (order: number[]) => {
        const fn = definition('fun twice Value\n return Value + Value\nend');
        const env = new Map<string, ValueFacts>([['twice', { types: ['function'] }]]);
        const diagnostics: Parameters<typeof createCallAnalysis>[2] = [];
        const calls = createCallAnalysis(env, new Map([['twice', fn]]), diagnostics, new Map(),
            () => [{ types: [] }], () => { throw new Error('unexpected import'); });
        const results = new Map(order.map(index => {
            const { types, rank, shape, elements } = calls.call('twice', [inputs[index]], env);
            return [index, { types, rank, shape, elements }];
        }));
        expect(diagnostics).toEqual([]);
        return results;
    };
    const forward = run([0, 1, 2, 3]);
    expect(run([3, 2, 1, 0])).toEqual(forward);
    expect(forward.get(2)).toEqual(forward.get(3));
    expect(forward.get(0)).toMatchObject({ types: ['integer'], rank: 0 });
    expect(forward.get(1)).toMatchObject({ types: ['real'], rank: 0 });
});

it('uses fresh relationships and diagnostics after an edited definition is reparsed', () => {
    const run = (returned: string) => {
        const parsed = services.Rank.parser.LangiumParser.parse<Program>(
            `fun helper Value\n return ${returned}\nend\nfun wrap Value\n return Value helper\nend\nResult = 1 wrap`);
        expect(parsed.parserErrors).toEqual([]);
        return analyzeValues(parsed.value);
    };
    const original = run('Value');
    const edited = run('tuple Value "changed"');
    expect(original.diagnostics).toEqual([]);
    expect(edited.diagnostics).toEqual([]);
    expect(original.bindings.get('Result')?.types).toEqual(['integer']);
    expect(edited.bindings.get('Result')?.tupleItems?.map(item => item.types)).toEqual([['integer'], ['text']]);
    expect(edited.relationships.get(edited.functions.get('wrap')!))
        .not.toBe(original.relationships.get(original.functions.get('wrap')!));
});

it('does not expose a relationship after its own function binding is replaced', () => {
    const fn = definition('fun identity Value\n return Value\nend');
    const env = new Map<string, ValueFacts>([['identity', { types: ['function'] }]]);
    const calls = createCallAnalysis(env, new Map([['identity', fn]]), [], new Map(), () => [{ types: [] }],
        () => { throw new Error('unexpected import'); });
    calls.call('identity', [{ types: ['integer'], rank: 0, shape: [] }], env);
    expect(calls.validRelationships(env).has(fn)).toBe(true);
    env.set('identity', { types: ['function'] });
    expect(calls.validRelationships(env).has(fn)).toBe(false);
    expect(calls.call('identity', [{ types: ['integer'], rank: 0, shape: [] }], env).types).toEqual([]);
});
