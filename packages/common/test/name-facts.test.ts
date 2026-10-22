import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { operations, operationSignature, type ValueFacts } from '@arrrank/language';
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

    it.each([['', 'array'], ["'", 'sequence']])('shows the binding result for a range marked %s', (marker, type) => {
        const source = `Values${marker} = 1 to 3\nValues print`;
        for (const offset of [source.indexOf('Values'), source.lastIndexOf('Values')]) {
            expect(factsAt(source, offset)?.facts.types).toEqual([type]);
        }
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
        const program = 'fun X f\n return X\nend\n1 f\n';
        expect(formatNameFacts(factsAt(program, at(program, 'f\n'))!)).toBe('f · a → a');
        expect(formatNameFacts(factsAt(program, at(program, 'f', 2) + 1)!)).toBe('f · i → i');
    });

    it('returns nothing for source that does not parse', () => {
        expect(factsAt('A = (', 0)).toBeUndefined();
    });
});

describe('factsAt: functions with example arguments', () => {
    const program = 'fun X twice\n Y = X * 2\n return Y\nend\n';
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
        const rewritten = 'fun X twice\n X = "a"\n return X\nend\n';
        expect(formatNameFacts(factsAt(rewritten, at(rewritten, 'X'), [], examples)!)).toBe('X · unknown');
    });

    it.each(["fun X' plus Y", "fun X plus Y'"])(
        'finds ordinary and deferred parameter names in %s', header => {
            const source = `${header}\n return X + Y\nend`;
            const inputs = [{ name: 'plus', arguments: [integer(), integer()] }];
            for (const name of ['X', 'Y']) {
                expect(formatNameFacts(factsAt(source, source.indexOf(name), [], inputs)!)).toBe(`${name} · integer`);
            }
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
        expect(formatNameFacts(factsAt('M = array shape 3 4 fill 1\n', 0, run)!)).toBe('M · c [2 2]');
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
        expect(describeFacts(integer([3, null]))).toBe('c[#, #]<integer>');
        expect(describeFacts({ types: ['array'], rank: 2 })).toBe('c[#, #]<unknown>');
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
        expect(formatNameFacts(word('Xs = array 1 2 3\nXs sum\n', 'sum'), 60)).toBe("sum · c[3]<number> → number");
        expect(formatNameFacts(word('fun X twice\n return X * 2\nend\n3 twice\n', 'twice'), 60)).toBe('twice · i → i');
    });

    it('is not fooled by a variable or an unknown word', () => {
        expect(formatNameFacts(word('Sum = 5\nSum\n', 'Sum'), 60)).toBe('Sum · integer');
        expect(factsAt('Q = Zork\n', 'Q = Zork\n'.lastIndexOf('Zork') + 1)).toBeUndefined();
    });
});

describe('function signatures in the type footer', () => {
    it('shows window results through the container family and keeps known text calls precise', () => {
        const source = 'use sequences\nwindow';
        const found = factsAt(source, source.lastIndexOf('window'))!;
        expect(found.signature).toBe('text (i | c<i>) → c<text> ; c<a> (i | c<i>) → c<a> ; c<a> (i | c<i>) → c<a> | c<c<a>>');
        expect(layoutNameFacts(found, 40).every(row => row.length <= 40)).toBe(true);
        const call = 'use sequences\n"abcd" window 2';
        expect(factsAt(call, call.lastIndexOf('window'))?.signature).toBe("text i → c<text>");
        const shadowed = 'fun X Y window\n return X + Y\nend\n1 window 2';
        expect(factsAt(shadowed, shadowed.lastIndexOf('window'))?.signature).toContain('a a → a');
        expect(factsAt(shadowed, shadowed.lastIndexOf('window'))?.signature).not.toContain('widths:');
        for (const dimensions of ['2 2', 'unpack (array 2 2)']) {
            const matrix = `use sequences\nM = array shape 3 3 fill 1\nM window ${dimensions}`;
            expect(factsAt(matrix, matrix.lastIndexOf('window'))?.signature)
                .toMatch(/^c\[3, 3\]<i> c(?:\[2\])?<i> → c<i>$/);
        }
    });
    it('shows unique with the container family and preserves a known element type', () => {
        const source = 'use sequences\nunique';
        const found = factsAt(source, source.lastIndexOf('unique'))!;
        expect(found.signature).toBe('text → text ; c<a> → c<a> ; c → c');
        const call = 'use sequences\nS unique';
        expect(factsAt(call, call.lastIndexOf('unique'), [['S', { types: ['stack'], elements: ['integer'] }]])?.signature)
            .toBe("c<i> → c<i>");
    });
    it('shows len and shape with one container receiver row instead of a type inventory', () => {
        for (const name of ['len', 'shape']) {
            const source = name === 'shape' ? 'use sequences\nshape' : 'len';
            const found = factsAt(source, source.lastIndexOf(name))!;
            const rows = layoutNameFacts(found, 40);
            expect(rows).toEqual([`${name} · c → ${name === 'len' ? 'i' : 'c<i>'}`]);
            expect(rows.filter(row => row.includes('→'))).toHaveLength(1);
            expect(rows.every(row => row.length <= 40)).toBe(true);
        }
        expect(factsAt('"abc" len', 7)?.signature).toBe('text → i');
    });
    it('shows compact mapping rules on bare text helpers and precise signatures at known calls', () => {
        for (const name of ['startswith', 'translate', 'lpad']) {
            const source = `use text\n${name}`;
            const found = factsAt(source, source.lastIndexOf(name))!;
            expect(found.signature).toContain('containers: elementwise');
            expect(found.signature).toContain('SQL: column result');
            const rows = layoutNameFacts(found, 40);
            expect(rows.length).toBeLessThanOrEqual(6);
            expect(rows.every(row => row.length <= 40)).toBe(true);
            expect(rows.filter(row => row.includes('→'))).toHaveLength(name === 'startswith' ? 2 : 1);
        }
        const source = 'use text\n"abc" "a" startswith';
        expect(factsAt(source, source.lastIndexOf('startswith'))?.signature).toBe('text text → boolean');
    });
    it('groups the general sum contract and narrows known collection calls', () => {
        const general = factsAt('sum', 0)!;
        expect(general.signature)
            .toBe("(number | missing | column | c<number | missing>) → number");
        const rows = layoutNameFacts(general, 40);
        expect(rows.filter(row => row.includes('→'))).toHaveLength(1);
        expect(rows.join(' ')).not.toContain('c:');
        expect(rows.every(row => row.length <= 40)).toBe(true);
        const source = 'N = 1 to 999\nN sum';
        expect(factsAt(source, source.lastIndexOf('sum'))?.signature).toBe("c[999]<number> → number");
    });
    it('uses explicit builtin signatures with their actual overloads', () => {
        const split = 'use text\n"a,b" "," split';
        expect(formatNameFacts(factsAt(split, split.indexOf('split'))!))
            .toBe("split · text text → c[#]<text>");
    });

    it('shows the notebook example signature and preserves unknown inputs', () => {
        const source = 'fun X twice\n Y = X * 2\n return Y\nend';
        expect(formatNameFacts(factsAt(source, source.indexOf('twice'), [], [{ name: 'twice', arguments: [integer()] }])!))
            .toBe('twice · i → i');
        expect(formatNameFacts(factsAt(source, source.indexOf('twice'))!)).toBe('twice · a → ?');
    });

    it('keeps tuple result relationships visible without example arguments', () => {
        const source = 'fun X pair\n return tuple X "label"\nend';
        expect(formatNameFacts(factsAt(source, source.indexOf('pair'))!)).toBe('pair · a → tuple(a, text)');
    });
});

it('does not use a global function signature for a shadowing callback parameter', () => {
    const source = 'fun X helper\n return X\nend\nfun apply helper\n return 1 helper\nend';
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
        expect(factsAt(source, source.indexOf('-'))?.signature).toBe('i → i');
        expect(factsAt(source, source.indexOf('+'))?.signature).toBe('i i → i');
        expect(factsAt('"a" + "b"', 4)?.signature).toBe('text text → text');
        expect(factsAt('not true', 1)?.signature).toBe('boolean → boolean');
    });

    it('uses the same compact numeric names for builtin functions', () => {
        const source = 'use numbers\n2 sqrt';
        expect(factsAt(source, source.indexOf('sqrt'))?.signature).toBe('number → r');
    });

    it('does not mistake operators in strings, comments, assignment or loop headers for calls', () => {
        expect(factsAt('"not equal"', 2)).toBeUndefined();
        expect(factsAt('1 # not equal', 5)).toBeUndefined();
        expect(factsAt('X = 1', 2)).toBeUndefined();
        expect(factsAt('for X in (1 to 3)\n X\nend', 7)).toBeUndefined();
    });

    it('keeps runtime name bindings from replacing grammar operator contracts', () => {
        expect(factsAt('true and false', 6, [['and', { types: ['integer'] }]])?.signature)
            .toBe('boolean boolean → boolean');
    });
});


it('shows range and proven outer signatures on operator words', () => {
    expect(factsAt('1 to 3', 3)?.signature).toBe("i i → c<i>");
    expect(factsAt('1 till 3', 4)?.signature).toBe("i i → c<i>");
    const source = '(1 to 3) (1 to 4) outer +';
    for (const offset of [source.indexOf('outer'), source.length - 1, source.length]) {
        expect(factsAt(source, offset)?.signature).toBe("c<i> c<i> → c[3, 4]<i>");
    }
    const named = '(array 1 2) (array 3 4) outer max';
    expect(factsAt(named, named.indexOf('outer'))?.signature).toBe("c[2]<i> c[2]<i> function → c");
    const shadowed = 'fun X outer\n return X\nend\n3 outer';
    expect(factsAt(shadowed, shadowed.lastIndexOf('outer'))?.signature).toBe('i → i');
});


it('shows the flat document overload after grouping its trailing modifier', () => {
    const source = 'use json\n"{}" json .flat';
    expect(factsAt(source, source.lastIndexOf('json'))?.signature).toBe("text .flat → c<object>");
});


it('shows segment form contracts without advertising callable marker signatures', () => {
    for (const combine of ['+', 'maxsum']) {
        const source = `use algo\n(array 1 2 3) segment ${combine}`;
        expect(factsAt(source, source.indexOf('segment'))?.signature).toBe("c[3]<i> → c");
        if (combine === 'maxsum') expect(factsAt(source, source.indexOf('maxsum'))?.signature).toBe("c[3]<i> → c");
    }
    const named = 'use algo\nfun A B combine\n return A + B\nend\n(array 1 2) segment combine';
    expect(factsAt(named, named.indexOf('segment'))?.signature).toBe("c[2]<i> (? ? → ?) → c");
    const shadowed = 'fun X segment\n return X\nend\n3 segment';
    expect(factsAt(shadowed, shadowed.lastIndexOf('segment'))?.signature).toBe('i → i');
});

describe('layoutNameFacts', () => {
    const source = 'use sequences\nF = 1 to 9\nF F outer *';
    const outer = () => factsAt(source, source.indexOf('outer') + 2)!;

    it('fits every general catalogue signature into forty columns, including nested unions', () => {
        for (const operation of operations.filter(operation => operation.signatures?.length)) {
            const found: NameFacts = { name: operation.name, source: 'static', facts: { types: ['function'] },
                signature: operationSignature(operation, undefined, { compact: true, shortNumericNames: true }) };
            const rows = layoutNameFacts(found, 40);
            expect(rows.every(row => row.length <= 40), operation.name).toBe(true);
        }
    });

    it('wraps local union definitions as annotations rather than result signatures', () => {
        const found = factsAt('use graph\nG S T maxflow', 18)!;
        expect(found.signature).toBe("c u u → record ; u = number | boolean | text | symbol");
        const rows = layoutNameFacts(found, 30);
        expect(rows.filter(row => row.includes('→'))).toHaveLength(1);
        expect(rows.join(' ')).toContain('u = number');
        expect(rows.every(row => row.length <= 30)).toBe(true);
    });

    it('keeps a signature that fits on one row', () => {
        expect(layoutNameFacts(outer(), 80)).toEqual(["outer * · c[9]<i> c[9]<i> → c[9, 9]<i>"]);
    });

    it('puts one parameter per row and the result beside the last one', () => {
        expect(layoutNameFacts(outer(), 24)).toEqual([
            'outer * ·',
            '  c[9]<i>',
            "  c[9]<i> → c[9, 9]<i>",
        ]);
    });

    it('moves the result to its own row when it would not fit beside the last parameter', () => {
        expect(layoutNameFacts(outer(), 18)).toEqual([
            'outer * ·',
            '  c[9]<i>',
            '  c[9]<i>',
            "  → c[9, 9]<i>",
        ]);
    });
});

it('keeps body alternatives separate from concrete call signatures', () => {
    const definition = 'fun X twice\n return X + X\nend';
    const general = 'a → a ; c<a> → c<a> ; a: number';
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
        expect(formatNameFacts(factsAt(source, offset)!)).toBe(`${name} · integer or real`);
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
    expect(formatNameFacts(found)).toBe('Products · c[#, #]<integer>');
});


it('infers every Euler palindrome pipeline name before running the notebook', () => {
    const source = readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8');
    for (const [site, expected] of [
        ["Candidates' =", 'Candidates · c<integer>'],
        ['Candidates filter', 'Candidates · c<integer>'],
        ['Answer =', 'Answer · integer'],
        ['Answer print', 'Answer · integer'],
        ['Original =', 'Original · integer'],
        ['Original equal', 'Original · integer'],
        ['Reversed *', 'Reversed · integer'],
    ]) expect(formatNameFacts(factsAt(source, source.indexOf(site))!)).toBe(expected);
});


it.each([
    ['option Digits integer = 3', 'Digits', 'integer'],
    ['argument File path', 'File', 'text'],
    ['option Values integer many', 'Values', 'c[#]<integer>'],
    ['argument Files path many', 'Files', 'c[#]<text>'],
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
    for (const [source, signature] of [
        // A mask returns a sequence; sequence signatures omit array axes.
        ['N = array 1 2 3\nMask = array true false true\nN Mask sum', /^c<number> → number$/],
        ['N = array 1 2 3\nN reverse sum', /^c\[(#|3)\]<number> → number$/],
        ['N = array 1 2 3\nN sum print', /^c\[(#|3)\]<number> → number$/],
    ] as const) {
        const found = factsAt(source, source.lastIndexOf('sum'))!;
        expect(found.signature).toMatch(signature);
        expect(formatNameFacts(found)).not.toContain('· function');
    }
});


it('keeps Euler 1 computed integer arrays and boolean masks, including compound assignment targets', () => {
    const source = readFileSync(new URL('../../../demos/euler/001_multiples.ra', import.meta.url), 'utf8');
    for (const [site, expected] of [
        ['N =', 'N · c[#]<integer>'],
        ['Mask =', 'Mask · c[#]<boolean>'],
        ['Mask or=', 'Mask · c[#]<boolean>'],
        ['Mask sum', 'Mask · c[#]<boolean>'],
        ['Answer =', 'Answer · integer'],
        ['Answer print', 'Answer · integer'],
    ]) expect(formatNameFacts(factsAt(source, source.indexOf(site))!)).toBe(expected);
});


it('infers Euler 13 call results and uncalled locals, with backward parameter contracts', () => {
    const source = readFileSync(new URL('../../../demos/euler/013_largesum.ra', import.meta.url), 'utf8');
    expect(formatNameFacts(factsAt(source, source.indexOf('Answer ='))!)).toBe('Answer · integer');
    expect(formatNameFacts(factsAt(source, source.indexOf('Numbers Digits leading_sum'))!)).toBe('Numbers · integer [100]');
    const definition = source.slice(source.search(/\bfun (?:[A-Z]\w*[ \t]+)*leading_sum\b/));
    expect(formatNameFacts(factsAt(definition, definition.indexOf('Prefix ='))!)).toBe('Prefix · text');
    expect(formatNameFacts(factsAt(definition, definition.indexOf('Digits'))!)).toBe('Digits · integer');
    const numbers = factsAt(definition, definition.indexOf('Numbers'))!;
    expect(numbers.facts.types).toEqual([]);
    expect(numbers.requirement).toBe('(integer or missing or real) [rank ≥ 0]');
});


it('shows backward parameter requirements on the Euler 13 function definition', () => {
    const source = readFileSync(new URL('../../../demos/euler/013_largesum.ra', import.meta.url), 'utf8');
    const found = factsAt(source, source.indexOf('leading_sum', source.search(/^fun[^\n]*\bleading_sum\b/m)))!;
    expect(found.signature).toBe('(number | missing) [rank ≥ 0] i → i');
    expect(layoutNameFacts(found, 40)).toEqual(['leading_sum ·', '  (number | missing) [rank ≥ 0]', '  i → i']);
});


it('keeps the proved Euler 17 cell signature after printing its sum', () => {
    const source = readFileSync(new URL('../../../demos/euler/017_numberletters.ra', import.meta.url), 'utf8');
    const found = factsAt(source, source.indexOf('letters', source.search(/^fun[^\n]*\bletters\b/m)))!;
    expect(found.signature).toBe('i → i');
});

it('uses earlier calls for a definition without restoring facts for later calls', () => {
    const source = 'use io\nValues = array 3 5 7\nA = 0 lookup\nA print\n0 lookup\n'
        + 'fun N lookup\n return Values N\nend';
    expect(factsAt(source, source.indexOf('lookup', source.search(/^fun[^\n]*\blookup\b/m)))?.signature).toBe('i → i');
    expect(factsAt(source, source.indexOf('lookup', source.indexOf('A print')))?.signature).toBe('i → ?');
});

it('does not report a vector for a queue of boards returned from a nested search', () => {
    const source = `use algo
use sequences
fun N solve
  Board = array shape N fill 0
  Results = new queue
  fun Results visit
    Results push (Board copy)
    return 1
  end
  Count = Results visit
  return Results array
end
Solutions = 8 solve
Solutions len
`;
    for (const occurrence of [0, 1]) {
        const found = factsAt(source, at(source, 'Solutions', occurrence))!;
        expect(found.facts.types).toEqual(['array']);
        expect([undefined, 2]).toContain(found.facts.rank);
    }
});

it('does not label a bulk find fallback as a scalar', () => {
    const source = 'use sequences\nKeys = array 10 20 30\nQueries = array 20 99 10\nPositions = Keys Queries find default -1';
    const result = factsAt(source, at(source, 'Positions'))!.facts;
    expect(result.types.length === 0 || result.types.includes('array')).toBe(true);
});
