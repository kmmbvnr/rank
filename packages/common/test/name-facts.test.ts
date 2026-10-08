import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ValueFacts } from '@arrrank/language';
import { factsAt, formatNameFacts, layoutNameFacts, describeFacts, type NameFacts } from '../src/name-facts.js';

/** The offset just before the `nth` occurrence of `text`. */
function at(source: string, text: string, nth = 0): number {
    let index = -1;
    for (let count = 0; count <= nth; count++) index = source.indexOf(text, index + 1);
    return index;
}

const integer = (shape: (number | null)[] = []): ValueFacts =>
    ({ types: shape.length ? ['array'] : ['integer'], rank: shape.length, shape, ...(shape.length ? { elements: ['integer'] } : {}) });

describe('factsAt: each kind of name position', () => {
    const source = 'M = array shape 3 4 fill 1\nN = M + 1\nfor Row in M\n Row\nend\n';

    it('finds an assignment target and reports the facts of its value', () => {
        const found = factsAt(source, at(source, 'M'))!;
        expect(found).toMatchObject({ name: 'M', source: 'static' });
        expect(formatNameFacts(found)).toBe('M · integer [3 4]');
    });

    it('finds a read', () => {
        const found = factsAt(source, at(source, 'M', 1))!;
        expect(found.name).toBe('M');
        expect(formatNameFacts(found)).toBe('M · integer [3 4]');
    });

    it('finds a loop name and reports one element of the iterable', () => {
        const found = factsAt(source, at(source, 'Row'))!;
        expect(found).toMatchObject({ name: 'Row', source: 'static' });
        expect(formatNameFacts(found)).toBe('Row · integer [4]');
    });

    it('finds a read of the loop name inside the body', () => {
        expect(formatNameFacts(factsAt(source, at(source, 'Row', 1))!)).toBe('Row · integer [4]');
    });

    it('counts the cursor right after the name as on it', () => {
        const end = at(source, 'M') + 1;
        expect(factsAt(source, end)?.name).toBe('M');
        expect(factsAt(source, at(source, 'N') + 1)?.name).toBe('N');
    });

    it('finds nothing between names, on keywords or numbers', () => {
        expect(factsAt(source, at(source, 'array') + 2)).toBeUndefined();
        expect(factsAt(source, at(source, ' 3 4') )).toBeUndefined();
        expect(factsAt(source, 0 - 1)).toBeUndefined();
    });

    it('reports a text value without a shape', () => {
        const text = 'Row = "abc"\n';
        expect(formatNameFacts(factsAt(text, 1)!)).toBe('Row · text');
    });

    it('says unknown for what it cannot prove, and never guesses', () => {
        const unknown = 'Q = Z + 1\nQ\n';
        const found = factsAt(unknown, at(unknown, 'Q', 1))!;
        expect(found.source).toBe('static');
        expect(formatNameFacts(found)).toBe('Q · unknown');
        // A name nothing defines shows nothing at all.
        expect(factsAt('X + 1\n', 0)).toBeUndefined();
    });

    it('names a user function', () => {
        const program = 'fun f X\n return X\nend\n1 f\n';
        expect(formatNameFacts(factsAt(program, at(program, 'f X'))!)).toBe('f · a → a');
        expect(formatNameFacts(factsAt(program, at(program, 'f', 2) + 1)!)).toBe('f · i → i');
    });

    it('returns nothing for source that does not parse', () => {
        expect(factsAt('A = (', 0)).toBeUndefined();
    });
});

describe('factsAt: functions with example arguments', () => {
    const program = 'fun twice X\n Y = X * 2\n return Y\nend\n';
    const examples = [{ name: 'twice', arguments: [integer()] }];

    it('takes a parameter\'s facts from the example arguments', () => {
        const found = factsAt(program, at(program, 'X'), [], examples)!;
        expect(found.name).toBe('X');
        expect(formatNameFacts(found)).toBe('X · integer');
    });

    it('takes a read and a local assignment inside the body from them too', () => {
        expect(formatNameFacts(factsAt(program, at(program, 'X', 1), [], examples)!)).toBe('X · integer');
        expect(formatNameFacts(factsAt(program, at(program, 'Y'), [], examples)!)).toBe('Y · integer');
    });

    it('reports a parameter as unknown without examples', () => {
        expect(formatNameFacts(factsAt(program, at(program, 'X'))!)).toBe('X · unknown');
    });

    it('does not let a global of the same name speak for a parameter', () => {
        const found = factsAt(program, at(program, 'X'), [['X', { types: ['text'], rank: 1, shape: [null] }]], examples)!;
        expect(found.source).toBe('static');
        expect(formatNameFacts(found)).toBe('X · integer');
    });

    it('reports a parameter as unknown once the body overwrites it', () => {
        const rewritten = 'fun twice X\n X = "a"\n return X\nend\n';
        expect(formatNameFacts(factsAt(rewritten, at(rewritten, 'X'), [], examples)!)).toBe('X · unknown');
    });
});

describe('factsAt: runtime facts', () => {
    it('wins for an executed name', () => {
        const run: [string, ValueFacts][] = [['M', { types: ['array'], rank: 2, shape: [3, 4] }]];
        const source = 'M = array shape 3 4 fill 1\n';
        const found = factsAt(source, 0, run)!;
        expect(found.source).toBe('runtime');
        // The run carries no element type; the analyzer's agrees on shape, so it fills the gap.
        expect(formatNameFacts(found)).toBe('M · integer [3 4]');
    });

    it('does not borrow element types when the shapes disagree', () => {
        const run: [string, ValueFacts][] = [['M', { types: ['array'], rank: 2, shape: [2, 2] }]];
        expect(formatNameFacts(factsAt('M = array shape 3 4 fill 1\n', 0, run)!)).toBe('M · array [2 2]');
    });

    it('serves a read of a name bound by an earlier cell', () => {
        const run: [string, ValueFacts][] = [['Count', { types: ['integer'], rank: 0, shape: [] }]];
        const found = factsAt('Count + 1\n', 2, run)!;
        expect(found.source).toBe('runtime');
        expect(formatNameFacts(found)).toBe('Count · integer');
    });

    it('is static for a name the session never saw', () => {
        expect(factsAt('A = 1\n', 0, [['B', integer()]])?.source).toBe('static');
    });
});

describe('formatNameFacts', () => {
    const found = (name: string, facts: ValueFacts): NameFacts => ({ name, facts, source: 'static' });

    it('writes scalars, arrays and unknowns', () => {
        expect(formatNameFacts(found('N', integer()))).toBe('N · integer');
        expect(formatNameFacts(found('M', integer([3, 4])))).toBe('M · integer [3 4]');
        expect(formatNameFacts(found('X', { types: [] }))).toBe('X · unknown');
        expect(formatNameFacts(found('F', { types: ['function'] }))).toBe('F · function');
    });

    it('omits a shape with an axis it does not know, rather than guessing', () => {
        expect(describeFacts(integer([3, null]))).toBe('array[#, #]<integer>');
        expect(describeFacts({ types: ['array'], rank: 2 })).toBe('array[#, #]<unknown>');
    });

    it('drops the shape, then the front of the name, to fit the footer', () => {
        const long = found('Distances', integer([100, 200]));
        expect(formatNameFacts(long, 40)).toBe('Distances · integer [100 200]');
        expect(formatNameFacts(long, 22)).toBe('Distances · integer');
        expect(formatNameFacts(long, 14)).toBe('Dis… · integer');
        expect(formatNameFacts(long, 14).length).toBeLessThanOrEqual(14);
        expect(formatNameFacts(long, 3).length).toBeLessThanOrEqual(3);
    });
});

describe('factsAt: functions', () => {
    const word = (source: string, text: string): NameFacts => factsAt(source, source.lastIndexOf(text) + 1)!;

    it('shows an audited builtin and a proven notebook call', () => {
        expect(formatNameFacts(word('Xs = array 1 2 3\nXs sum\n', 'sum'), 60)).toBe('sum · array[3]<number> → number');
        expect(formatNameFacts(word('fun twice X\n return X * 2\nend\n3 twice\n', 'twice'), 60)).toBe('twice · i → i');
    });

    it('is not fooled by a variable or an unknown word', () => {
        expect(formatNameFacts(word('Sum = 5\nSum\n', 'Sum'), 60)).toBe('Sum · integer');
        expect(factsAt('Q = Zork\n', 'Q = Zork\n'.lastIndexOf('Zork') + 1)).toBeUndefined();
    });
});

describe('function signatures in the type footer', () => {
    it('uses explicit builtin signatures with their actual overloads', () => {
        const split = 'use text\n"a,b" "," split';
        expect(formatNameFacts(factsAt(split, split.indexOf('split'))!))
            .toBe('split · text text → array[#]<text>');
    });

    it('shows the notebook example signature and preserves unknown inputs', () => {
        const source = 'fun twice X\n Y = X * 2\n return Y\nend';
        expect(formatNameFacts(factsAt(source, source.indexOf('twice'), [], [{ name: 'twice', arguments: [integer()] }])!))
            .toBe('twice · i → i');
        expect(formatNameFacts(factsAt(source, source.indexOf('twice'))!)).toBe('twice · a → ?');
    });

    it('keeps tuple result relationships visible without example arguments', () => {
        const source = 'fun pair X\n return tuple X "label"\nend';
        expect(formatNameFacts(factsAt(source, source.indexOf('pair'))!)).toBe('pair · a → tuple(a, text)');
    });
});

it('does not use a global function signature for a shadowing callback parameter', () => {
    const source = 'fun helper X\n return X\nend\nfun apply helper\n return 1 helper\nend';
    expect(factsAt(source, source.lastIndexOf('helper'))?.signature).toBeUndefined();
});


describe('factsAt: grammar operator signatures', () => {
    it('shows signatures on every word of a compound comparison', () => {
        for (const operator of ['not equal', 'at least', 'at most']) {
            const source = '1 ' + operator + ' 2';
            for (const offset of [2, 2 + operator.indexOf(' ') + 1, 2 + operator.length]) {
                const found = factsAt(source, offset)!;
                expect(found.name).toBe(operator);
                expect(found.signature).toContain('→ boolean');
            }
        }
    });

    it('uses proven operand types and distinguishes unary and binary signs', () => {
        const source = 'X = 1\n-X + 2';
        expect(factsAt(source, source.indexOf('-'))?.signature).toBe('integer → integer [rank 0]');
        expect(factsAt(source, source.indexOf('+'))?.signature).toBe('integer integer → integer [rank 0 0]');
        expect(factsAt('"a" + "b"', 4)?.signature).toBe('text text → text');
        expect(factsAt('not true', 1)?.signature).toBe('boolean → boolean [rank 0]');
    });

    it('does not mistake operators in strings, comments, assignment or loop headers for calls', () => {
        expect(factsAt('"not equal"', 2)).toBeUndefined();
        expect(factsAt('1 # not equal', 5)).toBeUndefined();
        expect(factsAt('X = 1', 2)).toBeUndefined();
        expect(factsAt('for X in (1 to 3)\n X\nend', 7)).toBeUndefined();
    });

    it('keeps runtime name bindings from replacing grammar operator contracts', () => {
        expect(factsAt('true and false', 6, [['and', { types: ['integer'] }]])?.signature)
            .toBe('boolean boolean → boolean [rank 0 0]');
    });
});


it('shows range and proven outer signatures on operator words', () => {
    expect(factsAt('1 to 3', 3)?.signature).toBe('integer integer → sequence<integer>');
    expect(factsAt('1 till 3', 4)?.signature).toBe('integer integer → sequence<integer>');
    const source = '(1 to 3) (1 to 4) outer +';
    for (const offset of [source.indexOf('outer'), source.length - 1, source.length]) {
        expect(factsAt(source, offset)?.signature).toBe('sequence<integer> sequence<integer> → array[3, 4]<integer>');
    }
    const named = '(array 1 2) (array 3 4) outer max';
    expect(factsAt(named, named.indexOf('outer'))?.signature).toBe('array[2]<integer> array[2]<integer> function → array');
    const shadowed = 'fun outer X\n return X\nend\n3 outer';
    expect(factsAt(shadowed, shadowed.lastIndexOf('outer'))?.signature).toBe('i → i');
});


it('shows the flat document overload after grouping its trailing modifier', () => {
    const source = 'use json\n"{}" json .flat';
    expect(factsAt(source, source.lastIndexOf('json'))?.signature).toBe('text .flat → array<object>');
});


it('shows segment form contracts without advertising callable marker signatures', () => {
    for (const combine of ['+', 'maxsum']) {
        const source = `use algo\n(array 1 2 3) segment ${combine}`;
        expect(factsAt(source, source.indexOf('segment'))?.signature).toBe('array[3]<integer> → segment');
        if (combine === 'maxsum') expect(factsAt(source, source.indexOf('maxsum'))?.signature).toBe('array[3]<integer> → segment');
    }
    const named = 'use algo\nfun combine A B\n return A + B\nend\n(array 1 2) segment combine';
    expect(factsAt(named, named.indexOf('segment'))?.signature).toBe('array[2]<integer> (? ? → ?) → segment');
    const shadowed = 'fun segment X\n return X\nend\n3 segment';
    expect(factsAt(shadowed, shadowed.lastIndexOf('segment'))?.signature).toBe('i → i');
});

describe('layoutNameFacts', () => {
    const source = 'use sequences\nF = 1 to 9\nF F outer *';
    const outer = () => factsAt(source, source.indexOf('outer') + 2)!;

    it('keeps a signature that fits on one row', () => {
        expect(layoutNameFacts(outer(), 80)).toEqual(['outer * · sequence<integer> sequence<integer> → array[9, 9]<integer>']);
    });

    it('puts one parameter per row and the result beside the last one', () => {
        expect(layoutNameFacts(outer(), 42)).toEqual([
            'outer * ·',
            '  sequence<integer>',
            '  sequence<integer> → array[9, 9]<integer>',
        ]);
    });

    it('moves the result to its own row when it would not fit beside the last parameter', () => {
        expect(layoutNameFacts(outer(), 24)).toEqual([
            'outer * ·',
            '  sequence<integer>',
            '  sequence<integer>',
            '  → array[9, 9]<integer>',
        ]);
    });
});

it('keeps body alternatives separate from concrete call signatures', () => {
    const definition = 'fun twice X\n return X + X\nend';
    const general = 'a → a ; a: number ; c<a> → c<a> ; a: number';
    for (const calls of ['1 twice\n1.5 twice', '1.5 twice\n1 twice']) {
        const source = definition + '\n' + calls;
        expect(factsAt(source, source.indexOf('twice'))?.signature).toBe(general);
        const last = source.lastIndexOf('twice');
        expect(factsAt(source, last)?.signature).toBe(calls.startsWith('1 twice') ? 'r → r' : 'i → i');
    }
});


it('infers Euler product bounds with a known CLI option and without a run', () => {
    const source = 'use cli\noption Digits integer = 3\nLower = 10 ** (Digits - 1)\nUpper = Lower * 10 - 1\n';
    for (const name of ['Lower', 'Upper']) {
        const offset = source.indexOf(`${name} =`);
        expect(formatNameFacts(factsAt(source, offset)!)).toBe(`${name} · ${name === 'Lower' ? 'integer or real' : 'integer'}`);
        expect(formatNameFacts(factsAt(source, offset,
            [['Digits', { types: ['integer'], rank: 0, shape: [], integer: '3' }]])!))
            .toBe(`${name} · integer`);
    }
});


it('keeps both Products axes visible when their sizes are not proven', () => {
    const source = 'Factors = Upper to Lower by -1\nProducts = Factors Factors outer *\n';
    const found = factsAt(source, source.indexOf('Products'), [
        ['Upper', { types: ['integer'], rank: 0, shape: [] }],
        ['Lower', { types: ['integer'], rank: 0, shape: [] }],
    ])!;
    expect(found.facts).toMatchObject({ types: ['array'], rank: 2, elements: ['integer'] });
    expect(formatNameFacts(found)).toBe('Products · array[#, #]<integer>');
});


it('infers every Euler palindrome pipeline name before running the notebook', () => {
    const source = readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8');
    for (const [site, expected] of [
        ['Candidates =', 'Candidates · sequence<integer>'],
        ['Candidates filter', 'Candidates · sequence<integer>'],
        ['Answer =', 'Answer · integer'],
        ['Answer print', 'Answer · integer'],
        ['Text =', 'Text · text'],
        ['Text equal', 'Text · text'],
        ['Text reverse', 'Text · text'],
    ]) expect(formatNameFacts(factsAt(source, source.indexOf(site))!)).toBe(expected);
});


it.each([
    ['option Digits integer = 3', 'Digits', 'integer'],
    ['argument File path', 'File', 'text'],
    ['option Values integer many', 'Values', 'array[#]<integer>'],
    ['argument Files path many', 'Files', 'array[#]<text>'],
    ['flag Verbose', 'Verbose', 'boolean'],
])('shows the declared input type on its name: %s', (source, name, type) => {
    const start = source.indexOf(name);
    for (const offset of [start, start + 1, start + name.length]) {
        expect(formatNameFacts(factsAt(source, offset)!)).toBe(`${name} · ${type}`);
    }
    expect(factsAt(source, 1)).toBeUndefined();
});

it('uses the input declaration type rather than stale runtime or later binding facts', () => {
    const source = 'option Digits integer = 3\nDigits = "bad"';
    expect(formatNameFacts(factsAt(source, source.indexOf('Digits'), [['Digits', { types: ['text'] }]])!))
        .toBe('Digits · integer');
    expect(factsAt('option Digits integer = 3', 'option Digits '.length + 2)).toBeUndefined();
});


it('shows builtin signatures at their own boundary in a pipeline', () => {
    for (const source of [
        'N = array 1 2 3\nMask = array true false true\nN Mask sum',
        'N = array 1 2 3\nN reverse sum',
        'N = array 1 2 3\nN sum print',
    ]) {
        const found = factsAt(source, source.lastIndexOf('sum'))!;
        expect(found.signature).toContain('→ number');
        expect(found.signature).toMatch(/^array\[(#|3)\]<number> → number$/);
        expect(formatNameFacts(found)).not.toContain('· function');
    }
});
