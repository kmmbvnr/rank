import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    analyzeBindings, createRankServices, type Binding, type ProgramFacts, type Program,
} from '../src/index.js';

let parse: ReturnType<typeof parseHelper<Program>>;

beforeAll(() => {
    parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);
});

async function facts(lines: string[], imported: string[] = []): Promise<ProgramFacts> {
    const document = await parse(lines.join('\n'));
    expect(document.parseResult.lexerErrors).toEqual([]);
    expect(document.parseResult.parserErrors).toEqual([]);
    return analyzeBindings(document.parseResult.value, imported);
}

function named(result: ProgramFacts, scope: string, name: string): Binding {
    const found = result.scopes.find(entry => entry.name === scope)
        ?.bindings.find(binding => binding.name === name);
    if (found === undefined) throw new Error(`no binding ${scope}.${name}`);
    return found;
}

describe('binding facts', () => {
    it('tracks select locals separately and resolves an initializer against preceding bindings', async () => {
        const result = await facts([
            'use tables', 'Cost = 9', 'Rows = Input',
            'Out = Rows select', '  Cost = .cost + Cost', '  .total = Cost', 'end',
            'After = Cost',
        ], ['Input']);
        expect(result.words).toEqual([]);
        expect(named(result, 'program', 'Cost').reassigned).toBe(false);
        expect(named(result, 'program', 'Cost').reads).toHaveLength(2);
        expect(named(result, 'select', 'Cost').shadows).toBe(true);
        expect(named(result, 'select', 'Cost').reads).toHaveLength(1);
        expect(named(result, 'select', 'Cost').types).toEqual([]);
    });

    it('separates a name written once from one written again', async () => {
        const result = await facts(['A = 1', 'B = 2', 'B = 3', 'C = A + B']);
        expect(named(result, 'program', 'A').reassigned).toBe(false);
        expect(named(result, 'program', 'B').reassigned).toBe(true);
        expect(named(result, 'program', 'B').writes).toHaveLength(2);
        expect(named(result, 'program', 'C').unused).toBe(true);
    });

    it('marks a name a loop both reads and writes', async () => {
        const result = await facts([
            'use ranges', 'Total = 0', 'Seen = 0',
            'for I in 1 to 10', '  Total = Total + I', 'end',
            'Seen = 1',
        ]);
        expect(named(result, 'program', 'Total').loopCarried).toBe(true);
        expect(named(result, 'program', 'Seen').loopCarried).toBe(false);
        expect(named(result, 'program', 'I').kind).toBe('loop');
    });

    it('reads a name the source binds further down the same loop', async () => {
        const result = await facts([
            'use ranges',
            'for I in 1 to 3',
            '  Next 0 = 1',
            '  Next = array 0 0',
            'end',
        ]);
        expect(result.words).toEqual([]);
        expect(named(result, 'program', 'Next').reads).toHaveLength(1);
    });

    it('gives a function its own scope and sees what it hides', async () => {
        const result = await facts([
            'Value = 1',
            'fun double Value',
            '  return Value * 2',
            'end',
            '(3 double) print',
        ]);
        expect(named(result, 'double', 'Value').kind).toBe('parameter');
        expect(named(result, 'double', 'Value').shadows).toBe(true);
        // The function name itself is bound where it is written, before its use.
        expect(named(result, 'program', 'double').kind).toBe('function');
        expect(named(result, 'program', 'double').reads).toHaveLength(1);
    });

    it('lets a nested function read the function that encloses it', async () => {
        const result = await facts([
            'fun outer Grid',
            '  Width = Grid len',
            '  fun inner X',
            '    return X * Width',
            '  end',
            '  return 1 inner',
            'end',
        ]);
        expect(result.words).toEqual([]);
        expect(named(result, 'outer', 'Width').reads).toHaveLength(1);
    });

    it('names the module a read needs, and says when it is open', async () => {
        const open = await facts(['use numbers', 'A = 9 sqrt']);
        expect(open.missing).toEqual([]);
        expect(open.operations.map(use => use.name)).toEqual(['sqrt']);

        const closed = await facts(['A = 9 sqrt']);
        expect(closed.operations).toEqual([]);
        expect(closed.missing).toEqual([
            { module: 'numbers', name: 'sqrt', sites: [{ line: 1, column: 7 }] },
        ]);
    });

    it('leaves receiver methods and core words alone', async () => {
        const result = await facts([
            'use algo', 'use graph',
            'G = new graph .undirected',
            'G add 1 2',
            'Counts = 8 fenwick',
            'Total = Counts sum 3',
            'B = new multiset',
            'Near = B floor 4',
            '.Missing raise',
        ]);
        expect(result.missing).toEqual([]);
        expect(result.words).toEqual([]);
    });

    it('reports the source modules a program loads', async () => {
        const result = await facts(['use "helper"', 'A = 3 twice'], ['twice']);
        expect(result.imports).toEqual([
            { path: 'helper', alias: undefined, at: { line: 1, column: 1 } },
        ]);
        expect(result.words).toEqual([]);

        const blind = await facts(['use "helper"', 'A = 3 twice']);
        expect(blind.words.map(use => use.name)).toEqual(['twice']);
    });

    it('resolves a qualified read through its module alias', async () => {
        const result = await facts([
            'use "models" as Models',
            'A = Data Models.linear',
        ]);
        expect(result.words.map(use => use.name)).toEqual(['Data']);
        expect(named(result, 'program', 'Models').reads).toHaveLength(1);
    });
});

describe('type facts', () => {
    it('reads literals, constructors and declared inputs', async () => {
        const result = await facts([
            'use algo',
            'option Limit integer = 10',
            'flag Verbose',
            'N = 3',
            'R = 1.5',
            'T = "text"',
            'L = .missing',
            'A = array 1 2',
            'Q = new queue',
        ]);
        expect(named(result, 'program', 'Limit').types).toEqual(['integer']);
        expect(named(result, 'program', 'Verbose').types).toEqual(['boolean']);
        expect(named(result, 'program', 'N').types).toEqual(['integer']);
        expect(named(result, 'program', 'R').types).toEqual(['real']);
        expect(named(result, 'program', 'T').types).toEqual(['text']);
        expect(named(result, 'program', 'L').types).toEqual(['symbol']);
        expect(named(result, 'program', 'A').types).toEqual(['array']);
        expect(named(result, 'program', 'Q').types).toEqual(['queue']);
    });

    it('follows the arithmetic the runtime performs', async () => {
        const result = await facts([
            'Sum = 1 + 2',
            'Mixed = 1 + 2.5',
            'Ratio = 4 / 2',
            'Whole = 7 // 2',
            'Power = 2 ** 3',
            'Joined = "a" + "b"',
            'Test = 3 less 4',
        ]);
        expect(named(result, 'program', 'Sum').types).toEqual(['integer']);
        expect(named(result, 'program', 'Mixed').types).toEqual(['real']);
        // Exact division still produces a real.
        expect(named(result, 'program', 'Ratio').types).toEqual(['real']);
        expect(named(result, 'program', 'Whole').types).toEqual(['integer']);
        // A negative exponent would make this real, and that is a value.
        expect(named(result, 'program', 'Power').types).toEqual(['integer', 'real']);
        expect(named(result, 'program', 'Joined').types).toEqual(['text']);
        expect(named(result, 'program', 'Test').types).toEqual(['boolean']);
    });

    it('keeps the shape of an operator over a collection', async () => {
        const result = await facts([
            'use ranges', 'use numbers',
            'Range = 1 until 10',
            'Mask = Range multiple by 3',
            'Values = array 1 2 3',
            'Shifted = Values + 1',
            'Flags = Values greater 1',
        ]);
        expect(named(result, 'program', 'Range').types).toEqual(['sequence']);
        expect(named(result, 'program', 'Mask').types).toEqual(['sequence']);
        expect(named(result, 'program', 'Shifted').types).toEqual(['array']);
        expect(named(result, 'program', 'Flags').types).toEqual(['array']);
    });

    it('takes the result kind from the catalogue', async () => {
        const result = await facts([
            'use numbers', 'use text', 'use sequences',
            'Root = 9 sqrt',
            'Parts = "a b" " " split',
            'Divisors = 12 divisors',
            'Size = Parts len',
        ]);
        expect(named(result, 'program', 'Root').types).toEqual(['real']);
        expect(named(result, 'program', 'Parts').types).toEqual(['array']);
        expect(named(result, 'program', 'Divisors').types).toEqual(['sequence']);
        expect(named(result, 'program', 'Size').types).toEqual(['integer']);
    });

    it('says nothing where nothing is proved', async () => {
        const result = await facts([
            'fun choose Flag',
            '  if Flag',
            '    return 1',
            '  end',
            '  return "one"',
            'end',
            'Either = true choose',
            'Element = (array 1 2) 0',
        ]);
        expect(named(result, 'program', 'Either').types).toEqual([]);
        expect(named(result, 'program', 'Element').types).toEqual([]);
        // A parameter hides the catalogue word of the same spelling; only a
        // variable may be assigned, so shadowing happens through binding forms.
        const shadowed = await facts([
            'use numbers',
            'fun apply sqrt',
            '  A = 9 sqrt',
            '  return A',
            'end',
        ]);
        expect(named(shadowed, 'apply', 'A').types).toEqual([]);
    });

    it('widens a name that is written twice', async () => {
        const result = await facts(['A = 1', 'A = 2', 'B = 1', 'B = "text"']);
        expect(named(result, 'program', 'A').types).toEqual(['integer']);
        expect(named(result, 'program', 'B').types).toEqual(['integer', 'text']);
    });
});
