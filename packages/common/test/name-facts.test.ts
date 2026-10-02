import { describe, expect, it } from 'vitest';
import type { ValueFacts } from '@arrrank/language';
import { factsAt, formatNameFacts, describeFacts, type NameFacts } from '../src/name-facts.js';

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
        expect(formatNameFacts(factsAt('X + 1\n', 0)!)).toBe('X · unknown');
    });

    it('names a user function', () => {
        const program = 'fun f X\n return X\nend\n1 f\n';
        expect(formatNameFacts(factsAt(program, at(program, 'f X'))!)).toBe('f · function');
        expect(formatNameFacts(factsAt(program, at(program, 'f', 2) + 1)!)).toBe('f · function');
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
        expect(describeFacts(integer([3, null]))).toBe('integer');
        expect(describeFacts({ types: ['array'], rank: 2 })).toBe('array');
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
