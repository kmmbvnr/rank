import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues, createRankServices, inferFunctionContract, isFunctionStatement,
    operatorContract, type Program } from '../src/index.js';

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
    result.alternatives.some(row => JSON.stringify(row.inputs) === JSON.stringify(inputs)
        && JSON.stringify(row.result) === JSON.stringify(output));

it('preserves promotion and generic lifted domains without requiring cells', () => {
    const inc = contract('fun f X\n return X + 1\nend');
    expect(has(inc, ['integer'], 'integer')).toBe(true);
    expect(has(inc, ['real'], 'real')).toBe(true);
    expect(has(inc, ['integer'], 'real')).toBe(false);
    for (const collection of ['array', 'sequence']) {
        const type = { collection, element: 'real' };
        expect(has(inc, [type], type)).toBe(true);
        expect(inc.alternatives.find(row => JSON.stringify(row.inputs) === JSON.stringify([type]))?.frameParameter).toBe(0);
    }
    expect(inc.unresolved).toBe(true); // empty and untyped lazy cells are not excluded
    const division = contract('fun f X\n return X / 2\nend');
    expect(has(division, ['integer'], 'real')).toBe(true);
    expect(has(division, ['real'], 'real')).toBe(true);
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
    const helper = contract('fun half X\n return X / 2\nend\nfun f X\n return (X half) + X\nend');
    expect(has(helper, ['integer'], 'real')).toBe(true);
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
