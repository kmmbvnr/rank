import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const analyze = (source: string, initial = new Map<string, ValueFacts>()) => {
    const parsed = parser.parse<Program>(source + '\n');
    expect(parsed.parserErrors.map(error => error.message)).toEqual([]);
    return analyzeValues(parsed.value, initial);
};
const messages = (source: string) => analyze(source).diagnostics.map(item => item.message);

describe('array binding element contracts', () => {
    it.each(['A = array "x" "y"', 'A 0 = "x"', 'A # = "x"', 'A 0 /= 2', 'A = array 3 "x"'])
    ('diagnoses %s', write => {
        expect(messages('A = array 1 2\n' + write).some(message => message.includes('array elements'))).toBe(true);
    });
    it('retains the union and permits changing lengths, empty and missing cells', () => {
        expect(messages('A = array 1 "x"\nA = array 2 3 4\nA 0 = "y"\nA = array shape 0 fill 0\nA = array .NA')).toEqual([]);
        expect(messages('A = array 1 "x"\nA = array 2 3\nA 0 = true').some(message => message.includes('array elements'))).toBe(true);
    });
    it('does not establish a domain from empty or unread values', () => {
        expect(messages('A = array shape 0 fill 0\nA = array "x"')).toEqual([]);
        expect(messages('A = array .NA\nA = array "x"')).toEqual([]);
        expect(messages('A = External\nA = array "x"')).toEqual([]);
    });
    it('keeps cell types across checked scalar writes without retaining values', () => {
        const result = analyze('A = array 1 2\nA 0 += 1\nResult = A sum');
        expect(result.bindings.get('A')?.integers).toBeUndefined();
        expect(result.bindings.get('Result')?.types).toEqual(['integer']);
    });
    it('retains a private array domain across a stateful unknown callback without read-safety proofs', () => {
        const result = analyze('fun apply F\n A = array 1 2\n 0 F\n A = array "x"\n return A\nend\nCallback apply');
        expect(result.diagnostics.some(item => item.message.includes('array elements'))).toBe(true);
    });
    it('checks record schemas in array cells', () => {
        const record = (field: string) => `record\n .${field} = 1\nend`;
        expect(messages(`R = ${record('x')}\nS = ${record('y')}\nA = array R\nA = array S`)
            .some(message => message.includes('array elements'))).toBe(true);
    });
    it('checks recursive nested ranks and cells when they are established facts', () => {
        const nested = (type: string, rank = 1): ValueFacts => ({ types: ['array'], rank: 1, shape: [1],
            elements: ['array'], positionFacts: [{ types: ['array'], rank, shape: Array(rank).fill(1),
                elements: [type], eagerScalarCells: true }] });
        for (const replacement of [nested('text'), nested('integer', 2)]) {
            const result = analyze('A = Original\nA = Replacement', new Map([['Original', nested('integer')], ['Replacement', replacement]]));
            expect(result.diagnostics.some(item => item.message.includes('array elements'))).toBe(true);
        }
    });
    it('retains established domain bounds in backward requirements after effects', () => {
        const result = analyze('A = array 1 2\nUnknown\nA lower');
        expect(result.requirements.conflicts.some(conflict => conflict.kind === 'domain')).toBe(true);
    });
});

it('settles infinity array seeds from finite writes without permitting a later numeric change', () => {
    expect(messages('use numbers\nA = array infinity infinity\nA 0 = 1\nA 1 = infinity')).toEqual([]);
    expect(messages('use numbers\nA = array infinity infinity\nA 0 = 1\nA 1 = 2.0')
        .some(message => message.includes('array elements'))).toBe(true);
});
