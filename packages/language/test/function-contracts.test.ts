import { formatTypeSignature } from '../src/type-signature.js';
import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues, createRankServices, inferFunctionContract, isFunctionStatement,
    operatorContract, type Program } from '../src/index.js';
import { instantiateTypeSignatures, type SignatureType } from '../src/type-signature.js';

const services = createRankServices(EmptyFileSystem);
function contract(source: string, name = 'f', budget?: number) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const definition = parsed.value.statements.find(node => isFunctionStatement(node) && node.name === name)!;
    if (!isFunctionStatement(definition)) throw new Error('missing definition');
    const summary = analyzeValues(parsed.value).relationships.get(definition)!
    expect(summary).toBeDefined();
    return inferFunctionContract(summary, definition.parameters.length, budget);
}
const has = (result: ReturnType<typeof contract>, inputs: unknown[], output: unknown) =>
    result.alternatives.some(row => instantiateTypeSignatures(row, inputs as SignatureType[])
        .some(instance => JSON.stringify(instance.result) === JSON.stringify(output)));

it('rejects implicit promotion and generic lifted domains without requiring cells', () => {
    const inc = contract('fun f X\n return X + 1\nend');
    expect(has(inc, ['integer'], 'integer')).toBe(true);
    expect(has(inc, ['real'], 'real')).toBe(false);
    expect(has(inc, ['integer'], 'real')).toBe(false);
    for (const collection of ['array', 'sequence']) {
        const type = { collection, element: 'integer' };
        expect(has(inc, [type], type)).toBe(true);
        expect(inc.alternatives.find(row => JSON.stringify(row.inputs) === JSON.stringify([type]))?.frameParameter).toBe(0);
    }
    expect(inc.unresolved).toBe(true); // empty and untyped lazy cells are not excluded
    const division = contract('fun f X\n return X / 2\nend');
    expect(has(division, ['integer'], 'real')).toBe(true);
    expect(has(division, ['real'], 'real')).toBe(false);
});

it('keeps nonnumeric overloads and gives SQL priority over missing propagation', () => {
    const multiply = contract('fun f X\n return X * 2\nend');
    expect(has(multiply, ['duration'], 'duration')).toBe(true);
    const add = contract('fun f X Y\n return X + Y\nend');
    expect(has(add, ['text', 'text'], 'text')).toBe(true);
    expect(has(add, ['text', 'integer'], 'text')).toBe(false);
    expect(has(add, ['column', 'missing'], 'column')).toBe(true);
    expect(has(add, ['missing', 'column'], 'column')).toBe(true);
    expect(has(add, ['missing', 'integer'], 'missing')).toBe(true);
    expect(operatorContract('+')!.columns).toHaveLength(2);
    expect(operatorContract('mod')!.columns).toEqual([]);
});

it('carries intermediate domains through helpers and repeated parameters', () => {
    const helper = contract('fun half X\n return X / 2.0\nend\nfun f X\n return (X half) + X\nend');
    expect(has(helper, ['integer'], 'real')).toBe(false);
    expect(has(helper, ['real'], 'real')).toBe(true);
    expect(has(contract('fun f X\n return X + X\nend'), ['text'], 'text')).toBe(true);
});

it('keeps a conservative remainder when a fresh inference budget runs out', () => {
    const source = 'fun f X Y Z\n return (X + Y) + Z\nend';
    const limited = contract(source, 'f', 20);
    expect(limited.exhausted).toBe(true);
    expect(limited.unresolved).toBe(true);
    expect(contract('fun f X\n return X + 1\nend').exhausted).toBe(false);
});


it('does not claim inherited bounds when a scalar constructs another collection', () => {
    const result = contract('fun f X Y\n return X + (Y to 2)\nend');
    const row = result.alternatives.find(row => JSON.stringify(row.inputs)
        === JSON.stringify([{ collection: 'sequence', element: 'integer' }, 'integer']));
    expect(row).toBeDefined();
    expect(row?.frameParameter).toBeUndefined();
});

it('composes a four-parameter numeric branch without enumerating 21 to the fourth domains', () => {
    const result = contract('fun f A B C D\n return ((A + B) + C) + D\nend');
    expect(result.symbolic).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(result.alternatives.length).toBeLessThan(200);
    const numeric = result.alternatives.find(row => formatTypeSignature(row) === 'a a a a → a ; a: number');
    expect(numeric).toBeDefined();
    expect(has(result, ['integer', 'integer', 'integer', 'integer'], 'integer')).toBe(true);
    expect(has(result, ['real', 'real', 'real', 'real'], 'real')).toBe(true);
    expect(has(result, ['integer', 'real', 'integer', 'integer'], 'real')).toBe(false);
    expect(has(result, ['text', 'text', 'text', 'text'], 'text')).toBe(true);
    expect(has(result, ['missing', 'column', 'integer', 'integer'], 'column')).toBe(true);
    expect(has(result, ['missing', 'column', 'integer', 'integer'], 'missing')).toBe(false);
});

it('keeps independent numeric groups independent across tuple returns and helper calls', () => {
    const source = 'fun add X Y\n return X + Y\nend\nfun f A B C D\n return tuple (A B add) (C D add)\nend';
    const result = contract(source);
    expect(result.symbolic).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(has(result, ['integer', 'integer', 'real', 'real'], { tuple: ['integer', 'real'] })).toBe(true);
    expect(has(result, ['integer', 'real', 'real', 'real'], { tuple: ['real', 'real'] })).toBe(false);
    expect(result.alternatives.some(row => formatTypeSignature(row) === 'a a b b → tuple(a, b) ; a: number ; b: number')).toBe(true);
});

it('freshens shared operator variables and state for every function summary', () => {
    const integer = contract('fun f X\n return X + 1\nend');
    const real = contract('fun f X\n return X + 1.0\nend');
    expect(has(integer, ['real'], 'real')).toBe(false);
    expect(has(real, ['real'], 'real')).toBe(true);
    expect(has(real, ['integer'], 'real')).toBe(false);
    expect(has(integer, ['integer'], 'integer')).toBe(true);
});

it('keeps enumeration as the explicit fallback for unsupported field and range expressions', () => {
    const result = contract('fun f X Y\n return X + (Y to 2)\nend');
    expect(result.symbolic).toBeUndefined();
    expect(result.exhausted).toBe(false);
});

it('composes a helper with more parameters than its caller and leaves unused values unconstrained', () => {
    const result = contract('fun add X Y Z\n return (X + Y) + Z\nend\nfun f A\n return A A A add\nend');
    expect(result.symbolic).toBe(true);
    expect(has(result, ['real'], 'real')).toBe(true);
    const tuple = contract('fun f A B Ignored\n return tuple (A + B) Ignored\nend');
    expect(tuple.alternatives.some(row => formatTypeSignature(row) === 'a a b → tuple(a, b) ; a: number')).toBe(true);
});
