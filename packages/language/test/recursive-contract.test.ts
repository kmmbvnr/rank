import { EmptyFileSystem } from 'langium';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { functionEffects } from '../src/analysis/function-effects.js';
import { functionTestExamples } from '../src/analysis/test-examples.js';
import { BOTTOM_VALUE, UNKNOWN_VALUE, joinTypes, joinValueFacts, widenValueFacts,
    type ValueFacts } from '../src/analysis/value-domain.js';

const services = createRankServices(EmptyFileSystem).Rank;
const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };
function parse(source: string): Program {
    const parsed = services.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    return parsed.value;
}
function analyze(source: string, inputs: ValueFacts[] = [integer]) {
    return analyzeValues(parse(source), new Map(), new Map(), [{ name: 'f', arguments: inputs }]);
}

it('distinguishes an absent returning path from unknown information', () => {
    expect(joinValueFacts([BOTTOM_VALUE, integer])).toEqual(integer);
    expect(joinValueFacts([BOTTOM_VALUE, BOTTOM_VALUE])).toEqual(BOTTOM_VALUE);
    expect(joinValueFacts([integer, UNKNOWN_VALUE])).toEqual(UNKNOWN_VALUE);
    expect(joinTypes([['integer'], []])).toEqual([]);
    const facts: ValueFacts[] = [BOTTOM_VALUE, UNKNOWN_VALUE, integer,
        { types: ['real'], rank: 0, shape: [] },
        { types: ['array'], rank: 1, shape: [3], elements: ['integer'] }];
    const canonical = (fact: ValueFacts) => ({ ...fact, types: [...fact.types].sort() });
    for (const a of facts) {
        expect(joinValueFacts([a, a])).toEqual(a);
        for (const b of facts) {
            expect(canonical(joinValueFacts([a, b]))).toEqual(canonical(joinValueFacts([b, a])));
            for (const c of facts) {
                expect(canonical(joinValueFacts([joinValueFacts([a, b]), c])))
                    .toEqual(canonical(joinValueFacts([a, joinValueFacts([b, c])])));
            }
        }
    }
});

it('drops values, axis lengths, aliases and cell-read proofs at recursive edges', () => {
    expect(widenValueFacts({ types: ['array'], rank: 1, shape: [2], elements: ['integer'],
        integers: [1, 2], eagerScalarCells: true, callbackFreeScalarCells: true,
        positionFacts: [integer, integer] })).toEqual({
        types: ['array'], rank: 1, shape: [null], elements: ['integer'],
    });
});

it.each([
    ['"done"', ['text'], 1],
    ['true', ['boolean'], 0],
    ['array 1 2', ['array'], 1],
    ['record\n .value = 1\nend', ['record'], 0],
])('proves a recursive contract seeded by %s', (base, types, rank) => {
    const result = analyze(`fun f N\n if N equal 0\n return ${base}\n end\n return (N - 1) f\nend`);
    expect(result.functionResults[0]).toMatchObject({ types, rank });
    expect(result.diagnostics).toEqual([]);
});

it('seeds mutually recursive functions from a returning member', () => {
    const result = analyze('fun f N\n return N g\nend\n'
        + 'fun g N\n if N equal 0\n return true\n end\n return (N - 1) f\nend');
    expect(result.functionResults[0]).toMatchObject({ types: ['boolean'], rank: 0 });
    expect(result.diagnostics).toEqual([]);
});

it.each([
    'return N f',
    'X = N f\n return 1',
    'N f\n return 1',
    'if N equal 0\n return External\n end\n return (N - 1) f',
    'if N equal 0\n return 1\n end\n X = (N - 1) f\n return External',
])('does not manufacture a seed or erase an unknown return: %s', body => {
    expect(analyze(`fun f N\n ${body}\nend`).functionResults[0].types).toEqual([]);
});

it.each([
    ['1', 'Next / 2', 'types'],
    ['array 1 2', 'array shape 1 2 fill 1', 'ranks'],
])('rejects conflicting base and recursive returns', (base, next, kind) => {
    const result = analyze(`fun f N\n if N equal 0\n return ${base}\n end\n Next = (N - 1) f\n return ${next}\nend`);
    expect(result.functionResults[0].types).toEqual([]);
    expect(result.diagnostics.some(d => d.message.includes(`returns incompatible ${kind}`))).toBe(true);
});

it('checks conflicting contracts across a mutually recursive group', () => {
    const result = analyze('fun f N\n if N equal 0\n return 1\n end\n return N g\nend\n'
        + 'fun g N\n if N equal 0\n return "bad"\n end\n return N f\nend');
    expect(result.functionResults[0].types).toEqual([]);
    expect(result.diagnostics.some(d => d.message.includes('returns incompatible'))).toBe(true);
});

it('keeps polymorphic recursive specializations separate', () => {
    const source = 'fun f X\n if X is .integer\n return "done" f\n end\n return X\nend';
    const result = analyze(source);
    expect(result.functionResults[0].types).toEqual(['text']);
    expect(result.diagnostics).toEqual([]);
});

it('keeps recursive effects conservative even when a return contract is known', () => {
    const source = 'fun f N A\n if N equal 0\n return 1\n end\n A 0 = N\n return (N - 1) A f\nend';
    const program = parse(source);
    const array: ValueFacts = { types: ['array'], rank: 1, shape: [2], elements: ['integer'], eagerScalarCells: true };
    const result = analyze(source, [integer, array]);
    expect(result.functionResults[0].types).toEqual(['integer']);
    const definition = program.statements.find(isFunctionStatement)!;
    expect(functionEffects(name => name === 'f' ? definition : undefined, name => name === 'f')('f', [integer, array]).unknown).toBe(true);
    const caller = analyzeValues(parse(source + '\nA = array 1 2\nR = 2 A f\nA 0 + "bad"'));
    expect(caller.diagnostics).toEqual([]);
    expect(caller.bindings.get('A')?.eagerScalarCells).toBeUndefined();
    expect(caller.bindings.get('A')?.shape).toBeUndefined();
});

it.each([
    ['cses/intro/024_gridpath', 'solve', 5, ['integer']],
    ['cses/math/001_josephus', 'removed', 9, ['integer']],
    ['cses/dynamic/021_tilings', 'counting_tilings', 5, ['integer']],
])('checks the recursive demo boundary: %s', (path, name, count, types) => {
    const source = readFileSync(new URL(`../../../demos/${path}.ra`, import.meta.url), 'utf8');
    const tests = readFileSync(new URL(`../../../demos/${path}_test.ra`, import.meta.url), 'utf8');
    const examples = functionTestExamples(parse(tests), path.split('/').at(-1)!, new Set([name]));
    expect(examples).toHaveLength(count);
    const analysis = analyzeValues(parse(source), new Map(), new Map(), examples);
    expect(analysis.functionResults.map(fact => fact.types)).toEqual(examples.map(() => types));
    expect(analysis.diagnostics).toEqual([]);
});

it('proves Fibonacci and memoized recursion without evaluating concrete inputs', () => {
    for (const declaration of ['fun', 'memo']) {
        const result = analyze(`${declaration} f N\n if N less 2\n return N\n end\n`
            + ' return ((N - 1) f) + ((N - 2) f)\nend');
        expect(result.functionResults[0]).toEqual(integer);
        expect(result.diagnostics).toEqual([]);
    }
});

it('bounds new signatures and leaves a recursive group without a base unknown', () => {
    const result = analyze('fun f N\n return N g\nend\nfun g N\n return N f\nend');
    expect(result.functionResults[0]).toEqual(UNKNOWN_VALUE);
    expect(result.diagnostics).toEqual([]);
    const changing = analyze('fun f N\n return (array N) f\nend');
    expect(changing.functionResults[0]).toEqual(UNKNOWN_VALUE);
});

it('uses the successful assignment contract in later scalar arithmetic', () => {
    const result = analyze('fun f Input\n Value = 0\n Value = Input\n return Value / 2.0\nend', [UNKNOWN_VALUE]);
    expect(result.functionResults[0]).toEqual({ types: ['real'], rank: 0, shape: [] });
    const conflict = analyze('fun f Input\n Value = 0\n Value = Input\n return Value / 2.0\nend',
        [{ types: ['text'], rank: 1, shape: [null] }]);
    expect(conflict.diagnostics.some(d => d.message.includes('cannot receive text'))).toBe(true);
});

it('does not restore scalar constants or captured binding types from an unknown assignment', () => {
    const result = analyze('fun f Input\n Value = 0\n Value = Input\n'
        + ' if Value equal 0\n return 1\n end\n return 2.0\nend', [UNKNOWN_VALUE]);
    expect(result.diagnostics.some(d => d.message.includes('returns incompatible types'))).toBe(true);
    const captured = analyze('fun f Input\n Value = 0\n fun change\n Value = Input\n return 0\n end\n'
        + ' change\n return Value / 2.0\nend', [UNKNOWN_VALUE]);
    expect(captured.functionResults[0].types).toEqual([]);
});

it('uses inferred recursive operands for inline arithmetic', () => {
    for (const step of ['return ((N - 1) f) / N', 'Previous = (N - 1) f\n return Previous / N']) {
        const result = analyze(`fun f N\n if N less 2\n return 1.0\n end\n ${step}\nend`);
        expect(result.functionResults[0]).toEqual({ types: ['real'], rank: 0, shape: [] });
        expect(result.diagnostics).toEqual([]);
    }
});

it('widens numeric loop cells when the integer seed is not closed', () => {
    const program = parse('A = array 8\nfor I in 0 until Count\n A = A / 2\nend');
    const result = analyzeValues(program);
    expect(result.bindings.get('A')?.elements).toEqual(['integer', 'real']);
    expect(result.diagnostics).toEqual([]);
});
