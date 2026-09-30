import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    for (const name of ['numbers', 'sequences', 'algo']) runtime.execute(`use ${name}`);
    return formatValue(runtime.execute(source)!);
}

describe('structure queries take many queries at once', () => {
    const bag = 'S = (array 1 5 9) multiset\n';

    it('answers one result per query, keeping the query shape', () => {
        expect(run(`${bag}S ceiling (array 0 6)`)).toBe('1 9');
        expect(run(`${bag}S upperbound (array 1 5)`)).toBe('5 9');
        expect(run(`${bag}S lowerbound (array 0 6)`)).toBe('1 9');
        expect(run(`${bag}S floor (array 1 6 10)`)).toBe('1 5 9');
        expect(run(`${bag}S ceiling (array 0 6 2 7 shape 2 2)`)).toBe('1 9 5 9');
        expect(run(`${bag}(S ceiling (array 0 6 2 7 shape 2 2)) shape`)).toBe('2 2');
    });

    it('keeps the scalar query unchanged', () => {
        expect(run(`${bag}S floor 6`)).toBe('5');
    });

    it('raises when a query has no answer, unless default supplies one per cell', () => {
        expect(() => run(`${bag}S floor (array 0 6)`)).toThrow(/no floor value/);
        expect(run(`${bag}S floor (array 0 1 6 10) default -1`)).toBe('-1 1 5 9');
        expect(run(`${bag}S ceiling (array 0 6 10) default 99`)).toBe('1 9 99');
    });

    it('firstatleast answers each target', () => {
        expect(run('T = (array 3 1 5) segment max\nT (array 2 4 9) firstatleast')).toBe('0 2 -1');
    });
});

describe('disjoint-set queries take many values at once', () => {
    it('answers one representative per queried value', () => {
        const sets = 'use graph\nD = new dsu\nD 1 2 merge\nD 3 4 merge\n';
        expect(run(`${sets}D (array 1 2 3 4) findroot`)).toBe('1 1 3 3');
        expect(run(`${sets}D 2 findroot`)).toBe('1');
        expect(run(`${sets}(D (array 1 2 3 4 shape 2 2) findroot) shape`)).toBe('2 2');
    });
});
