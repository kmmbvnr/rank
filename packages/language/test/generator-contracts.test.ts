import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { createRankServices, isFunctionStatement, type Program } from '../src/index.js';
import { inferGeneratorContract } from '../src/analysis/generator-contracts.js';

const services = createRankServices(EmptyFileSystem);
function contract(source: string, budget?: number) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const definition = parsed.value.statements[0];
    if (!isFunctionStatement(definition)) throw new Error('missing function');
    return inferGeneratorContract(definition, budget);
}

it('bounds nested loop inference and starts each inspection with a fresh budget', () => {
    const source = 'fun f N\n X = 1\n for N greater 0\n  for N greater 0\n   yield X\n   X = X / 2\n   N -= 1\n  end\n end\nend';
    const limited = contract(source, 10);
    expect(limited.exhausted).toBe(true);
    expect(limited.unresolved).toBe(true);
    expect(limited.alternatives).toEqual([]);
    const full = contract(source);
    expect(full.exhausted).toBe(false);
    expect(full.alternatives[0]).toEqual({ inputs: ['integer'],
        result: { collection: 'sequence', element: { union: ['integer', 'real'] } } });
});

it('keeps captured values, unknown calls and unsupported control flow unresolved', () => {
    for (const body of ['yield Captured', 'yield N other', 'try\n yield N\nfinally\n X = 1\nend',
        'if N greater 0\n X = 1\nend\nyield X']) {
        expect(contract(`fun f N\n${body}\nend`).alternatives).toEqual([]);
    }
});

it('does not carry facts across a terminating branch', () => {
    const result = contract('fun f N\n if N greater 0\n  return\n else\n  X = 1\n end\n yield X\nend');
    expect(result.alternatives[0]).toEqual({ inputs: ['integer'], result: { collection: 'sequence', element: 'integer' } });
});

it('does not treat writes to an enclosing scope as stable generator locals', () => {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'fun outer\n X = 0\n fun inner N\n  X = 1\n  yield X\n end\n return inner\nend');
    expect(parsed.parserErrors).toEqual([]);
    const outer = parsed.value.statements[0];
    if (!isFunctionStatement(outer)) throw new Error('missing outer function');
    const inner = outer.statements.find(isFunctionStatement)!;
    expect(inferGeneratorContract(inner).alternatives).toEqual([]);
});
